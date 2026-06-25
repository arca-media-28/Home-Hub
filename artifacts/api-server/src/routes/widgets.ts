import { Router } from "express";
import Parser from "rss-parser";
import { requireAuth } from "../lib/auth.js";
import { connectionStmts } from "../lib/db.js";
import { httpClient, cloudHttpClient, normalizeBaseUrl, normalizeHttpError, describeHttpError } from "../lib/http.js";
import { fetchPiholeData } from "../lib/pihole.js";
import { subsonicAuthParams, subsonicGet, subsonicMediaQuery, type SubsonicSong } from "../lib/subsonic.js";
import { logger } from "../lib/logger.js";
import {
  getSpotifyConnection,
  getValidAccessToken,
  getProfile,
  getPlayback,
  getQueue,
  sendCommand,
  type SpotifyTrackObject,
  type SpotifyPlayback,
  type SpotifyCommand,
} from "../lib/spotify.js";

const router = Router();

// Saved connection details, normalized for widget consumption.
interface SavedConnection {
  url?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  token?: string;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

// Read a service's saved connection from the DB. Returns an empty object when
// the service has no row or no values stored. The `extra` column holds a JSON
// blob that may carry a Plex token.
function getSavedConnection(service: string): SavedConnection {
  const row = connectionStmts.findByService.get(service);
  if (!row) return {};

  let token: string | undefined;
  if (row.extra) {
    try {
      token = (JSON.parse(row.extra) as { token?: string }).token ?? undefined;
    } catch {
      token = undefined;
    }
  }

  return {
    url: row.url?.trim() ? trimSlash(row.url.trim()) : undefined,
    apiKey: row.api_key?.trim() || undefined,
    username: row.username?.trim() || undefined,
    password: row.password ?? undefined,
    token,
  };
}

// Build an app.plex.tv deep link for a single item so clicking its cover opens
// it directly in Plex. Needs the server's machineIdentifier (from the Plex
// MediaContainer root) and the item's ratingKey. Returns null when either is
// missing so callers can omit the link gracefully.
function plexDeepLink(machineId: string | undefined, ratingKey: string | undefined): string | null {
  if (!machineId || ratingKey == null) return null;
  const key = encodeURIComponent(`/library/metadata/${ratingKey}`);
  return `https://app.plex.tv/desktop/#!/server/${machineId}/details?key=${key}`;
}

// A placeholder machineIdentifier used to build deep links for the built-in
// sample/demo media items (shown when no Plex server is configured). These links
// open app.plex.tv so users can verify the poster/title click-through works
// before connecting a real server; they won't resolve to a real library item.
const SAMPLE_PLEX_MACHINE_ID = "demo";

// Pull a Plex machineIdentifier out of a single response body. Plex normally
// honors `Accept: application/json` and returns { MediaContainer: { ... } }, but
// some setups (reverse proxies, older PMS) ignore the header and return XML as a
// string. Handle both: read the JSON field when present, else regex it out of
// the raw XML. Returns undefined when the field can't be found.
function extractPlexMachineId(data: unknown): string | undefined {
  if (data && typeof data === "object") {
    const id = (data as { MediaContainer?: { machineIdentifier?: string } })
      .MediaContainer?.machineIdentifier;
    if (id) return id;
  }
  if (typeof data === "string") {
    const m = data.match(/machineIdentifier="([^"]+)"/);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

// Resolve the Plex server's machineIdentifier needed for app.plex.tv deep links.
// The library-list endpoints (/library/recentlyAdded, /library/onDeck) omit it
// from their MediaContainer root, so source it here. Tries /identity first, then
// falls back to the server root MediaContainer (`/`), which also carries the
// field — this covers servers where /identity is blocked, returns an unexpected
// shape, or omits the identifier. Logs a warning when every endpoint fails so
// the cause is visible. Returns undefined on total failure so callers fall back
// to url:null and the tile still renders (additive — must never cause a 502).
async function fetchPlexMachineId(
  baseUrl: string,
  apiKey: string,
): Promise<string | undefined> {
  const paths = ["/identity", "/"];
  let lastReason: unknown;
  for (const path of paths) {
    try {
      const r = await httpClient.get(`${baseUrl}${path}`, {
        headers: { "X-Plex-Token": apiKey, Accept: "application/json" },
      });
      const id = extractPlexMachineId(r.data);
      if (id) return id;
      lastReason = `no machineIdentifier in ${path} response (status ${r.status})`;
    } catch (err) {
      lastReason = normalizeHttpError(err);
    }
  }
  logger.warn(
    { reason: lastReason },
    "Plex machineIdentifier resolution failed — deep links will be absent",
  );
  return undefined;
}

// Build a deep link that opens a Jellyfin library item directly in the Jellyfin
// web app. Needs the server's web base URL, its ServerId (from /System/Info) and
// the item id. Returns null when either id piece is missing so callers can omit
// the link gracefully.
function jellyfinDeepLink(
  baseUrl: string,
  serverId: string | undefined,
  itemId: string | undefined,
): string | null {
  if (!serverId || itemId == null) return null;
  return `${baseUrl}/web/index.html#!/details?id=${encodeURIComponent(itemId)}&serverId=${encodeURIComponent(serverId)}`;
}

// Resolve the Jellyfin server's Id from its System/Info endpoint. The /Items
// list response doesn't carry the ServerId needed for web deep links, so source
// it here in parallel. Returns undefined on any failure so callers fall back to
// url:null and the tile still renders (additive — must never cause a 502).
async function fetchJellyfinServerId(
  baseUrl: string,
  apiKey: string,
): Promise<string | undefined> {
  try {
    const r = await httpClient.get(`${baseUrl}/System/Info`, {
      params: { api_key: apiKey },
    });
    return r.data?.Id ?? undefined;
  } catch {
    return undefined;
  }
}

// ────────────────────────────────────────────────
// TrueNAS SCALE Widget
// ────────────────────────────────────────────────
// Build a legend→latest-value map for a single reporting graph. TrueNAS returns
// each graph as { legend: string[], data: number[][], aggregations? }. The real
// response includes "time" as the FIRST legend entry, and each data row is
// aligned to that full legend (the unix timestamp sits in the "time" column).
// The `aggregations.mean` array, however, holds one value per legend column
// EXCLUDING "time". The two sources must therefore be zipped differently.
// Prefer the aggregated mean when present.
function latestByLegend(graph: unknown): Record<string, number> {
  const g = graph as
    | { legend?: string[]; data?: number[][]; aggregations?: { mean?: number[] } }
    | undefined;
  const legend = g?.legend ?? [];

  const map: Record<string, number> = {};
  const mean = g?.aggregations?.mean;
  if (Array.isArray(mean)) {
    // mean excludes the "time" column → zip against the legend with "time" gone.
    const valueLegend = legend.filter((name) => name !== "time");
    const values = mean.map((n) => Number(n) || 0);
    valueLegend.forEach((name, i) => {
      map[name] = values[i] ?? 0;
    });
  } else {
    // Data rows are aligned to the FULL legend (timestamp in the "time" column),
    // so zip the row directly against the legend without dropping a column.
    const rows = g?.data ?? [];
    const last = rows[rows.length - 1] ?? [];
    const values = last.map((n) => Number(n) || 0);
    legend.forEach((name, i) => {
      map[name] = values[i] ?? 0;
    });
  }
  return map;
}

// Shape of a single pool row from `GET /api/v2.0/pool`, narrowed to the vdev
// stats we sum for capacity.
interface TruenasPool {
  name: string;
  status: string;
  topology?: { data?: Array<{ stats?: { allocated?: number; alloc?: number; size?: number; space?: number } }> };
}

// Reduce a TrueNAS reporting response (array of graphs) into CPU% and memory
// bytes. Kept separate so the route can call it only when the reporting request
// actually succeeded.
function parseTruenasReporting(reportData: unknown): {
  cpuPercent: number;
  memUsedGb: number;
  memTotalGb: number;
} {
  const graphs = (reportData ?? []) as Array<{ name?: string }>;
  const cpuGraph = graphs.find((g) => g.name === "cpu") ?? graphs[0];
  const memGraph = graphs.find((g) => g.name === "memory") ?? graphs[1];

  // CPU is reported per-state in percent; usage is everything that isn't idle.
  const cpu = latestByLegend(cpuGraph);
  const idle = cpu["idle"] ?? 0;
  const cpuPercent = Math.min(100, Math.max(0, 100 - idle));

  // Memory legend values are in bytes. "used" is real usage; total is the sum
  // of the physical-memory buckets that are present.
  const mem = latestByLegend(memGraph);
  const memUsedBytes = mem["used"] ?? 0;
  const memTotalBytes =
    (mem["used"] ?? 0) +
    (mem["free"] ?? 0) +
    (mem["cached"] ?? 0) +
    (mem["buffers"] ?? 0);

  return {
    cpuPercent: Number(cpuPercent.toFixed(1)),
    memUsedGb: memUsedBytes / 1e9,
    memTotalGb: memTotalBytes / 1e9,
  };
}

// First matching legend key from a list of candidates, or null when none of the
// candidates are present. Lets the network/ARC parsers tolerate small legend
// naming differences across TrueNAS/Netdata versions.
function pickLegendValue(map: Record<string, number>, keys: string[]): number | null {
  for (const key of keys) {
    if (key in map) return map[key]!;
  }
  return null;
}

// Extract the chronological per-sample series for a single legend column from a
// graph's raw `data` rows (one value per time step, oldest→newest). The first
// matching candidate key wins. Returns [] when the column is absent or there are
// no rows. Unlike latestByLegend this never collapses to the aggregated mean — a
// sparkline needs the individual samples, so the extras call must request the
// window WITHOUT aggregation for these to be populated.
function seriesByLegend(graph: unknown, keys: string[]): number[] {
  const g = graph as { legend?: string[]; data?: number[][] } | undefined;
  const legend = g?.legend ?? [];
  const rows = g?.data ?? [];
  if (legend.length === 0 || rows.length === 0) return [];
  let idx = -1;
  for (const key of keys) {
    const i = legend.indexOf(key);
    if (i >= 0) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return [];
  const out: number[] = [];
  for (const row of rows) {
    const v = row?.[idx];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

// Build a deterministic, gently-wiggling demo series ending near `base`, clamped
// to [min, max]. Used only for the unconfigured sample payload so the sparkline
// renders something representative on Replit/dev where no NAS is reachable.
function sampleSeries(base: number, amp: number, min: number, max: number, n = 30): number[] {
  return Array.from({ length: n }, (_, i) => {
    const v = base + Math.sin(i / 2.3) * amp + Math.cos(i / 3.7) * amp * 0.4;
    return Number(Math.min(max, Math.max(min, v)).toFixed(2));
  });
}

// Reduce a long series to at most `max` evenly-spaced points (always keeping the
// first and last) so the sparkline payload stays small regardless of how many
// samples the reporting window returned.
function downsample(series: number[], max = 30): number[] {
  if (series.length <= max) return series;
  const out: number[] = [];
  const step = (series.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(series[Math.round(i * step)]!);
  }
  return out;
}

// Reduce a TrueNAS reporting response into network throughput and ZFS ARC stats.
// These graphs are best-effort extras: any that is missing yields null so the
// tile can simply omit it. Requested via a SEPARATE reporting call from CPU/RAM
// so an interface graph that needs an identifier (and may be rejected) never
// regresses the core CPU/RAM numbers.
//
// Unit assumptions (the same Netdata-based backend that serves CPU/RAM):
//  - interface throughput is in kilobits/sec → megabits/sec is value / 1000.
//  - arcsize is in bytes → gigabytes is value / 1e9 (matching the memory graph).
//  - arcactualrate reports hits/misses per second → ratio = hits/(hits+misses).
function parseTruenasNetArc(reportData: unknown): {
  netInMbps: number | null;
  netOutMbps: number | null;
  arcHitRatio: number | null;
  arcSizeGb: number | null;
  netInSeries: number[];
  netOutSeries: number[];
  arcHitSeries: number[];
} {
  const graphs = (reportData ?? []) as Array<{ name?: string }>;
  const ifaceGraph = graphs.find((g) => g.name === "interface");
  const arcRateGraph = graphs.find((g) => g.name === "arcactualrate");
  const arcSizeGraph = graphs.find((g) => g.name === "arcsize");

  const rxKeys = ["received", "rx", "in", "incoming"];
  const txKeys = ["sent", "tx", "out", "outgoing"];

  let netInMbps: number | null = null;
  let netOutMbps: number | null = null;
  let netInSeries: number[] = [];
  let netOutSeries: number[] = [];
  if (ifaceGraph) {
    const iface = latestByLegend(ifaceGraph);
    const rxKbps = pickLegendValue(iface, rxKeys);
    const txKbps = pickLegendValue(iface, txKeys);
    if (rxKbps != null) netInMbps = Number((Math.abs(rxKbps) / 1000).toFixed(2));
    if (txKbps != null) netOutMbps = Number((Math.abs(txKbps) / 1000).toFixed(2));
    // Per-sample throughput trend (kilobits/sec → Mbps), oldest→newest.
    const toMbps = (v: number) => Number((Math.abs(v) / 1000).toFixed(2));
    netInSeries = downsample(seriesByLegend(ifaceGraph, rxKeys).map(toMbps));
    netOutSeries = downsample(seriesByLegend(ifaceGraph, txKeys).map(toMbps));
  }

  let arcHitRatio: number | null = null;
  let arcHitSeries: number[] = [];
  if (arcRateGraph) {
    const rate = latestByLegend(arcRateGraph);
    const hits = pickLegendValue(rate, ["hits", "hit"]);
    const misses = pickLegendValue(rate, ["misses", "miss"]);
    if (hits != null && misses != null) {
      const total = hits + misses;
      arcHitRatio = total > 0 ? Number(((hits / total) * 100).toFixed(1)) : 0;
    }
    // Per-sample hit ratio: combine the hits and misses series step by step.
    const hitsSeries = seriesByLegend(arcRateGraph, ["hits", "hit"]);
    const missSeries = seriesByLegend(arcRateGraph, ["misses", "miss"]);
    const n = Math.min(hitsSeries.length, missSeries.length);
    const ratios: number[] = [];
    for (let i = 0; i < n; i++) {
      const total = hitsSeries[i]! + missSeries[i]!;
      ratios.push(total > 0 ? Number(((hitsSeries[i]! / total) * 100).toFixed(1)) : 0);
    }
    arcHitSeries = downsample(ratios);
  }

  let arcSizeGb: number | null = null;
  if (arcSizeGraph) {
    const size = latestByLegend(arcSizeGraph);
    const sizeBytes = pickLegendValue(size, ["arc_size", "size", "arcsz", "arc", "c"]);
    if (sizeBytes != null) arcSizeGb = Number((sizeBytes / 1e9).toFixed(2));
  }

  return { netInMbps, netOutMbps, arcHitRatio, arcSizeGb, netInSeries, netOutSeries, arcHitSeries };
}

// Reduce a TrueNAS `GET /api/v2.0/pool` response into per-pool used/total bytes.
function parseTruenasPools(poolData: unknown) {
  return ((poolData ?? []) as TruenasPool[]).map((p) => {
    let usedBytes = 0;
    let totalBytes = 0;
    for (const vdev of p.topology?.data ?? []) {
      const stats = vdev.stats ?? {};
      usedBytes += stats.allocated ?? stats.alloc ?? 0;
      totalBytes += stats.size ?? stats.space ?? 0;
    }
    return { name: p.name, status: p.status, usedBytes, totalBytes };
  });
}

// Merge a TrueNAS `GET /api/v2.0/disk` inventory (names + temperatures) with the
// `GET /api/v2.0/smart/test/results` SMART history into a per-disk health row:
// `{ name, temperatureC, smartPassed }`. Both inputs are best-effort — either may
// be missing/empty — so each field defaults to null ("unknown") when absent.
function parseTruenasDisks(diskData: unknown, smartData: unknown) {
  // Latest SMART verdict per disk. A disk's most recent test result decides the
  // pass/fail: SUCCESS → passed, anything else with a known status → failed,
  // an unrecognized/empty status → unknown (null).
  const smartByDisk = new Map<string, boolean | null>();
  for (const entry of (smartData ?? []) as Array<{
    disk?: string;
    tests?: Array<{ status?: string }>;
  }>) {
    if (!entry.disk) continue;
    const tests = entry.tests ?? [];
    const latest = tests[tests.length - 1];
    const status = latest?.status?.toUpperCase();
    let passed: boolean | null = null;
    if (status === "SUCCESS") passed = true;
    else if (status === "FAILED" || status === "FAILURE" || status === "ERROR") passed = false;
    smartByDisk.set(entry.disk, passed);
  }

  return ((diskData ?? []) as Array<{
    name?: string;
    devname?: string;
    temperature?: number;
    temp?: number;
  }>)
    .map((d) => {
      const name = d.name ?? d.devname ?? "";
      const rawTemp = d.temperature ?? d.temp;
      const temperatureC = typeof rawTemp === "number" ? rawTemp : null;
      const smartPassed = smartByDisk.has(name) ? smartByDisk.get(name)! : null;
      return { name, temperatureC, smartPassed };
    })
    .filter((d) => d.name);
}

router.get("/truenas", requireAuth, async (_req, res) => {
  const saved = getSavedConnection("truenas");
  const baseUrl = saved.url || process.env["TRUENAS_URL"];
  const apiKey = saved.apiKey || process.env["TRUENAS_API_KEY"];

  if (!baseUrl || !apiKey) {
    // Sample data only when the service is genuinely unconfigured.
    res.json({
      cpuPercent: 12.4,
      memUsedGb: 14.2,
      memTotalGb: 64.0,
      netInMbps: 184.6,
      netOutMbps: 42.3,
      arcHitRatio: 98.7,
      arcSizeGb: 31.4,
      netInSeries: sampleSeries(184.6, 45, 90, 300),
      netOutSeries: sampleSeries(42.3, 18, 5, 200),
      arcHitSeries: sampleSeries(98.7, 1.2, 80, 100),
      pools: [
        { name: "tank", status: "ONLINE", usedBytes: 2.1e12, totalBytes: 10e12 },
        { name: "backup", status: "ONLINE", usedBytes: 500e9, totalBytes: 4e12 },
      ],
      disks: [
        { name: "sda", temperatureC: 34, smartPassed: true },
        { name: "sdb", temperatureC: 38, smartPassed: true },
        { name: "sdc", temperatureC: 52, smartPassed: false },
      ],
    });
    return;
  }

  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  // The reporting endpoint must be a POST with the query as the JSON body.
  // (Issuing a GET with a body does not reliably send the payload.) The window
  // and aggregation options go under the `query` attribute — NOT `reporting_query`.
  // A live SCALE 25.10 diagnostic confirmed the old `reporting_query` name is
  // rejected with HTTP 400 ("The following attributes are not expected:
  // reporting_query"), which is why CPU/RAM read 0 while pools still loaded.
  // The modern Netdata-based backend (SCALE 24.04+) also needs integer unix
  // `start`/`end` (seconds), not relative "now-30s" strings, and rejects a window
  // whose `end` is "now" (the most recent samples aren't collected yet) — so the
  // window must end slightly in the past. Request a short trailing window ending
  // a few seconds ago and aggregate it (working form: now-90s … now-30s).
  const nowSec = Math.floor(Date.now() / 1000);
  const reportingQuery = { start: nowSec - 90, end: nowSec - 30, aggregate: true };
  const reportingBody = {
    graphs: [{ name: "cpu" }, { name: "memory" }],
    query: reportingQuery,
  };
  // Network throughput + ZFS ARC stats live in the same reporting backend but are
  // requested as a SEPARATE call. The "interface" graph can require an identifier
  // on some installs and may be rejected; isolating it means a rejection only
  // drops the net/ARC extras instead of regressing the core CPU/RAM numbers.
  // The net/ARC extras want a short *series* over time (to draw sparklines), not
  // just a single aggregate, so they ride a longer trailing window with
  // aggregation OFF — each returned data row is then one time step. The same
  // "end in the past" rule applies (the most recent samples aren't collected
  // yet). The current value is taken from the last sample of the series.
  const extraReportingQuery = { start: nowSec - 1800, end: nowSec - 30, aggregate: false };
  const extraReportingBody = {
    graphs: [{ name: "interface" }, { name: "arcactualrate" }, { name: "arcsize" }],
    query: extraReportingQuery,
  };

  // The reporting (CPU/RAM), pool (storage) and disk-health (temperature +
  // SMART) calls are all independent. Settle them separately so one failing
  // source no longer blanks the whole tile — whatever data is available still
  // renders. The disk, SMART and net/ARC calls are purely additive: they never
  // count toward the 502 "unavailable" decision, which is reserved for a fully
  // unreachable server (both the reporting and pool calls failing).
  const [reportResult, poolResult, diskResult, smartResult, extraResult] = await Promise.allSettled([
    httpClient.post(`${baseUrl}/api/v2.0/reporting/get_data`, reportingBody, { headers }),
    httpClient.get(`${baseUrl}/api/v2.0/pool`, { headers }),
    httpClient.get(`${baseUrl}/api/v2.0/disk`, { headers }),
    httpClient.get(`${baseUrl}/api/v2.0/smart/test/results`, { headers }),
    httpClient.post(`${baseUrl}/api/v2.0/reporting/get_data`, extraReportingBody, { headers }),
  ]);

  if (reportResult.status === "rejected" && poolResult.status === "rejected") {
    logger.error(
      {
        reporting: normalizeHttpError(reportResult.reason),
        pool: normalizeHttpError(poolResult.reason),
      },
      "TrueNAS widget error (both reporting and pool failed)",
    );
    res.status(502).json({ error: "Failed to fetch TrueNAS data" });
    return;
  }

  // Partial data is fine: fall back to empty/zero values for whichever source
  // failed, and log a one-line reason naming the failed call.
  let reporting = { cpuPercent: 0, memUsedGb: 0, memTotalGb: 0 };
  if (reportResult.status === "fulfilled") {
    reporting = parseTruenasReporting(reportResult.value.data);
  } else {
    // Log the structured failure (incl. the upstream response body) so the
    // server's actual rejection reason is visible in the container logs, not
    // just a generic "Service responded with an error (422)." The exact request
    // window sent is logged too so the failure is fully reproducible.
    logger.error(
      {
        reason: normalizeHttpError(reportResult.reason),
        detail: describeHttpError(reportResult.reason),
        request: reportingBody,
      },
      "TrueNAS widget: reporting call failed (CPU/RAM unavailable)",
    );
  }

  let pools: ReturnType<typeof parseTruenasPools> = [];
  if (poolResult.status === "fulfilled") {
    pools = parseTruenasPools(poolResult.value.data);
  } else {
    logger.error(
      { reason: normalizeHttpError(poolResult.reason) },
      "TrueNAS widget: pool call failed (storage unavailable)",
    );
  }

  // Disk health (temperature + SMART) is best-effort and built from two
  // optional sources. A failure in either only drops that signal — temperatures
  // without SMART, or SMART without temperatures, still render usefully.
  const diskData = diskResult.status === "fulfilled" ? diskResult.value.data : undefined;
  const smartData = smartResult.status === "fulfilled" ? smartResult.value.data : undefined;
  if (diskResult.status === "rejected") {
    logger.error(
      { reason: normalizeHttpError(diskResult.reason) },
      "TrueNAS widget: disk call failed (temperatures unavailable)",
    );
  }
  if (smartResult.status === "rejected") {
    logger.error(
      { reason: normalizeHttpError(smartResult.reason) },
      "TrueNAS widget: SMART call failed (drive health unavailable)",
    );
  }
  const disks = parseTruenasDisks(diskData, smartData);

  // Network + ARC extras: additive. A rejected (or partial) extra reporting call
  // simply leaves these as null so the tile omits them — never a 502.
  let netArc = {
    netInMbps: null as number | null,
    netOutMbps: null as number | null,
    arcHitRatio: null as number | null,
    arcSizeGb: null as number | null,
    netInSeries: [] as number[],
    netOutSeries: [] as number[],
    arcHitSeries: [] as number[],
  };
  if (extraResult.status === "fulfilled") {
    netArc = parseTruenasNetArc(extraResult.value.data);
  } else {
    logger.error(
      {
        reason: normalizeHttpError(extraResult.reason),
        detail: describeHttpError(extraResult.reason),
        request: extraReportingBody,
      },
      "TrueNAS widget: network/ARC reporting call failed (extras unavailable)",
    );
  }

  res.json({ ...reporting, ...netArc, pools, disks });
});

// ────────────────────────────────────────────────
// TrueNAS reporting diagnostic
// ────────────────────────────────────────────────
// The reporting/get_data endpoint has been rejected on real SCALE installs while
// pools keep loading, and every prior fix was a blind guess at the request shape
// because we never captured what the live server actually says. This route makes
// the failure observable: it runs against the user's real NAS and returns, for
// each probe, the EXACT request that was sent and the raw outcome (HTTP status +
// full response body, success or error). The API key is never echoed.
//
// It probes several known-good request forms so the user can see, in one shot,
// which one this version accepts (integer unix window vs. unit/page, window
// ending in the past vs. at "now", aggregated vs. not), plus a GET of
// reporting/graphs to reveal the exact graph names + identifier requirements
// this version exposes. Read-only and auth-gated, so it is safe to leave in.

// Cap a raw upstream payload so a large reporting/graphs list (can be 100+
// graphs) doesn't bloat the diagnostic response. Arrays are sliced; deep objects
// are passed through (reporting errors are small). The cap is generous enough to
// keep every graph name visible.
function capDiagnosticBody(body: unknown): unknown {
  if (Array.isArray(body)) {
    const max = 200;
    return body.length > max
      ? [...body.slice(0, max), `…(${body.length - max} more items omitted)`]
      : body;
  }
  return body;
}

router.get("/truenas/diagnostics", requireAuth, async (_req, res) => {
  const saved = getSavedConnection("truenas");
  const baseUrl = saved.url || process.env["TRUENAS_URL"];
  const apiKey = saved.apiKey || process.env["TRUENAS_API_KEY"];

  if (!baseUrl || !apiKey) {
    // No sample data here — a diagnostic on an unconfigured service is
    // meaningless. Tell the caller plainly so they configure TrueNAS first.
    res.status(409).json({
      configured: false,
      message:
        "TrueNAS is not configured. Save a TrueNAS URL and API key first, then run this diagnostic from the LAN box that can reach the NAS.",
    });
    return;
  }

  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const getDataUrl = `${baseUrl}/api/v2.0/reporting/get_data`;
  const nowSec = Math.floor(Date.now() / 1000);

  // Candidate query forms to try for the core cpu/memory call. The time window
  // and aggregation options ride the `query` attribute (this SCALE version
  // rejects the old `reporting_query` name with HTTP 400). The form the server
  // accepts (HTTP 200 with graph data) is the one the widget uses; the rest
  // surface the server's own rejection reason in their body. The probes also
  // reveal the real response shape (legend names) so the parser can be verified.
  const coreGraphs = [{ name: "cpu" }, { name: "memory" }];
  const candidates: Array<{ label: string; body: unknown }> = [
    {
      label: "cpu+memory, aggregated, unix window ending in the past (now-90s … now-30s) — the form the widget uses",
      body: { graphs: coreGraphs, query: { start: nowSec - 90, end: nowSec - 30, aggregate: true } },
    },
    {
      label: "cpu+memory, aggregated, unix window ending at now (now-90s … now)",
      body: { graphs: coreGraphs, query: { start: nowSec - 90, end: nowSec, aggregate: true } },
    },
    {
      label: "cpu+memory, unit/page form (unit=HOUR, page=1), aggregated",
      body: { graphs: coreGraphs, query: { unit: "HOUR", page: 1, aggregate: true } },
    },
    {
      label: "cpu+memory, non-aggregated series (now-1800s … now-30s)",
      body: { graphs: coreGraphs, query: { start: nowSec - 1800, end: nowSec - 30, aggregate: false } },
    },
    {
      label: "extras (interface, arcsize), non-aggregated series — interface may need an identifier",
      body: {
        graphs: [{ name: "interface" }, { name: "arcsize" }],
        query: { start: nowSec - 1800, end: nowSec - 30, aggregate: false },
      },
    },
  ];

  // Run a single POST probe, capturing the request and the raw outcome. Both the
  // success body and the error body are preserved so the server's actual reason
  // is copyable. Never includes headers (would leak the API key).
  async function probePost(label: string, body: unknown) {
    try {
      const r = await httpClient.post(getDataUrl, body, { headers });
      return {
        label,
        request: { method: "POST", url: getDataUrl, body },
        ok: true as const,
        status: r.status,
        response: capDiagnosticBody(r.data),
      };
    } catch (err) {
      return {
        label,
        request: { method: "POST", url: getDataUrl, body },
        ok: false as const,
        ...describeHttpError(err),
        body: capDiagnosticBody(describeHttpError(err).body),
      };
    }
  }

  // GET reporting/graphs reveals the exact graph names + identifier requirements
  // this version exposes — invaluable when a graph name we hard-code no longer
  // exists or now requires an identifier.
  const graphsUrl = `${baseUrl}/api/v2.0/reporting/graphs`;
  async function probeGraphsList() {
    try {
      const r = await httpClient.get(graphsUrl, { headers });
      return {
        label: "available reporting graphs (GET /reporting/graphs)",
        request: { method: "GET", url: graphsUrl },
        ok: true as const,
        status: r.status,
        response: capDiagnosticBody(r.data),
      };
    } catch (err) {
      return {
        label: "available reporting graphs (GET /reporting/graphs)",
        request: { method: "GET", url: graphsUrl },
        ok: false as const,
        ...describeHttpError(err),
        body: capDiagnosticBody(describeHttpError(err).body),
      };
    }
  }

  const probes = await Promise.all([
    probeGraphsList(),
    ...candidates.map((c) => probePost(c.label, c.body)),
  ]);

  res.json({ configured: true, baseUrl, serverTimeUnixSec: nowSec, probes });
});

// ────────────────────────────────────────────────
// Media Server Widget (Plex or Jellyfin)
// ────────────────────────────────────────────────
router.get("/media", requireAuth, async (req, res) => {
  // Which media server backs this tile. "jellyfin" reads the saved Jellyfin
  // connection; anything else (the default) reads the saved Plex connection.
  const server = req.query["server"] === "jellyfin" ? "jellyfin" : "plex";

  let serverType: string;
  let baseUrl: string | undefined;
  let apiKey: string | undefined;

  if (server === "jellyfin") {
    // Jellyfin uses a base URL + API key, both stored on the jellyfin
    // connection. Fall back to the env-configured media server only when no
    // Jellyfin connection is saved.
    const saved = getSavedConnection("jellyfin");
    serverType = "jellyfin";
    baseUrl = saved.url;
    apiKey = saved.apiKey;
    if (!baseUrl || !apiKey) {
      const envType = process.env["MEDIA_SERVER_TYPE"] || "jellyfin";
      if (envType === "jellyfin") {
        baseUrl = process.env["MEDIA_SERVER_URL"];
        apiKey = process.env["MEDIA_SERVER_API_KEY"];
      }
    }
  } else {
    // Plex uses a base URL + token (the token may be stored under `token` or
    // `apiKey`). Fall back to a Plex-typed env media server when unsaved.
    const saved = getSavedConnection("plex");
    const savedToken = saved.token || saved.apiKey;
    serverType = "plex";
    if (saved.url && savedToken) {
      baseUrl = saved.url;
      apiKey = savedToken;
    } else {
      const envType = process.env["MEDIA_SERVER_TYPE"] || "jellyfin";
      if (envType === "plex") {
        baseUrl = process.env["MEDIA_SERVER_URL"];
        apiKey = process.env["MEDIA_SERVER_API_KEY"];
      }
    }
  }

  if (!baseUrl || !apiKey) {
    // Sample items carry a demo deep link so the poster/title click-through can
    // be tested before a real Plex server is connected.
    res.json([
      { id: "1", title: "The Last of Us", type: "show", year: 2023, thumb: null, addedAt: new Date().toISOString(), url: plexDeepLink(SAMPLE_PLEX_MACHINE_ID, "1") },
      { id: "2", title: "Oppenheimer", type: "movie", year: 2023, thumb: null, addedAt: new Date().toISOString(), url: plexDeepLink(SAMPLE_PLEX_MACHINE_ID, "2") },
      { id: "3", title: "Severance", type: "show", year: 2022, thumb: null, addedAt: new Date().toISOString(), url: plexDeepLink(SAMPLE_PLEX_MACHINE_ID, "3") },
    ]);
    return;
  }

  try {
    if (serverType === "jellyfin") {
      // The /Items list omits the ServerId needed for web deep links, so resolve
      // it from /System/Info in parallel. fetchJellyfinServerId swallows its own
      // errors → if it can't be resolved, deep links fall back to null but the
      // tile still renders (additive — never a 502 from the server-id call).
      const [r, serverId] = await Promise.all([
        httpClient.get(`${baseUrl}/Items`, {
          params: {
            SortBy: "DateCreated",
            SortOrder: "Descending",
            IncludeItemTypes: "Movie,Episode,Series",
            Limit: 6,
            Recursive: true,
            Fields: "PrimaryImageAspectRatio,DateCreated",
            ImageTypeLimit: 1,
            EnableImageTypes: "Primary,Thumb",
            api_key: apiKey,
          },
        }),
        fetchJellyfinServerId(baseUrl, apiKey),
      ]);
      const items = (r.data?.Items ?? []).map((item: { Id: string; Name: string; Type: string; ProductionYear?: number; ImageTags?: { Primary?: string }; DateCreated?: string; SeriesName?: string; ParentIndexNumber?: number; IndexNumber?: number }) => {
        const type = item.Type.toLowerCase();
        // Jellyfin episodes carry the show name in SeriesName; build an SxxEyy
        // season label when the numbers are available.
        const seriesName = type === "episode" ? item.SeriesName ?? null : null;
        const seasonLabel =
          type === "episode" && item.ParentIndexNumber != null && item.IndexNumber != null
            ? `S${item.ParentIndexNumber}E${item.IndexNumber}`
            : null;
        return {
          id: item.Id,
          title: item.Name,
          type,
          year: item.ProductionYear ?? null,
          thumb: item.ImageTags?.Primary
            ? `${baseUrl}/Items/${item.Id}/Images/Primary?api_key=${apiKey}&maxHeight=200`
            : null,
          addedAt: item.DateCreated ?? null,
          seriesName,
          seasonLabel,
          url: jellyfinDeepLink(baseUrl, serverId, item.Id),
        };
      });
      res.json(items);
    } else {
      // Plex — recently added items. The token rides as the X-Plex-Token header
      // and is also appended to thumbnail URLs so the browser can load them.
      // The server's machineIdentifier (needed for app.plex.tv deep links) is
      // NOT included on the recentlyAdded container, so fetch it from /identity
      // in parallel. fetchPlexMachineId swallows its own errors → if it can't be
      // resolved, deep links fall back to null but the tile still renders.
      const [r, machineId] = await Promise.all([
        httpClient.get(`${baseUrl}/library/recentlyAdded`, {
          headers: { "X-Plex-Token": apiKey, Accept: "application/json" },
        }),
        fetchPlexMachineId(baseUrl, apiKey),
      ]);
      const items = (r.data?.MediaContainer?.Metadata ?? []).slice(0, 6).map(
        (item: {
          ratingKey: string;
          title: string;
          type: string;
          year?: number;
          thumb?: string;
          addedAt?: number;
          parentTitle?: string;
          grandparentTitle?: string;
          index?: number;
        }) => {
          // Plex "recently added" returns seasons for TV (type "season", with the
          // show name in parentTitle and a "Season N" title) or episodes (show
          // name in grandparentTitle). Surface the show name + a season label so
          // the tile shows e.g. "Severance · Season 2" instead of just "Season 1".
          let seriesName: string | null = null;
          let seasonLabel: string | null = null;
          if (item.type === "season") {
            seriesName = item.parentTitle ?? null;
            seasonLabel = item.title ?? null;
          } else if (item.type === "episode") {
            seriesName = item.grandparentTitle ?? null;
            seasonLabel = item.parentTitle ?? null;
          }
          return {
            id: String(item.ratingKey),
            title: item.title,
            type: item.type,
            year: item.year ?? null,
            thumb: item.thumb ? `${baseUrl}${item.thumb}?X-Plex-Token=${apiKey}` : null,
            addedAt: item.addedAt ? new Date(item.addedAt * 1000).toISOString() : null,
            seriesName,
            seasonLabel,
            url: plexDeepLink(machineId, item.ratingKey),
          };
        },
      );
      res.json(items);
    }
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Media widget error");
    res.status(502).json({ error: "Failed to fetch media data" });
  }
});

// ────────────────────────────────────────────────
// Continue Watching Widget (Plex On Deck)
// ────────────────────────────────────────────────
router.get("/media/continue", requireAuth, async (req, res) => {
  // Which media server backs this tile. "jellyfin" reads the saved Jellyfin
  // connection (Resume items); anything else (the default) reads the saved Plex
  // connection (On Deck).
  const server = req.query["server"] === "jellyfin" ? "jellyfin" : "plex";

  let serverType: string;
  let baseUrl: string | undefined;
  let apiKey: string | undefined;

  if (server === "jellyfin") {
    // Jellyfin uses a base URL + API key, both stored on the jellyfin
    // connection. Fall back to the env-configured media server only when no
    // Jellyfin connection is saved.
    const saved = getSavedConnection("jellyfin");
    serverType = "jellyfin";
    baseUrl = saved.url;
    apiKey = saved.apiKey;
    if (!baseUrl || !apiKey) {
      const envType = process.env["MEDIA_SERVER_TYPE"] || "jellyfin";
      if (envType === "jellyfin") {
        baseUrl = process.env["MEDIA_SERVER_URL"];
        apiKey = process.env["MEDIA_SERVER_API_KEY"];
      }
    }
  } else {
    // Plex uses a base URL + token (stored under `token` or `apiKey`). Fall back
    // to a Plex-typed env media server when unsaved.
    const saved = getSavedConnection("plex");
    const savedToken = saved.token || saved.apiKey;
    serverType = "plex";
    if (saved.url && savedToken) {
      baseUrl = saved.url;
      apiKey = savedToken;
    } else {
      const envType = process.env["MEDIA_SERVER_TYPE"] || "jellyfin";
      if (envType === "plex") {
        baseUrl = process.env["MEDIA_SERVER_URL"];
        apiKey = process.env["MEDIA_SERVER_API_KEY"];
      }
    }
  }

  // Unconfigured → return built-in sample data so the tile has something to
  // show, consistent with the /media convention.
  if (!baseUrl || !apiKey) {
    // Sample items carry a demo deep link so the poster/title click-through can
    // be tested before a real media server is connected.
    res.json([
      { id: "1", title: "Chapter 7", type: "episode", seriesName: "Severance", thumb: null, progress: 42, url: plexDeepLink(SAMPLE_PLEX_MACHINE_ID, "1") },
      { id: "2", title: "Dune: Part Two", type: "movie", seriesName: null, thumb: null, progress: 18, url: plexDeepLink(SAMPLE_PLEX_MACHINE_ID, "2") },
    ]);
    return;
  }

  // Jellyfin: the resume fetch has its OWN try/catch so a resume failure is
  // additive — it degrades to an empty list (200) rather than a 502, per the
  // tile contract (Continue Watching is a supplementary section that must never
  // take the tile down). The Plex On Deck path below keeps its 502-on-failure
  // behavior unchanged.
  if (serverType === "jellyfin") {
    try {
      // Jellyfin exposes resume/in-progress items via /Items/Resume. The list
      // omits the ServerId needed for web deep links, so resolve it from
      // /System/Info in parallel. fetchJellyfinServerId swallows its own errors
      // → deep links fall back to null but the tile still renders (additive —
      // never a 502 from the server-id call alone).
      const [r, serverId] = await Promise.all([
        httpClient.get(`${baseUrl}/Items/Resume`, {
          params: {
            IncludeItemTypes: "Movie,Episode",
            Limit: 12,
            Recursive: true,
            Fields: "PrimaryImageAspectRatio",
            ImageTypeLimit: 1,
            EnableImageTypes: "Primary,Thumb",
            api_key: apiKey,
          },
        }),
        fetchJellyfinServerId(baseUrl, apiKey),
      ]);
      const items = (r.data?.Items ?? []).map(
        (item: {
          Id: string;
          Name: string;
          Type: string;
          SeriesName?: string;
          ImageTags?: { Primary?: string };
          SeriesId?: string;
          SeriesPrimaryImageTag?: string;
          UserData?: { PlaybackPositionTicks?: number };
          RunTimeTicks?: number;
        }) => {
          const type = item.Type.toLowerCase();
          // Episodes carry the show name in SeriesName. Progress is the played
          // fraction (PlaybackPositionTicks / RunTimeTicks), as a 0–100 percent.
          const seriesName = type === "episode" ? item.SeriesName ?? null : null;
          const positionTicks = item.UserData?.PlaybackPositionTicks;
          const progress =
            positionTicks != null && item.RunTimeTicks
              ? Math.round((positionTicks / item.RunTimeTicks) * 100)
              : null;
          // Prefer the item's own primary image; for episodes fall back to the
          // series poster when the episode has no still of its own.
          let thumb: string | null = null;
          if (item.ImageTags?.Primary) {
            thumb = `${baseUrl}/Items/${item.Id}/Images/Primary?api_key=${apiKey}&maxHeight=200`;
          } else if (item.SeriesId && item.SeriesPrimaryImageTag) {
            thumb = `${baseUrl}/Items/${item.SeriesId}/Images/Primary?api_key=${apiKey}&maxHeight=200`;
          }
          return {
            id: item.Id,
            title: item.Name,
            type,
            seriesName,
            thumb,
            progress,
            url: jellyfinDeepLink(baseUrl, serverId, item.Id),
          };
        },
      );
      res.json(items);
    } catch (err) {
      // Additive: a Jellyfin resume failure never 502s — the tile keeps its
      // other sections (e.g. Recently Added) and just shows no resume items.
      logger.error({ reason: normalizeHttpError(err) }, "Jellyfin continue watching widget error");
      res.json([]);
    }
    return;
  }

  try {
    // The onDeck container omits the server's machineIdentifier, so resolve it
    // from /identity in parallel to build app.plex.tv deep links. The identity
    // fetch swallows its own errors → deep links fall back to null on failure
    // while the tile still renders (never a 502 from the identity call alone).
    const [r, machineId] = await Promise.all([
      httpClient.get(`${baseUrl}/library/onDeck`, {
        headers: { "X-Plex-Token": apiKey, Accept: "application/json" },
      }),
      fetchPlexMachineId(baseUrl, apiKey),
    ]);
    const items = (r.data?.MediaContainer?.Metadata ?? []).map(
      (item: {
        ratingKey: string;
        title: string;
        type: string;
        thumb?: string;
        grandparentThumb?: string;
        grandparentTitle?: string;
        viewOffset?: number;
        duration?: number;
      }) => {
        // Episodes carry the show name in grandparentTitle. Progress is the
        // played fraction (viewOffset / duration), as a 0–100 percentage.
        const seriesName = item.type === "episode" ? item.grandparentTitle ?? null : null;
        const progress =
          item.viewOffset != null && item.duration
            ? Math.round((item.viewOffset / item.duration) * 100)
            : null;
        const thumbPath = item.thumb || item.grandparentThumb;
        return {
          id: String(item.ratingKey),
          title: item.title,
          type: item.type ?? null,
          seriesName,
          thumb: thumbPath ? `${baseUrl}${thumbPath}?X-Plex-Token=${apiKey}` : null,
          progress,
          url: plexDeepLink(machineId, item.ratingKey),
        };
      },
    );
    res.json(items);
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Continue watching widget error");
    res.status(502).json({ error: "Failed to fetch continue watching data" });
  }
});

// ────────────────────────────────────────────────
// Audio Player Widget
// ────────────────────────────────────────────────
// Backs the Audio Player tile. The shared client-side playback engine streams
// the returned tracks; this endpoint only resolves the source's now-playing
// track and a browser-playable queue. "source" selects the backing service —
// only "plex" exists today; it is the seam Spotify/Jellyfin/Navidrome plug into.

// A single Plex track row (from /status/sessions or a library listing) mapped to
// the AudioTrack shape. `live` carries Player.state + viewOffset for the active
// session's now-playing track; library/queue entries pass live:false so state
// and progressMs stay null (they are not a live session).
interface PlexTrackRow {
  ratingKey?: string | number;
  title?: string;
  grandparentTitle?: string;
  parentTitle?: string;
  thumb?: string;
  parentThumb?: string;
  grandparentThumb?: string;
  duration?: number;
  viewOffset?: number;
  Player?: { state?: string };
  Media?: { Part?: { key?: string }[] }[];
}

function mapPlexTrack(
  item: PlexTrackRow,
  baseUrl: string,
  token: string,
  live: boolean,
) {
  const thumbPath = item.thumb || item.parentThumb || item.grandparentThumb;
  const partKey = item.Media?.[0]?.Part?.[0]?.key;
  return {
    id: String(item.ratingKey ?? ""),
    title: item.title ?? "Unknown track",
    artist: item.grandparentTitle ?? null,
    album: item.parentTitle ?? null,
    artwork: thumbPath ? `${baseUrl}${thumbPath}?X-Plex-Token=${token}` : null,
    durationMs: typeof item.duration === "number" ? item.duration : null,
    progressMs: live && typeof item.viewOffset === "number" ? item.viewOffset : null,
    state: live ? item.Player?.state ?? null : null,
    streamUrl: partKey ? `${baseUrl}${partKey}?X-Plex-Token=${token}` : null,
  };
}

// A single Jellyfin audio item as returned by /Items, /Sessions
// (NowPlayingItem), or an album's children. Only the fields the Audio Player
// tile needs are modeled.
interface JellyfinAudioItem {
  Id?: string;
  Name?: string;
  Type?: string;
  Artists?: string[];
  AlbumArtist?: string;
  Album?: string;
  AlbumId?: string;
  RunTimeTicks?: number;
  ImageTags?: { Primary?: string };
  AlbumPrimaryImageTag?: string;
}

// Map a Jellyfin audio item to the shared AudioTrack shape. Jellyfin reports
// durations/offsets in "ticks" (100-nanosecond units → 10,000 ticks per ms).
// `live` carries the active session's PlayState (position + paused) when this is
// the now-playing track; pass null for plain queue/recent entries. streamUrl
// uses the .mp3 transcode endpoint so the browser's <audio> element can play it
// directly regardless of the source file's codec (e.g. FLAC).
const JELLYFIN_TICKS_PER_MS = 10_000;
function mapJellyfinTrack(
  item: JellyfinAudioItem,
  baseUrl: string,
  apiKey: string,
  live: { positionTicks?: number; isPaused?: boolean } | null,
) {
  const id = String(item.Id ?? "");
  const artist =
    (item.Artists ?? []).filter(Boolean).join(", ") || item.AlbumArtist || null;
  // Prefer the track's own primary image; fall back to the album's artwork.
  let artwork: string | null = null;
  if (item.ImageTags?.Primary) {
    artwork = `${baseUrl}/Items/${id}/Images/Primary?api_key=${apiKey}&maxHeight=200`;
  } else if (item.AlbumId && item.AlbumPrimaryImageTag) {
    artwork = `${baseUrl}/Items/${item.AlbumId}/Images/Primary?api_key=${apiKey}&maxHeight=200`;
  }
  return {
    id,
    title: item.Name ?? "Unknown track",
    artist,
    album: item.Album ?? null,
    artwork,
    durationMs:
      typeof item.RunTimeTicks === "number"
        ? Math.round(item.RunTimeTicks / JELLYFIN_TICKS_PER_MS)
        : null,
    progressMs:
      live && typeof live.positionTicks === "number"
        ? Math.round(live.positionTicks / JELLYFIN_TICKS_PER_MS)
        : null,
    state: live ? (live.isPaused ? "paused" : "playing") : null,
    streamUrl: id
      ? `${baseUrl}/Audio/${id}/stream.mp3?api_key=${apiKey}&audioCodec=mp3`
      : null,
  };
}

// Resolve the saved Jellyfin connection (base URL + API key), falling back to a
// Jellyfin-typed env media server when none is saved — mirrors the /media route.
function resolveJellyfinAudioConnection(): {
  baseUrl: string | undefined;
  apiKey: string | undefined;
} {
  const saved = getSavedConnection("jellyfin");
  let baseUrl = saved.url;
  let apiKey = saved.apiKey;
  if (!baseUrl || !apiKey) {
    const envType = process.env["MEDIA_SERVER_TYPE"] || "jellyfin";
    if (envType === "jellyfin") {
      baseUrl = process.env["MEDIA_SERVER_URL"];
      apiKey = process.env["MEDIA_SERVER_API_KEY"];
    }
  }
  return { baseUrl, apiKey };
}

// Audio Player — Jellyfin source. Reads the saved Jellyfin connection, returns
// the current music session (with progress) when one is playing, otherwise the
// most recently added music tracks. Each real track carries an authenticated,
// browser-playable .mp3 stream URL so the shared <audio> engine can play it.
async function handleJellyfinAudio(res: import("express").Response): Promise<void> {
  const { baseUrl, apiKey } = resolveJellyfinAudioConnection();

  // Unconfigured → built-in demo content (sample:true). streamUrl stays null so
  // the tile labels it not-live and disables in-browser streaming.
  if (!baseUrl || !apiKey) {
    const demo = [
      { id: "1", title: "Dreams", artist: "Fleetwood Mac", album: "Rumours", artwork: null, durationMs: 257_000, progressMs: 72_000, state: "playing", streamUrl: null },
      { id: "2", title: "The Chain", artist: "Fleetwood Mac", album: "Rumours", artwork: null, durationMs: 271_000, progressMs: null, state: null, streamUrl: null },
      { id: "3", title: "Go Your Own Way", artist: "Fleetwood Mac", album: "Rumours", artwork: null, durationMs: 218_000, progressMs: null, state: null, streamUrl: null },
    ];
    res.json({ source: "jellyfin", sample: true, nowPlaying: demo[0], queue: demo });
    return;
  }

  try {
    // Prefer the active music session: /Sessions lists everything playing now;
    // pick the first whose NowPlayingItem is an Audio track. Its album becomes
    // the queue so skip next/previous works.
    const sessions = await httpClient.get(`${baseUrl}/Sessions`, {
      params: { api_key: apiKey },
    });
    const session = (sessions.data ?? []).find(
      (s: { NowPlayingItem?: { Type?: string } }) =>
        s?.NowPlayingItem?.Type === "Audio",
    ) as
      | {
          NowPlayingItem?: JellyfinAudioItem;
          PlayState?: { PositionTicks?: number; IsPaused?: boolean };
        }
      | undefined;

    if (session?.NowPlayingItem) {
      const npItem = session.NowPlayingItem;
      const playState = session.PlayState ?? {};
      const nowPlaying = mapJellyfinTrack(npItem, baseUrl, apiKey, {
        positionTicks: playState.PositionTicks,
        isPaused: playState.IsPaused,
      });
      // Best-effort: fetch the album's tracks for skip next/previous. A failure
      // here is additive — the queue degrades to just the now-playing track.
      let queue = [nowPlaying];
      if (npItem.AlbumId) {
        try {
          const album = await httpClient.get(`${baseUrl}/Items`, {
            params: {
              ParentId: npItem.AlbumId,
              IncludeItemTypes: "Audio",
              Recursive: true,
              SortBy: "ParentIndexNumber,IndexNumber,SortName",
              api_key: apiKey,
            },
          });
          const tracks = (album.data?.Items ?? []) as JellyfinAudioItem[];
          if (tracks.length > 0) {
            queue = tracks.map((t) => mapJellyfinTrack(t, baseUrl, apiKey, null));
          }
        } catch (err) {
          logger.warn({ reason: normalizeHttpError(err) }, "Jellyfin album queue fetch failed — using now-playing only");
        }
      }
      res.json({ source: "jellyfin", sample: false, nowPlaying, queue });
      return;
    }

    // No active session → fall back to the most recently added music tracks.
    const recent = await httpClient.get(`${baseUrl}/Items`, {
      params: {
        IncludeItemTypes: "Audio",
        SortBy: "DateCreated",
        SortOrder: "Descending",
        Recursive: true,
        Limit: 25,
        api_key: apiKey,
      },
    });
    const tracks = (recent.data?.Items ?? []) as JellyfinAudioItem[];
    const queue = tracks.map((t) => mapJellyfinTrack(t, baseUrl, apiKey, null));
    res.json({ source: "jellyfin", sample: false, nowPlaying: queue[0] ?? null, queue });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Jellyfin audio player widget error");
    res.status(502).json({ error: "Failed to fetch audio player data" });
  }
}

// Map a Spotify track object to the shared AudioTrack shape. Spotify never gives
// a direct stream URL (playback is remote or via the Web Playback SDK), so
// streamUrl is always null — the tile drives it through command endpoints / SDK
// instead of the shared <audio> engine.
function mapSpotifyTrack(item: SpotifyTrackObject, playback: SpotifyPlayback | null): {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  artwork: string | null;
  durationMs: number | null;
  progressMs: number | null;
  state: string | null;
  streamUrl: null;
} {
  const artist = (item.artists ?? []).map((a) => a.name).filter(Boolean).join(", ") || null;
  const artwork = item.album?.images?.[0]?.url ?? null;
  return {
    id: item.id ?? "",
    title: item.name ?? "Unknown track",
    artist,
    album: item.album?.name ?? null,
    artwork,
    durationMs: typeof item.duration_ms === "number" ? item.duration_ms : null,
    progressMs: playback && typeof playback.progress_ms === "number" ? playback.progress_ms : null,
    state: playback ? (playback.is_playing ? "playing" : "paused") : null,
    streamUrl: null,
  };
}

async function handleSpotifyAudio(res: import("express").Response): Promise<void> {
  const conn = getSpotifyConnection();
  const linked = Boolean(conn.clientId && conn.clientSecret && conn.tokens.refreshToken);

  // Not linked → an actionable "connect" state rather than demo content, so the
  // tile prompts the user to link their account in Settings.
  if (!linked) {
    res.json({
      source: "spotify",
      sample: false,
      auth: "needed",
      premium: null,
      canControl: false,
      device: null,
      nowPlaying: null,
      queue: [],
    });
    return;
  }

  try {
    const token = await getValidAccessToken();
    // Premium gates in-browser playback; failure here shouldn't break the tile.
    let premium: boolean | null = null;
    try {
      premium = (await getProfile(token)).premium;
    } catch {
      premium = null;
    }

    const playback = await getPlayback(token);
    if (!playback || !playback.item) {
      res.json({
        source: "spotify",
        sample: false,
        auth: "connected",
        premium,
        canControl: false,
        device: null,
        nowPlaying: null,
        queue: [],
      });
      return;
    }

    const nowPlaying = mapSpotifyTrack(playback.item, playback);
    const device = playback.device
      ? {
          id: playback.device.id ?? null,
          name: playback.device.name ?? "Unknown device",
          isActive: Boolean(playback.device.is_active),
          volumePercent:
            typeof playback.device.volume_percent === "number"
              ? playback.device.volume_percent
              : null,
        }
      : null;

    // The upcoming queue is additive — degrade to just now-playing on failure.
    let queue = [nowPlaying];
    try {
      const upcoming = await getQueue(token);
      queue = [nowPlaying, ...upcoming.map((t) => mapSpotifyTrack(t, null))];
    } catch (err) {
      logger.warn({ reason: normalizeHttpError(err) }, "Spotify queue fetch failed — using now-playing only");
    }

    res.json({
      source: "spotify",
      sample: false,
      auth: "connected",
      premium,
      canControl: Boolean(device),
      device,
      nowPlaying,
      queue,
    });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Spotify audio player widget error");
    res.status(502).json({ error: "Failed to fetch Spotify playback" });
  }
}

// Map a Subsonic song to the shared AudioTrack shape. Subsonic reports
// durations in whole seconds (→ ms). It exposes no real playback cursor; the
// caller may pass an estimated `progressMs` derived from a now-playing entry's
// `minutesAgo` (see estimateSubsonicProgressMs), otherwise it stays null.
// Artwork and stream URLs embed the request's salted-token auth so the browser
// can load them directly; the stream uses `format=mp3` so the shared <audio>
// engine plays any source codec (FLAC etc.). `live` marks the now-playing entry
// so its state reads as "playing".
function mapSubsonicTrack(
  song: SubsonicSong,
  baseUrl: string,
  mediaQuery: string,
  live: boolean,
  progressMs: number | null = null,
) {
  const id = String(song.id ?? "");
  const coverArt = song.coverArt ?? song.albumId;
  return {
    id,
    title: song.title ?? "Unknown track",
    artist: song.artist ?? null,
    album: song.album ?? null,
    artwork: coverArt
      ? `${baseUrl}/rest/getCoverArt.view?id=${encodeURIComponent(coverArt)}&size=300&${mediaQuery}`
      : null,
    durationMs: typeof song.duration === "number" ? song.duration * 1000 : null,
    progressMs,
    state: live ? "playing" : null,
    streamUrl: id
      ? `${baseUrl}/rest/stream.view?id=${encodeURIComponent(id)}&format=mp3&${mediaQuery}`
      : null,
  };
}

// Estimate a live playback offset for a now-playing entry. Subsonic exposes no
// real playback cursor — only `minutesAgo`, how long ago the server last
// registered the track as playing (whole minutes). We treat that as the elapsed
// time since the track started and clamp it to the track length so a stale entry
// never overruns the progress bar. Absent/invalid → null, so the tile falls back
// to its previous behaviour (no progress) gracefully.
function estimateSubsonicProgressMs(song: SubsonicSong): number | null {
  if (typeof song.minutesAgo !== "number" || !Number.isFinite(song.minutesAgo)) {
    return null;
  }
  const elapsedMs = Math.max(0, song.minutesAgo) * 60_000;
  const durationMs = typeof song.duration === "number" ? song.duration * 1000 : null;
  return durationMs != null ? Math.min(elapsedMs, durationMs) : elapsedMs;
}

// Audio Player — Navidrome / Subsonic source. Reuses the saved `subsonic`
// connection (base URL + username/password, salted-token auth). Returns the
// most recent now-playing entry when one exists, otherwise the newest album's
// tracks. Each real track carries an authenticated, browser-playable .mp3 stream
// URL so the shared <audio> engine can play it.
async function handleSubsonicAudio(res: import("express").Response): Promise<void> {
  const saved = getSavedConnection("subsonic");
  const baseUrl = saved.url;
  const username = saved.username;
  const password = saved.password;

  // Unconfigured → built-in demo content (sample:true). streamUrl stays null so
  // the tile labels it not-live and disables in-browser streaming.
  if (!baseUrl || !username || !password) {
    const demo = [
      { id: "1", title: "Dreams", artist: "Fleetwood Mac", album: "Rumours", artwork: null, durationMs: 257_000, progressMs: 72_000, state: "playing", streamUrl: null },
      { id: "2", title: "The Chain", artist: "Fleetwood Mac", album: "Rumours", artwork: null, durationMs: 271_000, progressMs: null, state: null, streamUrl: null },
      { id: "3", title: "Go Your Own Way", artist: "Fleetwood Mac", album: "Rumours", artwork: null, durationMs: 218_000, progressMs: null, state: null, streamUrl: null },
    ];
    res.json({ source: "subsonic", sample: true, nowPlaying: demo[0], queue: demo });
    return;
  }

  try {
    const auth = subsonicAuthParams(username, password);
    const mediaQuery = subsonicMediaQuery(auth);

    // Prefer the most recent now-playing entry. getNowPlaying returns
    // nowPlaying.entry as an array (or a single object on some servers).
    const np = await subsonicGet(baseUrl, "getNowPlaying.view", auth);
    const rawEntries = (np["nowPlaying"] as { entry?: unknown } | undefined)?.entry;
    const entries = (
      Array.isArray(rawEntries) ? rawEntries : rawEntries ? [rawEntries] : []
    ) as SubsonicSong[];

    if (entries.length > 0) {
      const current = entries[0]!;
      const progressMs = estimateSubsonicProgressMs(current);
      const nowPlaying = mapSubsonicTrack(current, baseUrl, mediaQuery, true, progressMs);
      // Best-effort: the now-playing track's album becomes the queue so skip
      // next/previous works. A failure here is additive — the queue degrades to
      // just the now-playing track.
      let queue = [nowPlaying];
      if (current.albumId) {
        try {
          const albumBody = await subsonicGet(baseUrl, "getAlbum.view", auth, {
            id: current.albumId,
          });
          const songs = ((albumBody["album"] as { song?: SubsonicSong[] } | undefined)?.song ??
            []) as SubsonicSong[];
          if (songs.length > 0) {
            queue = songs.map((s) => mapSubsonicTrack(s, baseUrl, mediaQuery, false));
          }
        } catch (err) {
          logger.warn(
            { reason: normalizeHttpError(err) },
            "Subsonic album queue fetch failed — using now-playing only",
          );
        }
      }
      res.json({ source: "subsonic", sample: false, nowPlaying, queue });
      return;
    }

    // Nothing playing → fall back to the newest album's tracks.
    const listBody = await subsonicGet(baseUrl, "getAlbumList2.view", auth, {
      type: "newest",
      size: 1,
    });
    const albums = ((listBody["albumList2"] as { album?: Array<{ id?: string }> } | undefined)
      ?.album ?? []) as Array<{ id?: string }>;
    const newestId = albums[0]?.id;
    if (!newestId) {
      // Configured but no albums — honest empty state, not demo content.
      res.json({ source: "subsonic", sample: false, nowPlaying: null, queue: [] });
      return;
    }
    const albumBody = await subsonicGet(baseUrl, "getAlbum.view", auth, { id: newestId });
    const songs = ((albumBody["album"] as { song?: SubsonicSong[] } | undefined)?.song ??
      []) as SubsonicSong[];
    const queue = songs.map((s) => mapSubsonicTrack(s, baseUrl, mediaQuery, false));
    res.json({ source: "subsonic", sample: false, nowPlaying: queue[0] ?? null, queue });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Subsonic audio player widget error");
    res.status(502).json({ error: "Failed to fetch audio player data" });
  }
}

// POST /widgets/subsonic/scrobble — report a play back to Navidrome / Subsonic.
// While the dashboard's own <audio> engine streams a Subsonic track, the
// frontend pings this with submission=false ("now playing") and, on completion,
// submission=true (a real scrobble). That makes the dashboard show up as a live
// session and feeds play counts for other Subsonic clients — closing the loop
// with the read-only progress the tile already surfaces. Reuses the saved
// `subsonic` connection + salted-token auth. Failures are surfaced as errors but
// the caller treats them as non-fatal so playback never breaks.
router.post("/subsonic/scrobble", requireAuth, async (req, res) => {
  const body = (req.body ?? {}) as { id?: unknown; submission?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    res.status(400).json({ error: "A track id is required" });
    return;
  }
  const submission = body.submission === true;

  const saved = getSavedConnection("subsonic");
  const baseUrl = saved.url;
  const username = saved.username;
  const password = saved.password;
  if (!baseUrl || !username || !password) {
    res.status(404).json({ error: "No Subsonic / Navidrome connection is configured" });
    return;
  }

  try {
    const auth = subsonicAuthParams(username, password);
    // scrobble.view returns an empty ok envelope; subsonicGet throws on a failed
    // status, so a thrown error here means the server rejected the scrobble.
    await subsonicGet(baseUrl, "scrobble.view", auth, {
      id,
      submission: submission ? "true" : "false",
    });
    res.json({ ok: true });
  } catch (err) {
    logger.warn(
      { reason: normalizeHttpError(err), submission },
      "Subsonic scrobble failed",
    );
    res.status(502).json({ error: "Failed to report play to Subsonic" });
  }
});

router.get("/audioplayer", requireAuth, async (req, res) => {
  // Source selects the music backend. Spotify uses the linked OAuth account;
  // anything else resolves to Plex (the original/default source).
  const requested = String(req.query["source"] ?? "plex");
  if (requested === "spotify") {
    await handleSpotifyAudio(res);
    return;
  }
  if (requested === "jellyfin") {
    await handleJellyfinAudio(res);
    return;
  }
  if (requested === "subsonic") {
    await handleSubsonicAudio(res);
    return;
  }
  const source = "plex";

  // Plex stores the token under `token` or `apiKey`. Fall back to a Plex-typed
  // env media server when no Plex connection is saved (mirrors /media).
  const saved = getSavedConnection("plex");
  const savedToken = saved.token || saved.apiKey;
  let baseUrl: string | undefined;
  let token: string | undefined;
  if (saved.url && savedToken) {
    baseUrl = saved.url;
    token = savedToken;
  } else {
    const envType = process.env["MEDIA_SERVER_TYPE"] || "jellyfin";
    if (envType === "plex") {
      baseUrl = process.env["MEDIA_SERVER_URL"];
      token = process.env["MEDIA_SERVER_API_KEY"];
    }
  }

  // Unconfigured → built-in demo content (sample:true). streamUrl stays null so
  // the tile labels it not-live and disables in-browser streaming.
  if (!baseUrl || !token) {
    const demo = [
      { id: "1", title: "Dreams", artist: "Fleetwood Mac", album: "Rumours", artwork: null, durationMs: 257_000, progressMs: 72_000, state: "playing", streamUrl: null },
      { id: "2", title: "The Chain", artist: "Fleetwood Mac", album: "Rumours", artwork: null, durationMs: 271_000, progressMs: null, state: null, streamUrl: null },
      { id: "3", title: "Go Your Own Way", artist: "Fleetwood Mac", album: "Rumours", artwork: null, durationMs: 218_000, progressMs: null, state: null, streamUrl: null },
    ];
    res.json({ source, sample: true, nowPlaying: demo[0], queue: demo });
    return;
  }

  try {
    // Prefer the active music session: /status/sessions lists everything playing
    // now; pick the first audio track. When one exists, the queue is its album.
    const sessions = await httpClient.get(`${baseUrl}/status/sessions`, {
      headers: { "X-Plex-Token": token, Accept: "application/json" },
    });
    const session = (sessions.data?.MediaContainer?.Metadata ?? []).find(
      (m: { type?: string }) => m.type === "track",
    ) as (PlexTrackRow & { parentRatingKey?: string | number }) | undefined;

    if (session) {
      const nowPlaying = mapPlexTrack(session, baseUrl, token, true);
      // Best-effort: fetch the album's tracks for skip next/previous. A failure
      // here is additive — the queue degrades to just the now-playing track.
      let queue = [nowPlaying];
      if (session.parentRatingKey != null) {
        try {
          const album = await httpClient.get(
            `${baseUrl}/library/metadata/${session.parentRatingKey}/children`,
            { headers: { "X-Plex-Token": token, Accept: "application/json" } },
          );
          const tracks = (album.data?.MediaContainer?.Metadata ?? []) as PlexTrackRow[];
          if (tracks.length > 0) {
            queue = tracks.map((t) => mapPlexTrack(t, baseUrl!, token!, false));
          }
        } catch (err) {
          logger.warn({ reason: normalizeHttpError(err) }, "Plex album queue fetch failed — using now-playing only");
        }
      }
      res.json({ source, sample: false, nowPlaying, queue });
      return;
    }

    // No active session → fall back to the most recently added music tracks.
    // Locate the music library section (type "artist"), then list its tracks
    // (type=10) newest-first. nowPlaying is the first of that list.
    const sections = await httpClient.get(`${baseUrl}/library/sections`, {
      headers: { "X-Plex-Token": token, Accept: "application/json" },
    });
    const musicSection = (sections.data?.MediaContainer?.Directory ?? []).find(
      (d: { type?: string }) => d.type === "artist",
    ) as { key?: string } | undefined;

    if (!musicSection?.key) {
      // Configured but no music library — return an empty, non-sample payload so
      // the tile shows an honest empty state rather than demo content.
      res.json({ source, sample: false, nowPlaying: null, queue: [] });
      return;
    }

    const recent = await httpClient.get(
      `${baseUrl}/library/sections/${musicSection.key}/all`,
      {
        headers: { "X-Plex-Token": token, Accept: "application/json" },
        params: { type: 10, sort: "addedAt:desc", "X-Plex-Container-Size": 25 },
      },
    );
    const tracks = (recent.data?.MediaContainer?.Metadata ?? []) as PlexTrackRow[];
    const queue = tracks.map((t) => mapPlexTrack(t, baseUrl!, token!, false));
    res.json({ source, sample: false, nowPlaying: queue[0] ?? null, queue });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Audio player widget error");
    res.status(502).json({ error: "Failed to fetch audio player data" });
  }
});

// ────────────────────────────────────────────────
// Audio Player — library navigation (search / browse / playlists)
// ────────────────────────────────────────────────
// Backs the pop-out music browser on Plex and Navidrome / Subsonic Audio Player
// tiles. These read-only endpoints let the user find music to play: search by
// name, browse the library (recently added, albums, artists with drill-down),
// and pick from existing playlists. Anything playable is returned in the same
// AudioTrack shape the shared playback engine already consumes; containers
// (artists / albums / playlists) carry an id the client drills into via the
// browse endpoint. Mirrors the existing widget conventions: built-in demo data
// when unconfigured (sample:true, streamUrl null), HTTP 502 on a configured
// source that fails.

// A container (artist / album / playlist) the user can drill into. `kind` tells
// the client how to expand it; `id` is the source identifier used for browse.
interface AudioContainer {
  id: string;
  kind: "artist" | "album" | "playlist";
  title: string;
  subtitle: string | null;
  artwork: string | null;
}

// A directory/listing row from Plex (artist, album, or playlist). Plex returns
// these under MediaContainer.Metadata (and occasionally Directory) with a per-
// item `type` field. Only the fields the browser needs are modeled.
interface PlexDirRow {
  ratingKey?: string | number;
  title?: string;
  parentTitle?: string;
  thumb?: string;
  composite?: string;
  leafCount?: number;
  childCount?: number;
}

// Resolve the Plex base URL + token for music browsing, mirroring the
// /audioplayer route: prefer the saved Plex connection, fall back to a
// Plex-typed env media server. Returns null when neither is configured.
function resolvePlexAudioConnection(): { baseUrl: string; token: string } | null {
  const saved = getSavedConnection("plex");
  const savedToken = saved.token || saved.apiKey;
  if (saved.url && savedToken) return { baseUrl: saved.url, token: savedToken };
  const envType = process.env["MEDIA_SERVER_TYPE"] || "jellyfin";
  if (envType === "plex") {
    const baseUrl = process.env["MEDIA_SERVER_URL"];
    const token = process.env["MEDIA_SERVER_API_KEY"];
    if (baseUrl && token) return { baseUrl, token };
  }
  return null;
}

function plexArtwork(
  path: string | undefined,
  baseUrl: string,
  token: string,
): string | null {
  return path ? `${baseUrl}${path}?X-Plex-Token=${token}` : null;
}

function mapPlexArtist(d: PlexDirRow, baseUrl: string, token: string): AudioContainer {
  return {
    id: String(d.ratingKey ?? ""),
    kind: "artist",
    title: d.title ?? "Unknown artist",
    subtitle: typeof d.childCount === "number" ? `${d.childCount} albums` : null,
    artwork: plexArtwork(d.thumb, baseUrl, token),
  };
}

function mapPlexAlbum(d: PlexDirRow, baseUrl: string, token: string): AudioContainer {
  return {
    id: String(d.ratingKey ?? ""),
    kind: "album",
    title: d.title ?? "Unknown album",
    subtitle: d.parentTitle ?? null,
    artwork: plexArtwork(d.thumb, baseUrl, token),
  };
}

function mapPlexPlaylist(d: PlexDirRow, baseUrl: string, token: string): AudioContainer {
  return {
    id: String(d.ratingKey ?? ""),
    kind: "playlist",
    title: d.title ?? "Untitled playlist",
    subtitle: typeof d.leafCount === "number" ? `${d.leafCount} tracks` : null,
    artwork: plexArtwork(d.composite ?? d.thumb, baseUrl, token),
  };
}

// GET a Plex endpoint and return its MediaContainer.Metadata rows (or []).
async function plexMetadata(
  baseUrl: string,
  token: string,
  path: string,
  params?: Record<string, unknown>,
): Promise<Array<PlexDirRow & PlexTrackRow>> {
  const r = await httpClient.get(`${baseUrl}${path}`, {
    headers: { "X-Plex-Token": token, Accept: "application/json" },
    ...(params ? { params } : {}),
  });
  return (r.data?.MediaContainer?.Metadata ?? []) as Array<PlexDirRow & PlexTrackRow>;
}

// Locate the Plex music library section key (the "artist"-type section). Returns
// null when the server has no music library.
async function findPlexMusicSectionKey(
  baseUrl: string,
  token: string,
): Promise<string | null> {
  const sections = await httpClient.get(`${baseUrl}/library/sections`, {
    headers: { "X-Plex-Token": token, Accept: "application/json" },
  });
  const musicSection = (sections.data?.MediaContainer?.Directory ?? []).find(
    (d: { type?: string }) => d.type === "artist",
  ) as { key?: string } | undefined;
  return musicSection?.key ?? null;
}

// ── Subsonic library listing rows ────────────────────────────────────────────
interface SubsonicAlbum {
  id?: string;
  name?: string;
  title?: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
}
interface SubsonicArtist {
  id?: string;
  name?: string;
  coverArt?: string;
  albumCount?: number;
}
interface SubsonicPlaylist {
  id?: string;
  name?: string;
  coverArt?: string;
  songCount?: number;
}

function subsonicCover(
  coverArt: string | undefined,
  baseUrl: string,
  mediaQuery: string,
): string | null {
  return coverArt
    ? `${baseUrl}/rest/getCoverArt.view?id=${encodeURIComponent(coverArt)}&size=300&${mediaQuery}`
    : null;
}

function mapSubsonicAlbum(
  a: SubsonicAlbum,
  baseUrl: string,
  mediaQuery: string,
): AudioContainer {
  return {
    id: String(a.id ?? ""),
    kind: "album",
    title: a.name ?? a.title ?? "Unknown album",
    subtitle: a.artist ?? null,
    artwork: subsonicCover(a.coverArt ?? a.id, baseUrl, mediaQuery),
  };
}

function mapSubsonicArtist(
  a: SubsonicArtist,
  baseUrl: string,
  mediaQuery: string,
): AudioContainer {
  return {
    id: String(a.id ?? ""),
    kind: "artist",
    title: a.name ?? "Unknown artist",
    subtitle: typeof a.albumCount === "number" ? `${a.albumCount} albums` : null,
    artwork: subsonicCover(a.coverArt, baseUrl, mediaQuery),
  };
}

function mapSubsonicPlaylist(
  p: SubsonicPlaylist,
  baseUrl: string,
  mediaQuery: string,
): AudioContainer {
  return {
    id: String(p.id ?? ""),
    kind: "playlist",
    title: p.name ?? "Untitled playlist",
    subtitle: typeof p.songCount === "number" ? `${p.songCount} tracks` : null,
    artwork: subsonicCover(p.coverArt ?? p.id, baseUrl, mediaQuery),
  };
}

// Built-in demo content for the browser when a source is unconfigured. Mirrors
// the demo now-playing payload: streamUrl null so nothing is actually playable.
const DEMO_TRACKS = [
  { id: "1", title: "Dreams", artist: "Fleetwood Mac", album: "Rumours", artwork: null, durationMs: 257_000, progressMs: null, state: null, streamUrl: null },
  { id: "2", title: "The Chain", artist: "Fleetwood Mac", album: "Rumours", artwork: null, durationMs: 271_000, progressMs: null, state: null, streamUrl: null },
  { id: "3", title: "Go Your Own Way", artist: "Fleetwood Mac", album: "Rumours", artwork: null, durationMs: 218_000, progressMs: null, state: null, streamUrl: null },
];
const DEMO_ALBUMS: AudioContainer[] = [
  { id: "d-album-1", kind: "album", title: "Rumours", subtitle: "Fleetwood Mac", artwork: null },
  { id: "d-album-2", kind: "album", title: "Hounds of Love", subtitle: "Kate Bush", artwork: null },
];
const DEMO_ARTISTS: AudioContainer[] = [
  { id: "d-artist-1", kind: "artist", title: "Fleetwood Mac", subtitle: "5 albums", artwork: null },
  { id: "d-artist-2", kind: "artist", title: "Kate Bush", subtitle: "3 albums", artwork: null },
];
const DEMO_PLAYLISTS: AudioContainer[] = [
  { id: "d-playlist-1", kind: "playlist", title: "Chill Mix", subtitle: "12 tracks", artwork: null },
  { id: "d-playlist-2", kind: "playlist", title: "Workout", subtitle: "20 tracks", artwork: null },
];

// Demo result for the search endpoint when unconfigured.
function demoSearchResult(source: string) {
  return {
    source,
    sample: true,
    artists: DEMO_ARTISTS,
    albums: DEMO_ALBUMS,
    tracks: DEMO_TRACKS,
  };
}

// Demo result for the browse endpoint when unconfigured, shaped per kind.
function demoBrowseResult(source: string, kind: string) {
  if (kind === "artists") return { source, sample: true, artists: DEMO_ARTISTS };
  if (kind === "playlists") return { source, sample: true, playlists: DEMO_PLAYLISTS };
  if (kind === "artist") return { source, sample: true, albums: DEMO_ALBUMS };
  if (kind === "album" || kind === "playlist" || kind === "random") {
    return { source, sample: true, tracks: DEMO_TRACKS };
  }
  // recent / albums
  return { source, sample: true, albums: DEMO_ALBUMS };
}

// ── Plex search / browse handlers ────────────────────────────────────────────
async function plexSearchLibrary(
  res: import("express").Response,
  query: string,
): Promise<void> {
  const conn = resolvePlexAudioConnection();
  if (!conn) {
    res.json(demoSearchResult("plex"));
    return;
  }
  if (!query) {
    res.json({ source: "plex", sample: false, artists: [], albums: [], tracks: [] });
    return;
  }
  try {
    const r = await httpClient.get(`${conn.baseUrl}/hubs/search`, {
      headers: { "X-Plex-Token": conn.token, Accept: "application/json" },
      params: { query, limit: 30 },
    });
    const hubs = (r.data?.MediaContainer?.Hub ?? []) as Array<{
      type?: string;
      Metadata?: Array<PlexDirRow & PlexTrackRow & { type?: string }>;
      Directory?: Array<PlexDirRow & { type?: string }>;
    }>;
    const artists: AudioContainer[] = [];
    const albums: AudioContainer[] = [];
    const tracks: ReturnType<typeof mapPlexTrack>[] = [];
    for (const hub of hubs) {
      const items = hub.Metadata ?? hub.Directory ?? [];
      for (const item of items) {
        const t = item.type ?? hub.type;
        if (t === "artist") artists.push(mapPlexArtist(item, conn.baseUrl, conn.token));
        else if (t === "album") albums.push(mapPlexAlbum(item, conn.baseUrl, conn.token));
        else if (t === "track") {
          tracks.push(mapPlexTrack(item as PlexTrackRow, conn.baseUrl, conn.token, false));
        }
      }
    }
    res.json({
      source: "plex",
      sample: false,
      artists: artists.slice(0, 20),
      albums: albums.slice(0, 20),
      tracks: tracks.slice(0, 30),
    });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Plex music search error");
    res.status(502).json({ error: "Failed to search the music library" });
  }
}

async function plexBrowseLibrary(
  res: import("express").Response,
  kind: string,
  id: string,
): Promise<void> {
  const conn = resolvePlexAudioConnection();
  if (!conn) {
    res.json(demoBrowseResult("plex", kind));
    return;
  }
  const { baseUrl, token } = conn;
  try {
    // Drill-down kinds operate on a specific container id.
    if (kind === "artist") {
      const rows = await plexMetadata(baseUrl, token, `/library/metadata/${encodeURIComponent(id)}/children`);
      res.json({ source: "plex", sample: false, albums: rows.map((d) => mapPlexAlbum(d, baseUrl, token)) });
      return;
    }
    if (kind === "album") {
      const rows = await plexMetadata(baseUrl, token, `/library/metadata/${encodeURIComponent(id)}/children`);
      res.json({ source: "plex", sample: false, tracks: rows.map((t) => mapPlexTrack(t, baseUrl, token, false)) });
      return;
    }
    if (kind === "playlist") {
      const rows = await plexMetadata(baseUrl, token, `/playlists/${encodeURIComponent(id)}/items`);
      res.json({ source: "plex", sample: false, tracks: rows.map((t) => mapPlexTrack(t, baseUrl, token, false)) });
      return;
    }
    if (kind === "playlists") {
      const rows = await plexMetadata(baseUrl, token, `/playlists`, { playlistType: "audio" });
      res.json({ source: "plex", sample: false, playlists: rows.map((d) => mapPlexPlaylist(d, baseUrl, token)) });
      return;
    }

    // Top-level library listings need the music section key.
    const sectionKey = await findPlexMusicSectionKey(baseUrl, token);
    if (!sectionKey) {
      res.json({ source: "plex", sample: false, albums: [], artists: [] });
      return;
    }
    if (kind === "random") {
      const rows = await plexMetadata(baseUrl, token, `/library/sections/${sectionKey}/all`, {
        type: 10,
        sort: "random",
        "X-Plex-Container-Size": 20,
      });
      res.json({ source: "plex", sample: false, tracks: rows.map((t) => mapPlexTrack(t, baseUrl, token, false)) });
      return;
    }
    if (kind === "artists") {
      const rows = await plexMetadata(baseUrl, token, `/library/sections/${sectionKey}/all`, {
        type: 8,
        sort: "titleSort",
        "X-Plex-Container-Size": 100,
      });
      res.json({ source: "plex", sample: false, artists: rows.map((d) => mapPlexArtist(d, baseUrl, token)) });
      return;
    }
    // recent or albums
    const params =
      kind === "recent"
        ? { type: 9, sort: "addedAt:desc", "X-Plex-Container-Size": 40 }
        : { type: 9, sort: "titleSort", "X-Plex-Container-Size": 100 };
    const rows = await plexMetadata(baseUrl, token, `/library/sections/${sectionKey}/all`, params);
    res.json({ source: "plex", sample: false, albums: rows.map((d) => mapPlexAlbum(d, baseUrl, token)) });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err), kind }, "Plex music browse error");
    res.status(502).json({ error: "Failed to browse the music library" });
  }
}

// ── Subsonic search / browse handlers ────────────────────────────────────────
function subsonicConn() {
  const saved = getSavedConnection("subsonic");
  if (!saved.url || !saved.username || !saved.password) return null;
  return { baseUrl: saved.url, username: saved.username, password: saved.password };
}

async function subsonicSearchLibrary(
  res: import("express").Response,
  query: string,
): Promise<void> {
  const conn = subsonicConn();
  if (!conn) {
    res.json(demoSearchResult("subsonic"));
    return;
  }
  if (!query) {
    res.json({ source: "subsonic", sample: false, artists: [], albums: [], tracks: [] });
    return;
  }
  try {
    const auth = subsonicAuthParams(conn.username, conn.password);
    const mediaQuery = subsonicMediaQuery(auth);
    const body = await subsonicGet(conn.baseUrl, "search3.view", auth, {
      query,
      artistCount: 20,
      albumCount: 20,
      songCount: 30,
    });
    const result = (body["searchResult3"] ?? {}) as {
      artist?: SubsonicArtist[];
      album?: SubsonicAlbum[];
      song?: SubsonicSong[];
    };
    res.json({
      source: "subsonic",
      sample: false,
      artists: (result.artist ?? []).map((a) => mapSubsonicArtist(a, conn.baseUrl, mediaQuery)),
      albums: (result.album ?? []).map((a) => mapSubsonicAlbum(a, conn.baseUrl, mediaQuery)),
      tracks: (result.song ?? []).map((s) => mapSubsonicTrack(s, conn.baseUrl, mediaQuery, false)),
    });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Subsonic music search error");
    res.status(502).json({ error: "Failed to search the music library" });
  }
}

async function subsonicBrowseLibrary(
  res: import("express").Response,
  kind: string,
  id: string,
): Promise<void> {
  const conn = subsonicConn();
  if (!conn) {
    res.json(demoBrowseResult("subsonic", kind));
    return;
  }
  try {
    const auth = subsonicAuthParams(conn.username, conn.password);
    const mediaQuery = subsonicMediaQuery(auth);
    const { baseUrl } = conn;

    if (kind === "artist") {
      const body = await subsonicGet(baseUrl, "getArtist.view", auth, { id });
      const albums = ((body["artist"] as { album?: SubsonicAlbum[] } | undefined)?.album ?? []);
      res.json({ source: "subsonic", sample: false, albums: albums.map((a) => mapSubsonicAlbum(a, baseUrl, mediaQuery)) });
      return;
    }
    if (kind === "album") {
      const body = await subsonicGet(baseUrl, "getAlbum.view", auth, { id });
      const songs = ((body["album"] as { song?: SubsonicSong[] } | undefined)?.song ?? []);
      res.json({ source: "subsonic", sample: false, tracks: songs.map((s) => mapSubsonicTrack(s, baseUrl, mediaQuery, false)) });
      return;
    }
    if (kind === "playlist") {
      const body = await subsonicGet(baseUrl, "getPlaylist.view", auth, { id });
      const entries = ((body["playlist"] as { entry?: SubsonicSong[] } | undefined)?.entry ?? []);
      res.json({ source: "subsonic", sample: false, tracks: entries.map((s) => mapSubsonicTrack(s, baseUrl, mediaQuery, false)) });
      return;
    }
    if (kind === "playlists") {
      const body = await subsonicGet(baseUrl, "getPlaylists.view", auth);
      const lists = ((body["playlists"] as { playlist?: SubsonicPlaylist[] } | undefined)?.playlist ?? []);
      res.json({ source: "subsonic", sample: false, playlists: lists.map((p) => mapSubsonicPlaylist(p, baseUrl, mediaQuery)) });
      return;
    }
    if (kind === "artists") {
      const body = await subsonicGet(baseUrl, "getArtists.view", auth);
      const indexes = ((body["artists"] as { index?: Array<{ artist?: SubsonicArtist[] }> } | undefined)?.index ?? []);
      const artists = indexes.flatMap((i) => i.artist ?? []);
      res.json({ source: "subsonic", sample: false, artists: artists.map((a) => mapSubsonicArtist(a, baseUrl, mediaQuery)) });
      return;
    }
    if (kind === "random") {
      const body = await subsonicGet(baseUrl, "getRandomSongs.view", auth, { size: 20 });
      const songs = ((body["randomSongs"] as { song?: SubsonicSong[] } | undefined)?.song ?? []);
      res.json({ source: "subsonic", sample: false, tracks: songs.map((s) => mapSubsonicTrack(s, baseUrl, mediaQuery, false)) });
      return;
    }
    // recent or albums
    const type = kind === "recent" ? "newest" : "alphabeticalByName";
    const size = kind === "recent" ? 40 : 100;
    const body = await subsonicGet(baseUrl, "getAlbumList2.view", auth, { type, size });
    const albums = ((body["albumList2"] as { album?: SubsonicAlbum[] } | undefined)?.album ?? []);
    res.json({ source: "subsonic", sample: false, albums: albums.map((a) => mapSubsonicAlbum(a, baseUrl, mediaQuery)) });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err), kind }, "Subsonic music browse error");
    res.status(502).json({ error: "Failed to browse the music library" });
  }
}

// GET /widgets/audioplayer/search — search a source's library by name. Returns
// artists, albums, and playable tracks for the pop-out music browser.
router.get("/audioplayer/search", requireAuth, async (req, res) => {
  const source = String(req.query["source"] ?? "plex");
  const query = String(req.query["query"] ?? "").trim();
  if (source === "subsonic") {
    await subsonicSearchLibrary(res, query);
    return;
  }
  await plexSearchLibrary(res, query);
});

// GET /widgets/audioplayer/browse — list a source's library / playlists, with
// drill-down (artist→albums, album→tracks, playlist→tracks).
const BROWSE_KINDS = ["recent", "albums", "artists", "artist", "album", "playlists", "playlist", "random"];
const BROWSE_KINDS_NEEDING_ID = ["artist", "album", "playlist"];
router.get("/audioplayer/browse", requireAuth, async (req, res) => {
  const source = String(req.query["source"] ?? "plex");
  const kind = String(req.query["kind"] ?? "");
  const id = String(req.query["id"] ?? "").trim();
  if (!BROWSE_KINDS.includes(kind)) {
    res.status(400).json({ error: "Unknown browse kind" });
    return;
  }
  if (BROWSE_KINDS_NEEDING_ID.includes(kind) && !id) {
    res.status(400).json({ error: `kind=${kind} requires an id` });
    return;
  }
  if (source === "subsonic") {
    await subsonicBrowseLibrary(res, kind, id);
    return;
  }
  await plexBrowseLibrary(res, kind, id);
});

// POST /widgets/spotify/command — remote-control the active Spotify device.
// Backs the Audio Player tile's play/pause/skip buttons and the "transfer"
// action that hands playback to the in-browser Web Playback SDK device.
const SPOTIFY_ACTIONS: SpotifyCommand[] = ["play", "pause", "next", "previous", "transfer"];

router.post("/spotify/command", requireAuth, async (req, res) => {
  const body = (req.body ?? {}) as { action?: string; deviceId?: string | null };
  const action = body.action as SpotifyCommand | undefined;
  if (!action || !SPOTIFY_ACTIONS.includes(action)) {
    res.status(400).json({ error: "Unknown action" });
    return;
  }
  if (action === "transfer" && !body.deviceId) {
    res.status(400).json({ error: "transfer requires a deviceId" });
    return;
  }

  const conn = getSpotifyConnection();
  if (!conn.clientId || !conn.clientSecret || !conn.tokens.refreshToken) {
    res.status(404).json({ error: "Spotify account is not linked" });
    return;
  }

  try {
    const token = await getValidAccessToken();
    const result = await sendCommand(token, action, body.deviceId ?? undefined);
    if (result === "no-device") {
      res.status(404).json({ error: "No active Spotify device" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Spotify command error");
    res.status(502).json({ error: "Failed to control Spotify" });
  }
});

// ────────────────────────────────────────────────
// Sonarr Widget
// ────────────────────────────────────────────────
router.get("/sonarr", requireAuth, async (_req, res) => {
  const saved = getSavedConnection("sonarr");
  const baseUrl = saved.url || process.env["SONARR_URL"];
  const apiKey = saved.apiKey || process.env["SONARR_API_KEY"];

  if (!baseUrl || !apiKey) {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);
    res.json({
      queue: [
        { id: 1, title: "The Bear - S03E01", status: "downloading", progress: 67.3, size: 1.2e9 },
        { id: 2, title: "House of the Dragon - S02E04", status: "paused", progress: 0, size: 2.1e9 },
      ],
      upcoming: [
        { id: 101, title: "Episode 5", seriesTitle: "The Bear", airDate: tomorrow.toISOString().split("T")[0]!, seasonNumber: 3, episodeNumber: 5 },
        { id: 102, title: "Pilot", seriesTitle: "Andor", airDate: now.toISOString().split("T")[0]!, seasonNumber: 2, episodeNumber: 1 },
      ],
    });
    return;
  }

  try {
    const headers = { "X-Api-Key": apiKey };
    const now = new Date();
    const end = new Date(now.getTime() + 7 * 86400000);

    const [queueRes, calendarRes] = await Promise.all([
      // includeEpisode/includeSeries so each queue record carries the show and
      // episode info; queue is paged and returns its rows under `records`.
      httpClient.get(`${baseUrl}/api/v3/queue`, {
        headers,
        params: { pageSize: 50, includeEpisode: true, includeSeries: true },
      }),
      // includeSeries so the calendar entries carry the series title (otherwise
      // the upcoming list renders blank titles).
      httpClient.get(`${baseUrl}/api/v3/calendar`, {
        headers,
        params: {
          start: now.toISOString().split("T")[0],
          end: end.toISOString().split("T")[0],
          includeSeries: true,
        },
      }),
    ]);

    const queue = (queueRes.data?.records ?? []).slice(0, 5).map((item: { id: number; title: string; status: string; sizeleft?: number; size?: number; series?: { title: string } }) => ({
      id: item.id,
      title: item.series?.title ?? item.title,
      status: item.status,
      progress: item.size ? Math.round((1 - (item.sizeleft ?? 0) / item.size) * 100) : 0,
      size: item.size ?? null,
    }));

    const upcoming = (calendarRes.data ?? []).slice(0, 5).map((ep: { id: number; title: string; series?: { title: string }; airDateUtc?: string; seasonNumber?: number; episodeNumber?: number }) => ({
      id: ep.id,
      title: ep.title,
      seriesTitle: ep.series?.title ?? "",
      airDate: ep.airDateUtc?.split("T")[0] ?? "",
      seasonNumber: ep.seasonNumber ?? null,
      episodeNumber: ep.episodeNumber ?? null,
    }));

    res.json({ queue, upcoming });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Sonarr widget error");
    res.status(502).json({ error: "Failed to fetch Sonarr data" });
  }
});

// ────────────────────────────────────────────────
// Radarr Widget
// ────────────────────────────────────────────────
router.get("/radarr", requireAuth, async (_req, res) => {
  const saved = getSavedConnection("radarr");
  const baseUrl = saved.url || process.env["RADARR_URL"];
  const apiKey = saved.apiKey || process.env["RADARR_API_KEY"];

  if (!baseUrl || !apiKey) {
    const now = new Date();
    const soon = new Date(now.getTime() + 3 * 86400000);
    res.json({
      queue: [
        { id: 1, title: "Dune: Part Two", status: "downloading", progress: 42.1, size: 8.4e9 },
        { id: 2, title: "The Batman", status: "paused", progress: 0, size: 6.0e9 },
      ],
      upcoming: [
        { id: 201, title: "Furiosa", releaseDate: soon.toISOString().split("T")[0]!, year: 2024 },
        { id: 202, title: "Deadpool & Wolverine", releaseDate: now.toISOString().split("T")[0]!, year: 2024 },
      ],
    });
    return;
  }

  try {
    const headers = { "X-Api-Key": apiKey };
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 86400000);

    const [queueRes, calendarRes] = await Promise.all([
      // includeMovie so each queue record carries the movie title; paged rows
      // live under `records`.
      httpClient.get(`${baseUrl}/api/v3/queue`, {
        headers,
        params: { pageSize: 50, includeMovie: true },
      }),
      // includeMovie so calendar entries carry the movie details/titles.
      httpClient.get(`${baseUrl}/api/v3/calendar`, {
        headers,
        params: {
          start: now.toISOString().split("T")[0],
          end: end.toISOString().split("T")[0],
          includeMovie: true,
        },
      }),
    ]);

    const queue = (queueRes.data?.records ?? []).slice(0, 5).map((item: { id: number; title: string; status: string; sizeleft?: number; size?: number; movie?: { title: string } }) => ({
      id: item.id,
      title: item.movie?.title ?? item.title,
      status: item.status,
      progress: item.size ? Math.round((1 - (item.sizeleft ?? 0) / item.size) * 100) : 0,
      size: item.size ?? null,
    }));

    const upcoming = (calendarRes.data ?? []).slice(0, 5).map((m: { id: number; title: string; year?: number; inCinemas?: string; physicalRelease?: string; digitalRelease?: string }) => {
      const release = m.digitalRelease || m.physicalRelease || m.inCinemas || "";
      return {
        id: m.id,
        title: m.title,
        releaseDate: release ? release.split("T")[0] : "",
        year: m.year ?? null,
      };
    });

    res.json({ queue, upcoming });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Radarr widget error");
    res.status(502).json({ error: "Failed to fetch Radarr data" });
  }
});

// ────────────────────────────────────────────────
// Lidarr Widget
// ────────────────────────────────────────────────
router.get("/lidarr", requireAuth, async (_req, res) => {
  const saved = getSavedConnection("lidarr");
  const baseUrl = saved.url || process.env["LIDARR_URL"];
  const apiKey = saved.apiKey || process.env["LIDARR_API_KEY"];

  if (!baseUrl || !apiKey) {
    const now = new Date();
    const soon = new Date(now.getTime() + 5 * 86400000);
    res.json({
      queue: [
        { id: 1, title: "Tame Impala - Currents", status: "downloading", progress: 58.0, size: 4.2e8 },
        { id: 2, title: "Radiohead - In Rainbows", status: "paused", progress: 0, size: 3.6e8 },
      ],
      upcoming: [
        { id: 301, title: "The New Album", artistName: "Bonobo", releaseDate: soon.toISOString().split("T")[0]! },
        { id: 302, title: "Live Sessions", artistName: "Khruangbin", releaseDate: now.toISOString().split("T")[0]! },
      ],
    });
    return;
  }

  try {
    // Lidarr's API lives under /api/v1/ (not /api/v3/ like Sonarr/Radarr).
    const headers = { "X-Api-Key": apiKey };
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 86400000);

    const [queueRes, calendarRes] = await Promise.all([
      // includeArtist/includeAlbum so each queue record carries the artist and
      // album info; queue is paged and returns its rows under `records`.
      httpClient.get(`${baseUrl}/api/v1/queue`, {
        headers,
        params: { pageSize: 50, includeArtist: true, includeAlbum: true },
      }),
      // includeArtist so calendar entries carry the artist name (otherwise the
      // upcoming list renders blank artists).
      httpClient.get(`${baseUrl}/api/v1/calendar`, {
        headers,
        params: {
          start: now.toISOString().split("T")[0],
          end: end.toISOString().split("T")[0],
          includeArtist: true,
        },
      }),
    ]);

    const queue = (queueRes.data?.records ?? []).slice(0, 5).map((item: { id: number; title: string; status: string; sizeleft?: number; size?: number; artist?: { artistName: string } }) => ({
      id: item.id,
      title: item.artist?.artistName ?? item.title,
      status: item.status,
      progress: item.size ? Math.round((1 - (item.sizeleft ?? 0) / item.size) * 100) : 0,
      size: item.size ?? null,
    }));

    const upcoming = (calendarRes.data ?? []).slice(0, 5).map((album: { id: number; title: string; artist?: { artistName: string }; releaseDate?: string }) => ({
      id: album.id,
      title: album.title,
      artistName: album.artist?.artistName ?? "",
      releaseDate: album.releaseDate?.split("T")[0] ?? "",
    }));

    res.json({ queue, upcoming });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Lidarr widget error");
    res.status(502).json({ error: "Failed to fetch Lidarr data" });
  }
});

// ────────────────────────────────────────────────
// qBittorrent Widget
// ────────────────────────────────────────────────
// qBittorrent uses session-cookie auth: log in to obtain the session cookie,
// then reuse it for every subsequent call. The cookie is named "SID" in v4 but
// was renamed to "QBT_SID_<port>" in v5.x, so match either and return the full
// "name=value" pair to send back verbatim.
function extractSessionCookie(setCookie: string[] | undefined): string | undefined {
  for (const cookie of setCookie ?? []) {
    const match = /((?:QBT_)?SID(?:_\d+)?)=([^;]+)/.exec(cookie);
    if (match) return `${match[1]}=${match[2]}`;
  }
  return undefined;
}

// qBittorrent bans clients that log in too frequently, and the tile polls every
// ~10s. Cache the SID per connection (keyed by baseUrl + username) and reuse it
// across polls, re-authenticating only when the session has expired (403) or no
// session is cached yet.
const qbSidCache = new Map<string, string>();

function qbCacheKey(baseUrl: string, username: string): string {
  return `${baseUrl}\u0000${username}`;
}

// Log in to qBittorrent, cache the resulting SID, and return it. Throws a tagged
// error when authentication is rejected or no session cookie is returned.
async function qbLogin(baseUrl: string, username: string, password: string): Promise<string> {
  const form = new URLSearchParams({ username, password });
  const loginRes = await httpClient.post(`${baseUrl}/api/v2/auth/login`, form.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (typeof loginRes.data === "string" && loginRes.data.trim() === "Fails.") {
    throw new Error("qb-auth-failed");
  }

  const sid = extractSessionCookie(loginRes.headers["set-cookie"] as string[] | undefined);
  if (!sid) {
    throw new Error("qb-no-session");
  }

  qbSidCache.set(qbCacheKey(baseUrl, username), sid);
  return sid;
}

function isAuthError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "response" in err &&
    (err as { response?: { status?: number } }).response?.status === 403
  );
}

router.get("/qbittorrent", requireAuth, async (_req, res) => {
  const saved = getSavedConnection("qbittorrent");
  const baseUrl = normalizeBaseUrl(saved.url || process.env["QBITTORRENT_URL"]);
  const username = saved.username || process.env["QBITTORRENT_USERNAME"];
  const password = saved.password ?? process.env["QBITTORRENT_PASSWORD"];

  if (!baseUrl || !username || password == null) {
    res.json({
      torrents: [
        { name: "ubuntu-24.04-desktop-amd64.iso", progress: 73.5, state: "downloading", dlSpeed: 5.2e6, upSpeed: 1.1e5, category: "Linux ISOs" },
        { name: "archlinux-x86_64.iso", progress: 100, state: "uploading", dlSpeed: 0, upSpeed: 8.4e5, category: "Linux ISOs" },
        { name: "Blender Open Movie - Sintel (2010)", progress: 100, state: "uploading", dlSpeed: 0, upSpeed: 2.3e5, category: "Movies" },
      ],
      downloadSpeed: 5.2e6,
      uploadSpeed: 9.5e5,
      categories: ["Linux ISOs", "Movies", "TV Shows", "Music"],
    });
    return;
  }

  // Fetch torrents + transfer stats with a given SID. Lets 403s propagate so the
  // caller can decide whether to re-authenticate.
  const fetchData = (sid: string) =>
    Promise.all([
      httpClient.get(`${baseUrl}/api/v2/torrents/info`, { headers: { Cookie: sid } }),
      httpClient.get(`${baseUrl}/api/v2/transfer/info`, { headers: { Cookie: sid } }),
    ]);

  // Fetch the full category catalog separately. qBittorrent's dedicated
  // categories endpoint returns every defined category — even ones with no
  // active torrents — so the tile filter can list them all. Failures here must
  // not break the rest of the response, so callers handle errors and fall back
  // to an empty catalog.
  const fetchCategories = (sid: string) =>
    httpClient.get(`${baseUrl}/api/v2/torrents/categories`, { headers: { Cookie: sid } });

  const key = qbCacheKey(baseUrl, username);

  try {
    // Reuse the cached SID when present; only log in when there is none.
    let sid = qbSidCache.get(key);
    if (!sid) {
      sid = await qbLogin(baseUrl, username, password);
    }

    let torrentsRes;
    let transferRes;
    try {
      [torrentsRes, transferRes] = await fetchData(sid);
    } catch (err) {
      // A cached session can expire server-side; on a 403 drop it, log in once
      // more, and retry the data fetch a single time.
      if (isAuthError(err)) {
        qbSidCache.delete(key);
        sid = await qbLogin(baseUrl, username, password);
        [torrentsRes, transferRes] = await fetchData(sid);
      } else {
        throw err;
      }
    }

    const torrents = ((torrentsRes.data ?? []) as Array<{ name: string; progress: number; state: string; dlspeed: number; upspeed: number; category?: string }>)
      .slice(0, 8)
      .map((t) => ({
        name: t.name,
        progress: Math.round((t.progress ?? 0) * 100),
        state: t.state,
        dlSpeed: t.dlspeed ?? 0,
        upSpeed: t.upspeed ?? 0,
        category: t.category ?? "",
      }));

    const transfer = (transferRes.data ?? {}) as { dl_info_speed?: number; up_info_speed?: number };

    // Pull the full category catalog with the (now-valid) session. This is
    // best-effort: any failure or empty/unexpected payload just yields an empty
    // list rather than breaking the torrents/transfer response.
    let categories: string[] = [];
    try {
      const categoriesRes = await fetchCategories(sid);
      const raw = categoriesRes.data;
      if (raw && typeof raw === "object") {
        categories = Object.keys(raw as Record<string, unknown>).sort((a, b) =>
          a.localeCompare(b),
        );
      }
    } catch (err) {
      logger.warn(
        { reason: normalizeHttpError(err) },
        "qBittorrent categories fetch failed; returning empty category catalog",
      );
    }

    res.json({
      torrents,
      downloadSpeed: transfer.dl_info_speed ?? 0,
      uploadSpeed: transfer.up_info_speed ?? 0,
      categories,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "qb-auth-failed") {
      logger.warn({ baseUrl }, "qBittorrent authentication failed (check saved username/password)");
      res.status(502).json({ error: "qBittorrent authentication failed" });
      return;
    }
    if (err instanceof Error && err.message === "qb-no-session") {
      logger.warn({ baseUrl }, "qBittorrent login returned no session cookie");
      res.status(502).json({ error: "qBittorrent did not return a session" });
      return;
    }
    logger.error({ reason: normalizeHttpError(err) }, "qBittorrent widget error");
    res.status(502).json({ error: "Failed to fetch qBittorrent data" });
  }
});

// ────────────────────────────────────────────────
// Pi-hole Widget
// ────────────────────────────────────────────────
// Auto-detects the Pi-hole API version: it tries the v6 REST API (session login
// at `/api/auth`, stats at `/api/...`) first and falls back to the legacy v5
// `admin/api.php` endpoint, so one saved connection works for both. See
// lib/pihole.ts for the detection + mapping details.
router.get("/pihole", requireAuth, async (_req, res) => {
  const saved = getSavedConnection("pihole");
  const baseUrl = normalizeBaseUrl(saved.url || process.env["PIHOLE_URL"]);
  const apiKey = saved.apiKey || process.env["PIHOLE_API_KEY"];

  // Unconfigured (no base URL): report not-configured so the tile shows its
  // placeholder rather than stale/sample numbers.
  if (!baseUrl) {
    res.status(503).json({ error: "Pi-hole is not configured" });
    return;
  }

  try {
    const data = await fetchPiholeData(baseUrl, apiKey);
    res.json(data);
  } catch (err) {
    const message = normalizeHttpError(err);
    logger.warn({ baseUrl, reason: message }, "Pi-hole widget error");
    res.status(502).json({ error: message });
  }
});

// ────────────────────────────────────────────────
// Nginx Proxy Manager Widget
// ────────────────────────────────────────────────
// NPM's v2 API is token-based: POST /api/tokens with {identity, secret} returns
// a short-lived bearer token (default ~1h). The tile polls every 60s, so cache
// the token per connection (keyed by baseUrl + email) and reuse it until it is
// near expiry, re-authenticating only when it has lapsed or is rejected (401).
interface NpmToken {
  token: string;
  // Epoch ms after which the cached token should be considered stale.
  expiresAt: number;
}

const npmTokenCache = new Map<string, NpmToken>();

function npmCacheKey(baseUrl: string, email: string): string {
  return `${baseUrl}\u0000${email}`;
}

// Authenticate against NPM, cache the resulting token with its expiry, and
// return it. Throws a tagged error when credentials are rejected.
async function npmLogin(baseUrl: string, email: string, password: string): Promise<string> {
  const r = await httpClient.post(
    `${baseUrl}/api/tokens`,
    { identity: email, secret: password },
    { headers: { "Content-Type": "application/json" } },
  );
  const body = (r.data ?? {}) as { token?: string; expires?: string };
  if (!body.token) {
    throw new Error("npm-auth-failed");
  }

  // NPM returns an ISO `expires` timestamp; fall back to a 1h lifetime and
  // refresh 60s early so a request never rides an about-to-expire token.
  const parsed = body.expires ? new Date(body.expires).getTime() : NaN;
  const expiresAt = (Number.isNaN(parsed) ? Date.now() + 3600_000 : parsed) - 60_000;
  npmTokenCache.set(npmCacheKey(baseUrl, email), { token: body.token, expiresAt });
  return body.token;
}

// Return a valid cached token when one is present and unexpired; otherwise log
// in fresh.
async function npmGetToken(baseUrl: string, email: string, password: string): Promise<string> {
  const cached = npmTokenCache.get(npmCacheKey(baseUrl, email));
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  return npmLogin(baseUrl, email, password);
}

function isUnauthorized(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 401 || status === 403;
}

router.get("/nginx-proxy-manager", requireAuth, async (_req, res) => {
  const saved = getSavedConnection("nginx-proxy-manager");
  const baseUrl = normalizeBaseUrl(saved.url || process.env["NPM_URL"]);
  // The NPM connection stores the login email in the `username` field.
  const email = saved.username || process.env["NPM_EMAIL"];
  const password = saved.password ?? process.env["NPM_PASSWORD"];

  if (!baseUrl || !email || password == null) {
    // Realistic sample data so the tile/layout can be previewed unconfigured.
    res.json({
      total: 5,
      enabled: 4,
      offline: 1,
      deadHostsCount: 2,
      expiringCertsCount: 1,
      proxyHosts: [
        { id: 1, domainNames: ["jellyfin.example.com"], enabled: true, online: true, ssl: true, sslExpiring: false },
        { id: 2, domainNames: ["nextcloud.example.com"], enabled: true, online: true, ssl: true, sslExpiring: true },
        { id: 3, domainNames: ["grafana.example.com"], enabled: true, online: false, ssl: true, sslExpiring: false },
        { id: 4, domainNames: ["home.example.com"], enabled: true, online: true, ssl: false, sslExpiring: false },
      ],
    });
    return;
  }

  // Fetch proxy hosts (with their certificate expanded for SSL expiry) and the
  // 404/dead hosts in parallel. Lets 401s propagate so the caller can decide to
  // re-authenticate.
  const fetchData = (token: string) =>
    Promise.all([
      httpClient.get(`${baseUrl}/api/nginx/proxy-hosts`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { expand: "certificate" },
      }),
      httpClient.get(`${baseUrl}/api/nginx/dead-hosts`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

  const key = npmCacheKey(baseUrl, email);

  try {
    let token = await npmGetToken(baseUrl, email, password);

    let proxyRes;
    let deadRes;
    try {
      [proxyRes, deadRes] = await fetchData(token);
    } catch (err) {
      // A cached token can lapse server-side; on a 401/403 drop it, log in once
      // more, and retry the data fetch a single time.
      if (isUnauthorized(err)) {
        npmTokenCache.delete(key);
        token = await npmLogin(baseUrl, email, password);
        [proxyRes, deadRes] = await fetchData(token);
      } else {
        throw err;
      }
    }

    // A cert counts as a warning if it is expired or expires within 30 days.
    const EXPIRY_WINDOW_MS = 30 * 86400000;
    const now = Date.now();
    let expiringCertsCount = 0;

    const rawHosts = (proxyRes.data ?? []) as Array<{
      id: number;
      domain_names?: string[];
      enabled?: boolean | number;
      certificate_id?: number;
      certificate?: { expires_on?: string } | null;
      meta?: { nginx_online?: boolean };
    }>;

    const proxyHosts = rawHosts.map((h) => {
      const enabled = Boolean(h.enabled);
      // NPM records reachability in meta.nginx_online; treat a missing value as
      // online so hosts that have never been polled don't read as down.
      const online = h.meta?.nginx_online !== false;
      const ssl = Boolean(h.certificate_id);
      let sslExpiring = false;
      const expiresOn = h.certificate?.expires_on;
      if (ssl && expiresOn) {
        const exp = new Date(expiresOn).getTime();
        if (!Number.isNaN(exp) && exp - now < EXPIRY_WINDOW_MS) {
          sslExpiring = true;
          expiringCertsCount++;
        }
      }
      return {
        id: h.id,
        domainNames: h.domain_names ?? [],
        enabled,
        online,
        ssl,
        sslExpiring,
      };
    });

    const enabledHosts = proxyHosts.filter((h) => h.enabled);
    const offline = enabledHosts.filter((h) => !h.online).length;
    const deadHostsCount = ((deadRes.data ?? []) as unknown[]).length;

    res.json({
      total: proxyHosts.length,
      enabled: enabledHosts.length,
      offline,
      deadHostsCount,
      expiringCertsCount,
      proxyHosts,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "npm-auth-failed") {
      logger.warn({ baseUrl }, "Nginx Proxy Manager authentication failed (check saved email/password)");
      res.status(502).json({ error: "Nginx Proxy Manager authentication failed" });
      return;
    }
    logger.error({ reason: normalizeHttpError(err) }, "Nginx Proxy Manager widget error");
    res.status(502).json({ error: "Failed to fetch Nginx Proxy Manager data" });
  }
});

// ────────────────────────────────────────────────
// Prowlarr Widget
// ────────────────────────────────────────────────
// Prowlarr exposes its v1 API behind an X-Api-Key header. The tile wants three
// things: a per-indexer status list, a recent grab count, and the health
// warnings Prowlarr is currently reporting. We derive per-indexer "failing"
// state from the health feed: Prowlarr surfaces unreachable indexers as a
// health issue whose message names the affected indexers, so an enabled indexer
// counts as failing when its name appears in any health message.
router.get("/prowlarr", requireAuth, async (_req, res) => {
  const saved = getSavedConnection("prowlarr");
  const baseUrl = saved.url || process.env["PROWLARR_URL"];
  const apiKey = saved.apiKey || process.env["PROWLARR_API_KEY"];

  if (!baseUrl || !apiKey) {
    // Sample data only when the service is genuinely unconfigured.
    res.json({
      indexers: [
        { id: 1, name: "1337x", enabled: true, status: "ok" },
        { id: 2, name: "The Pirate Bay", enabled: true, status: "ok" },
        { id: 3, name: "Nyaa", enabled: true, status: "failing" },
        { id: 4, name: "RARBG", enabled: false, status: "ok" },
        { id: 5, name: "TorrentGalaxy", enabled: true, status: "ok" },
      ],
      grabCount24h: 7,
      healthIssues: [
        {
          source: "IndexerStatusCheck",
          type: "warning",
          message: "Indexers unavailable due to failures: Nyaa",
        },
      ],
    });
    return;
  }

  try {
    const headers = { "X-Api-Key": apiKey };

    const [indexerRes, historyRes, healthRes] = await Promise.all([
      httpClient.get(`${baseUrl}/api/v1/indexer`, { headers }),
      // eventType=1 is "releaseGrabbed"; the paged response carries rows under
      // `records` sorted newest-first, so a single page of 100 covers the most
      // recent grabs we need to count for the last 24h.
      httpClient.get(`${baseUrl}/api/v1/history`, {
        headers,
        params: { pageSize: 100, eventType: 1 },
      }),
      httpClient.get(`${baseUrl}/api/v1/health`, { headers }),
    ]);

    const healthIssues = ((healthRes.data ?? []) as Array<{
      source?: string;
      type?: string;
      message?: string;
    }>).map((h) => ({
      source: h.source ?? "",
      type: h.type ?? "",
      message: h.message ?? "",
    }));

    // Concatenate every health message once so we can cheaply test whether an
    // indexer's name is referenced as failing.
    const healthText = healthIssues.map((h) => h.message).join(" \u0000 ");

    const indexers = ((indexerRes.data ?? []) as Array<{
      id: number;
      name: string;
      enable?: boolean;
    }>).map((ix) => {
      const enabled = Boolean(ix.enable);
      // Only enabled indexers can be "failing"; a disabled one is intentionally
      // off and renders grey via the enabled flag.
      const failing = enabled && ix.name.length > 0 && healthText.includes(ix.name);
      return {
        id: ix.id,
        name: ix.name,
        enabled,
        status: failing ? "failing" : "ok",
      };
    });

    // Count grabs within the last 24h. Each history record carries a `date`
    // (ISO) timestamp; rows beyond the window (or without a parseable date) are
    // ignored.
    const cutoff = Date.now() - 24 * 3600_000;
    const records = (historyRes.data?.records ?? []) as Array<{ date?: string }>;
    const grabCount24h = records.filter((r) => {
      if (!r.date) return false;
      const t = new Date(r.date).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    }).length;

    res.json({ indexers, grabCount24h, healthIssues });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Prowlarr widget error");
    res.status(502).json({ error: "Failed to fetch Prowlarr data" });
  }
});

// ────────────────────────────────────────────────
// Tailscale Widget
// ────────────────────────────────────────────────
// Unlike the LAN services, Tailscale data comes from its cloud API
// (api.tailscale.com), authed with an API access token. We reuse the saved
// connection's `url` field for the tailnet name and `apiKey` for the token.
// A device counts as "online" when it was last seen within this window — the
// devices endpoint has no direct online flag, so this is the standard heuristic.
const TAILSCALE_ONLINE_WINDOW_MS = 5 * 60 * 1000;

// A device's node key is flagged as "expiring soon" when it will lapse within
// this window (or has already lapsed). Tailscale node keys expire unless key
// expiry is disabled; a lapsed key silently drops the device off the tailnet.
const TAILSCALE_KEY_EXPIRY_WARN_MS = 7 * 24 * 60 * 60 * 1000;

// A device is an approved exit node when its enabled routes include the default
// route in either address family. (advertisedRoutes are merely offered; the
// enabled ones are what the tailnet admin has actually approved.)
function isExitNode(routes: string[] | undefined): boolean {
  if (!Array.isArray(routes)) return false;
  return routes.includes("0.0.0.0/0") || routes.includes("::/0");
}

// Resolve a device's key-expiry state from the raw `expires`/`keyExpiryDisabled`
// fields. Tailscale uses the sentinel "0001-01-01T00:00:00Z" (which parses to a
// non-positive epoch) when a device has no expiry, so we treat any non-positive
// timestamp as "no expiry". `expiringSoon` is true when a real expiry falls
// inside the warning window — including keys that have already lapsed, since
// those still need the user's attention.
function keyExpiryStatus(
  expires: string | undefined,
  keyExpiryDisabled: boolean | undefined,
  nowMs: number,
): { expires: string | null; keyExpiryDisabled: boolean; keyExpiringSoon: boolean } {
  const disabled = keyExpiryDisabled === true;
  const expiresMs = expires ? new Date(expires).getTime() : NaN;
  const hasExpiry = !disabled && Number.isFinite(expiresMs) && expiresMs > 0;
  return {
    expires: hasExpiry ? new Date(expiresMs).toISOString() : null,
    keyExpiryDisabled: disabled,
    keyExpiringSoon: hasExpiry && expiresMs - nowMs <= TAILSCALE_KEY_EXPIRY_WARN_MS,
  };
}

router.get("/tailscale", requireAuth, async (_req, res) => {
  const saved = getSavedConnection("tailscale");
  const tailnet = saved.url || process.env["TAILSCALE_TAILNET"];
  const apiKey = saved.apiKey || process.env["TAILSCALE_API_KEY"];

  if (!tailnet || !apiKey) {
    // Sample data only when the service is genuinely unconfigured.
    const now = Date.now();
    res.json({
      tailnet: "example.ts.net",
      deviceCount: 4,
      onlineCount: 3,
      offlineCount: 1,
      exitNodeCount: 1,
      expiringSoonCount: 1,
      devices: [
        { id: "1", name: "homelab-nas", os: "linux", online: true, lastSeen: new Date(now).toISOString(), exitNode: true, addresses: ["100.64.0.1", "fd7a:115c:a1e0::1"], expires: null, keyExpiryDisabled: true, keyExpiringSoon: false },
        { id: "2", name: "macbook-pro", os: "macOS", online: true, lastSeen: new Date(now - 60_000).toISOString(), exitNode: false, addresses: ["100.64.0.2", "fd7a:115c:a1e0::2"], expires: new Date(now + 3 * 86400_000).toISOString(), keyExpiryDisabled: false, keyExpiringSoon: true },
        { id: "3", name: "pixel-phone", os: "android", online: true, lastSeen: new Date(now - 120_000).toISOString(), exitNode: false, addresses: ["100.64.0.3", "fd7a:115c:a1e0::3"], expires: new Date(now + 90 * 86400_000).toISOString(), keyExpiryDisabled: false, keyExpiringSoon: false },
        { id: "4", name: "old-laptop", os: "windows", online: false, lastSeen: new Date(now - 3 * 86400_000).toISOString(), exitNode: false, addresses: ["100.64.0.4", "fd7a:115c:a1e0::4"], expires: new Date(now + 45 * 86400_000).toISOString(), keyExpiryDisabled: false, keyExpiringSoon: false },
      ],
    });
    return;
  }

  try {
    // `fields=all` so each device carries enabledRoutes (for exit-node detection)
    // and lastSeen (for the online heuristic). Uses the secure (TLS-verifying)
    // client since this is a public cloud API carrying a bearer token.
    const r = await cloudHttpClient.get(
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(tailnet)}/devices`,
      { headers: { Authorization: `Bearer ${apiKey}` }, params: { fields: "all" } },
    );

    const now = Date.now();
    const rawDevices = (r.data?.devices ?? []) as Array<{
      id?: string;
      nodeId?: string;
      name?: string;
      hostname?: string;
      os?: string;
      lastSeen?: string;
      enabledRoutes?: string[];
      advertisedRoutes?: string[];
      addresses?: string[];
      expires?: string;
      keyExpiryDisabled?: boolean;
    }>;

    const devices = rawDevices.map((d, i) => {
      const lastSeenMs = d.lastSeen ? new Date(d.lastSeen).getTime() : NaN;
      const online = !Number.isNaN(lastSeenMs) && now - lastSeenMs <= TAILSCALE_ONLINE_WINDOW_MS;
      // Prefer the short hostname; fall back to the first label of the full DNS
      // name, then the raw name.
      const fullName = d.name ?? "";
      const name = d.hostname?.trim() || fullName.split(".")[0] || fullName || `device-${i + 1}`;
      const exitNode = isExitNode(d.enabledRoutes);
      const keyExpiry = keyExpiryStatus(d.expires, d.keyExpiryDisabled, now);
      return {
        id: d.id ?? d.nodeId ?? String(i + 1),
        name,
        os: d.os ?? "unknown",
        online,
        lastSeen: !Number.isNaN(lastSeenMs) ? new Date(lastSeenMs).toISOString() : null,
        exitNode,
        addresses: Array.isArray(d.addresses) ? d.addresses : [],
        ...keyExpiry,
      };
    });

    const onlineCount = devices.filter((d) => d.online).length;
    const exitNodeCount = devices.filter((d) => d.exitNode && d.online).length;
    const expiringSoonCount = devices.filter((d) => d.keyExpiringSoon).length;

    res.json({
      tailnet,
      deviceCount: devices.length,
      onlineCount,
      offlineCount: devices.length - onlineCount,
      exitNodeCount,
      expiringSoonCount,
      devices,
    });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Tailscale widget error");
    res.status(502).json({ error: "Failed to fetch Tailscale data" });
  }
});

// ────────────────────────────────────────────────
// ErsatzTV Widget
// ────────────────────────────────────────────────
// ErsatzTV is a homelab live/linear TV server that runs without auth here, so
// every call needs only the base URL. It publishes its channel list as an M3U
// playlist (/iptv/channels.m3u) and its guide as XMLTV (/iptv/xmltv.xml). We
// derive the channel list (number + name) from the M3U and each channel's
// "now playing" by matching the currently-airing programme (start ≤ now < stop)
// from the XMLTV guide, keyed by the M3U tvg-id ↔ XMLTV channel id.

interface ErsatzChannel {
  number: string;
  name: string;
  tvgId: string;
}

// Decode the XML/HTML entities that appear in ErsatzTV's M3U and XMLTV feeds.
// Handles the five named entities plus numeric character references in both
// decimal (`&#39;`) and hex (`&#x27;`) forms so titles like "Limmy's Show!"
// render correctly instead of showing the raw `&#39;`. The numeric pass runs
// first so a literal "&amp;#39;" still resolves to "&" rather than "'".
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Parse the channel rows out of an ErsatzTV M3U playlist. Each channel is a
// `#EXTINF:` line carrying tvg-* attributes followed by the stream URL; we only
// need the attributes (number, name, id) for the tile.
function parseM3uChannels(m3u: string): ErsatzChannel[] {
  const channels: ErsatzChannel[] = [];
  const lines = m3u.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("#EXTINF")) continue;
    const attr = (name: string): string => {
      const m = line.match(new RegExp(`${name}="([^"]*)"`));
      return m?.[1]?.trim() ?? "";
    };
    const tvgId = attr("tvg-id");
    const number = attr("tvg-chno") || tvgId;
    // The display name is the text after the trailing comma; fall back to
    // tvg-name when the comma form is absent.
    const commaName = line.slice(line.indexOf(",") + 1).trim();
    const name = decodeXmlEntities(commaName || attr("tvg-name") || number);
    if (!number && !name) continue;
    channels.push({ number, name, tvgId });
  }
  return channels;
}

// Parse an XMLTV timestamp like "20260616120000 +0000" (offset optional) into
// epoch ms. Returns NaN when unparseable so callers can skip the programme.
function parseXmltvTime(value: string): number {
  const m = value
    .trim()
    .match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s, off] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${
    off ? `${off.slice(0, 3)}:${off.slice(3)}` : "Z"
  }`;
  return new Date(iso).getTime();
}

// Build a map of channelId → currently-airing programme title from an XMLTV
// document. A programme is "now playing" when start ≤ now < stop. Earlier
// matches win, but normally only one programme covers a given instant.
function parseXmltvNowPlaying(xml: string, nowMs: number): Map<string, string> {
  const nowPlaying = new Map<string, string>();
  const programmeRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  let match: RegExpExecArray | null;
  while ((match = programmeRe.exec(xml)) !== null) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const channel = attrs.match(/channel="([^"]*)"/)?.[1]?.trim();
    const startRaw = attrs.match(/start="([^"]*)"/)?.[1];
    const stopRaw = attrs.match(/stop="([^"]*)"/)?.[1];
    if (!channel || !startRaw || !stopRaw) continue;
    if (nowPlaying.has(channel)) continue;
    const start = parseXmltvTime(startRaw);
    const stop = parseXmltvTime(stopRaw);
    if (Number.isNaN(start) || Number.isNaN(stop)) continue;
    if (nowMs < start || nowMs >= stop) continue;
    const rawTitle = body
      .match(/<title\b[^>]*>([\s\S]*?)<\/title>/)?.[1]
      ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1");
    const title = rawTitle ? decodeXmlEntities(rawTitle).trim() : undefined;
    if (title) nowPlaying.set(channel, title);
  }
  return nowPlaying;
}

// Fetch the live active-stream count from ErsatzTV's /api/sessions endpoint,
// which returns a JSON array with one entry per active transcode session
// (MPEG-TS and HLS Segmenter). Returns the array length, or null when the
// endpoint is unavailable (older instance, network error, or unexpected shape)
// so the tile omits the metric instead of failing.
async function fetchErsatzActiveStreams(base: string): Promise<number | null> {
  try {
    const res = await httpClient.get(`${base}/api/sessions`, { responseType: "json" });
    const data = res.data;
    if (Array.isArray(data)) return data.length;
    return null;
  } catch (err) {
    logger.warn(
      { reason: normalizeHttpError(err) },
      "ErsatzTV active-stream count unavailable",
    );
    return null;
  }
}

router.get("/ersatztv", requireAuth, async (_req, res) => {
  const saved = getSavedConnection("ersatztv");
  const baseUrl = saved.url || process.env["ERSATZTV_URL"];

  if (!baseUrl) {
    // Sample data only when the service is genuinely unconfigured.
    res.json({
      reachable: true,
      activeStreams: 2,
      channels: [
        { number: "1", name: "Movies 24/7", nowPlaying: "The Maltese Falcon" },
        { number: "2", name: "Retro Cartoons", nowPlaying: "Looney Tunes" },
        { number: "3", name: "Nature Documentaries", nowPlaying: "Planet Earth: Jungles" },
        { number: "4", name: "Sci-Fi Marathon", nowPlaying: "Blade Runner" },
        { number: "5", name: "News Loop", nowPlaying: null },
      ],
    });
    return;
  }

  try {
    const base = trimSlash(baseUrl);

    // Active streams come from ErsatzTV's /api/sessions endpoint, which returns
    // a JSON array (one entry per active MPEG-TS / HLS transcode session). It is
    // fetched alongside the M3U/XMLTV but with its own catch so a failure or an
    // older instance without the endpoint degrades to null (omit the metric)
    // rather than failing the whole tile.
    const [channelsRes, guideRes, activeStreams] = await Promise.all([
      httpClient.get(`${base}/iptv/channels.m3u`, { responseType: "text" }),
      httpClient.get(`${base}/iptv/xmltv.xml`, { responseType: "text" }),
      fetchErsatzActiveStreams(base),
    ]);

    const channelList = parseM3uChannels(String(channelsRes.data ?? ""));
    const nowPlaying = parseXmltvNowPlaying(String(guideRes.data ?? ""), Date.now());

    const channels = channelList.map((c) => ({
      number: c.number,
      name: c.name,
      // Match the guide by tvg-id, falling back to channel number (ErsatzTV
      // keys XMLTV channels by their number when no explicit id is set).
      nowPlaying: nowPlaying.get(c.tvgId) ?? nowPlaying.get(c.number) ?? null,
    }));

    res.json({ reachable: true, activeStreams, channels });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "ErsatzTV widget error");
    res.status(502).json({ error: "Failed to fetch ErsatzTV data" });
  }
});

// ────────────────────────────────────────────────
// News (RSS / Atom) Widget
// ────────────────────────────────────────────────
// Unlike the homelab service tiles, this widget is configured entirely per-tile
// (no saved Settings connection): the tile passes the feed URL + item limit as
// query params. With no URL we return demo headlines (the "mock when
// unconfigured" convention); a configured-but-unfetchable/unparsable feed 502s
// so the tile renders its error state.

const NEWS_DEFAULT_LIMIT = 8;
const NEWS_MAX_LIMIT = 30;

// Single shared parser. We fetch the feed ourselves via the shared httpClient so
// the request honors our timeout and self-signed-TLS handling, then hand the raw
// XML to rss-parser's parseString (it handles both RSS 2.0 and Atom).
const rssParser = new Parser();

interface NewsItemOut {
  title: string;
  link: string | null;
  source: string | null;
  published: string | null;
}

const DEMO_NEWS: { feedTitle: string; items: NewsItemOut[] } = {
  feedTitle: "Demo Feed",
  items: [
    {
      title: "Add a feed URL in this tile's settings to see real headlines",
      link: null,
      source: "Demo Feed",
      published: new Date().toISOString(),
    },
    {
      title: "Self-hosted homelab dashboards keep gaining momentum",
      link: null,
      source: "Demo Feed",
      published: new Date(Date.now() - 3600_000).toISOString(),
    },
    {
      title: "RSS is still the simplest way to follow any site",
      link: null,
      source: "Demo Feed",
      published: new Date(Date.now() - 2 * 3600_000).toISOString(),
    },
    {
      title: "Works with BBC, Hacker News, subreddits, and most blogs",
      link: null,
      source: "Demo Feed",
      published: new Date(Date.now() - 5 * 3600_000).toISOString(),
    },
    {
      title: "No API key or signup required — just paste a feed link",
      link: null,
      source: "Demo Feed",
      published: new Date(Date.now() - 8 * 3600_000).toISOString(),
    },
  ],
};

function clampNewsLimit(raw: unknown): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return NEWS_DEFAULT_LIMIT;
  return Math.min(NEWS_MAX_LIMIT, Math.max(1, Math.floor(n)));
}

router.get("/news", requireAuth, async (req, res) => {
  const rawUrl = typeof req.query["url"] === "string" ? req.query["url"].trim() : "";
  const limit = clampNewsLimit(req.query["limit"]);
  const feedUrl = normalizeBaseUrl(rawUrl);

  // Unconfigured (no feed URL): show representative demo headlines.
  if (!feedUrl) {
    res.json({ feedTitle: DEMO_NEWS.feedTitle, items: DEMO_NEWS.items.slice(0, limit) });
    return;
  }

  try {
    const r = await httpClient.get(feedUrl, {
      responseType: "text",
      // Some feeds gate on a browser-y UA and reject the default axios one.
      headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    });
    const feed = await rssParser.parseString(String(r.data ?? ""));
    const feedTitle = feed.title?.trim() || null;

    const items: NewsItemOut[] = (feed.items ?? []).slice(0, limit).map((it) => {
      const title = (it.title ?? "").trim() || "(untitled)";
      const link = it.link?.trim() || null;
      // rss-parser exposes the per-item <source> as `it.source` when present.
      const source =
        (typeof it.source === "string" ? it.source.trim() : "") || null;
      const isoRaw = it.isoDate || it.pubDate || null;
      let published: string | null = null;
      if (isoRaw) {
        const d = new Date(isoRaw);
        published = Number.isNaN(d.getTime()) ? null : d.toISOString();
      }
      return { title, link, source, published };
    });

    res.json({ feedTitle, items });
  } catch (err) {
    logger.warn({ feedUrl, reason: normalizeHttpError(err) }, "News widget error");
    res.status(502).json({ error: "Could not fetch or parse that feed." });
  }
});

// ────────────────────────────────────────────────
// Stocks Widget
// ────────────────────────────────────────────────
// Per-tile watchlist of US equity/ETF symbols. Quotes (price + daily change)
// come from a free stock-quote provider (Finnhub) proxied here so the API key
// stays server-side. Following the widget-data convention: with NO key
// configured the route returns clearly-labeled sample quotes (sample: true) so
// the tile still renders; with a key configured but the upstream failing it
// returns 502 so the tile shows its error state.

const STOCKS_MAX_SYMBOLS = 25;
const FINNHUB_BASE = "https://finnhub.io/api/v1";

// The provider key comes from the saved "stocks" connection first (set via the
// Settings page), falling back to the server secrets so existing deployments
// keep working. Finnhub is the chosen free provider (simple per-symbol /quote
// endpoint + /search on the free tier).
function getStocksApiKey(): string | undefined {
  const saved = getSavedConnection("stocks");
  return (
    saved.apiKey ||
    process.env["FINNHUB_API_KEY"]?.trim() ||
    process.env["STOCKS_API_KEY"]?.trim() ||
    undefined
  );
}

// A small static catalog used both for sample quotes (unconfigured) and as a
// fallback symbol-search source. Prices are representative, not live.
const SAMPLE_STOCKS: Record<string, { name: string; price: number; changePercent: number }> = {
  AAPL: { name: "Apple Inc", price: 229.87, changePercent: 0.82 },
  MSFT: { name: "Microsoft Corp", price: 432.15, changePercent: -0.45 },
  GOOGL: { name: "Alphabet Inc Class A", price: 178.34, changePercent: 1.21 },
  AMZN: { name: "Amazon.com Inc", price: 201.55, changePercent: -1.08 },
  NVDA: { name: "NVIDIA Corp", price: 138.92, changePercent: 2.34 },
  TSLA: { name: "Tesla Inc", price: 352.41, changePercent: -2.11 },
  META: { name: "Meta Platforms Inc", price: 602.78, changePercent: 0.56 },
  VOO: { name: "Vanguard S&P 500 ETF", price: 545.6, changePercent: 0.34 },
  SPY: { name: "SPDR S&P 500 ETF Trust", price: 593.12, changePercent: 0.31 },
  QQQ: { name: "Invesco QQQ Trust", price: 511.47, changePercent: 0.62 },
};

const DEFAULT_SAMPLE_SYMBOLS = ["AAPL", "MSFT", "NVDA", "VOO"];

interface StockQuoteOut {
  symbol: string;
  name: string | null;
  price: number;
  change: number;
  changePercent: number;
}

// Build a sample quote for a symbol. Falls back to a deterministic pseudo-price
// for symbols not in the static catalog so an arbitrary watchlist still renders
// representative (clearly non-live) data.
function sampleQuote(symbol: string): StockQuoteOut {
  const known = SAMPLE_STOCKS[symbol];
  if (known) {
    const price = known.price;
    const change = (price * known.changePercent) / 100;
    return { symbol, name: known.name, price, change, changePercent: known.changePercent };
  }
  // Deterministic fallback from the symbol's characters.
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) seed = (seed * 31 + symbol.charCodeAt(i)) % 100000;
  const price = 20 + (seed % 480) + (seed % 100) / 100;
  const changePercent = ((seed % 800) - 400) / 100; // -4% .. +4%
  const change = (price * changePercent) / 100;
  return { symbol, name: null, price, change, changePercent };
}

function parseSymbols(raw: unknown): string[] {
  const text = typeof raw === "string" ? raw : "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(",")) {
    const sym = part.trim().toUpperCase();
    if (sym && !seen.has(sym)) {
      seen.add(sym);
      out.push(sym);
      if (out.length >= STOCKS_MAX_SYMBOLS) break;
    }
  }
  return out;
}

router.get("/stocks", requireAuth, async (req, res) => {
  const symbols = parseSymbols(req.query["symbols"]);
  const apiKey = getStocksApiKey();

  // Unconfigured (no provider key): return clearly-labeled sample quotes. When
  // no symbols were requested either, seed with a representative default set so
  // a brand-new tile still shows content.
  if (!apiKey) {
    const list = symbols.length > 0 ? symbols : DEFAULT_SAMPLE_SYMBOLS;
    res.json({ quotes: list.map(sampleQuote), sample: true });
    return;
  }

  // Configured but nothing to quote yet — return an empty (non-sample) result.
  if (symbols.length === 0) {
    res.json({ quotes: [], sample: false });
    return;
  }

  try {
    // Finnhub has a per-symbol quote endpoint; fetch them in parallel. Profile
    // lookups (for the company name) are best-effort and must not fail the row.
    const quotes = await Promise.all(
      symbols.map(async (symbol): Promise<StockQuoteOut | null> => {
        const quoteRes = await httpClient.get(`${FINNHUB_BASE}/quote`, {
          params: { symbol, token: apiKey },
        });
        const q = (quoteRes.data ?? {}) as {
          c?: number; // current price
          d?: number; // change
          dp?: number; // percent change
        };
        // Finnhub returns all-zeros for an unknown symbol; treat that as "no
        // data" and drop the row rather than showing a $0 quote.
        if (!q.c || q.c === 0) return null;

        let name: string | null = null;
        try {
          const profRes = await httpClient.get(`${FINNHUB_BASE}/stock/profile2`, {
            params: { symbol, token: apiKey },
          });
          const prof = (profRes.data ?? {}) as { name?: string };
          name = prof.name?.trim() || null;
        } catch {
          // Name is a nicety; ignore lookup failures.
        }

        return {
          symbol,
          name,
          price: q.c,
          change: q.d ?? 0,
          changePercent: q.dp ?? 0,
        };
      }),
    );

    res.json({ quotes: quotes.filter((q): q is StockQuoteOut => q !== null), sample: false });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Stocks widget error");
    res.status(502).json({ error: "Failed to fetch stock quotes" });
  }
});

// Number of recent daily closes a sparkline shows (~30 trading days).
const STOCKS_CANDLE_DAYS = 30;

interface StockCandleSeriesOut {
  symbol: string;
  closes: number[];
}

// Build a deterministic sample closing-price series for a symbol. The walk ends
// near the symbol's sample price and drifts in the direction of its sample
// daily change, so the sparkline visibly matches the row's up/down tone.
function sampleCandleSeries(symbol: string): StockCandleSeriesOut {
  const quote = sampleQuote(symbol);
  const end = quote.price;
  // Slope across the window scaled loosely off the daily-change direction.
  const drift = (quote.changePercent / 100) * end * 6;
  const start = Math.max(1, end - drift);
  // Seed a small pseudo-random wiggle from the symbol so it is stable per render.
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) seed = (seed * 31 + symbol.charCodeAt(i)) % 100000;
  const closes: number[] = [];
  for (let i = 0; i < STOCKS_CANDLE_DAYS; i++) {
    const t = i / (STOCKS_CANDLE_DAYS - 1);
    const base = start + (end - start) * t;
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const wiggle = ((seed / 2147483648) * 2 - 1) * end * 0.012;
    closes.push(Math.max(0.01, Number((base + wiggle).toFixed(2))));
  }
  // Pin the last point exactly to the sample price for visual consistency.
  closes[closes.length - 1] = Number(end.toFixed(2));
  return { symbol, closes };
}

router.get("/stocks/candles", requireAuth, async (req, res) => {
  const symbols = parseSymbols(req.query["symbols"]);
  const apiKey = getStocksApiKey();

  // Unconfigured: return clearly-labeled sample series so the tile still renders.
  if (!apiKey) {
    const list = symbols.length > 0 ? symbols : DEFAULT_SAMPLE_SYMBOLS;
    res.json({ series: list.map(sampleCandleSeries), sample: true });
    return;
  }

  if (symbols.length === 0) {
    res.json({ series: [], sample: false });
    return;
  }

  try {
    // Finnhub's daily-candle endpoint takes a UNIX-second window. Fetch ~6 weeks
    // back to comfortably cover STOCKS_CANDLE_DAYS trading days, then keep the
    // most recent closes. Per-symbol fetches run in parallel; a symbol with no
    // usable data is dropped rather than failing the whole request.
    const to = Math.floor(Date.now() / 1000);
    const from = to - 60 * 60 * 24 * 45;
    const series = await Promise.all(
      symbols.map(async (symbol): Promise<StockCandleSeriesOut | null> => {
        const candleRes = await httpClient.get(`${FINNHUB_BASE}/stock/candle`, {
          params: { symbol, resolution: "D", from, to, token: apiKey },
        });
        const data = (candleRes.data ?? {}) as { c?: number[]; s?: string };
        // Finnhub signals "no data" with s:"no_data" and/or an empty close array.
        if (data.s !== "ok" || !Array.isArray(data.c) || data.c.length === 0) {
          return null;
        }
        const closes = data.c
          .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
          .slice(-STOCKS_CANDLE_DAYS);
        if (closes.length === 0) return null;
        return { symbol, closes };
      }),
    );

    res.json({ series: series.filter((s): s is StockCandleSeriesOut => s !== null), sample: false });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Stock candles widget error");
    res.status(502).json({ error: "Failed to fetch stock candles" });
  }
});

router.get("/stocks/search", requireAuth, async (req, res) => {
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  const apiKey = getStocksApiKey();

  if (!q) {
    res.json({ results: [], sample: !apiKey });
    return;
  }

  // Unconfigured: match against the built-in sample catalog so the editor can
  // still add symbols (clearly sample data).
  if (!apiKey) {
    const upper = q.toUpperCase();
    const results = Object.entries(SAMPLE_STOCKS)
      .filter(([sym, info]) => sym.includes(upper) || info.name.toUpperCase().includes(upper))
      .map(([sym, info]) => ({ symbol: sym, description: info.name }));
    res.json({ results, sample: true });
    return;
  }

  try {
    const searchRes = await httpClient.get(`${FINNHUB_BASE}/search`, {
      params: { q, token: apiKey },
    });
    const data = (searchRes.data ?? {}) as {
      result?: Array<{ symbol?: string; description?: string; type?: string }>;
    };
    const results = (data.result ?? [])
      // Common stocks/ETFs only — skip symbols with exchange suffixes (foreign
      // listings) to keep the free-tier US-equity focus.
      .filter((r) => r.symbol && !r.symbol.includes("."))
      .slice(0, 20)
      .map((r) => ({
        symbol: (r.symbol ?? "").toUpperCase(),
        description: r.description?.trim() || (r.symbol ?? "").toUpperCase(),
      }));
    res.json({ results, sample: false });
  } catch (err) {
    logger.error({ reason: normalizeHttpError(err) }, "Stocks search error");
    res.status(502).json({ error: "Failed to search stock symbols" });
  }
});

export default router;
