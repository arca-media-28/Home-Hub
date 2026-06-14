import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { connectionStmts } from "../lib/db.js";
import { httpClient, normalizeBaseUrl } from "../lib/http.js";
import { logger } from "../lib/logger.js";

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

// ────────────────────────────────────────────────
// TrueNAS SCALE Widget
// ────────────────────────────────────────────────
// Build a legend→latest-value map for a single reporting graph. TrueNAS returns
// each graph as { legend: string[], data: number[][], aggregations? }. Each data
// row begins with a unix timestamp, so the values align with the legend after
// dropping that first column. Prefer the aggregated mean when present.
function latestByLegend(graph: unknown): Record<string, number> {
  const g = graph as
    | { legend?: string[]; data?: number[][]; aggregations?: { mean?: number[] } }
    | undefined;
  const legend = g?.legend ?? [];

  let values: number[];
  const mean = g?.aggregations?.mean;
  if (Array.isArray(mean)) {
    values = mean.map((n) => Number(n) || 0);
  } else {
    const rows = g?.data ?? [];
    const last = rows[rows.length - 1] ?? [];
    values = last.slice(1).map((n) => Number(n) || 0);
  }

  const map: Record<string, number> = {};
  legend.forEach((name, i) => {
    map[name] = values[i] ?? 0;
  });
  return map;
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
      pools: [
        { name: "tank", status: "ONLINE", usedBytes: 2.1e12, totalBytes: 10e12 },
        { name: "backup", status: "ONLINE", usedBytes: 500e9, totalBytes: 4e12 },
      ],
    });
    return;
  }

  try {
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

    // The reporting endpoint must be a POST with the query as the JSON body.
    // (Issuing a GET with a body does not reliably send the payload.) Both
    // graphs can be requested in a single call.
    const [reportRes, poolRes] = await Promise.all([
      httpClient.post(
        `${baseUrl}/api/v2.0/reporting/get_data`,
        {
          graphs: [{ name: "cpu" }, { name: "memory" }],
          reporting_query: { start: "now-30s", end: "now", aggregate: true },
        },
        { headers },
      ),
      httpClient.get(`${baseUrl}/api/v2.0/pool`, { headers }),
    ]);

    const graphs = (reportRes.data ?? []) as Array<{ name?: string }>;
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
    const memUsedGb = memUsedBytes / 1e9;
    const memTotalGb = memTotalBytes / 1e9;

    // Pool capacity comes from the ZFS vdev stats in the topology. Sum the data
    // vdevs: `allocated`/`alloc` is used space, `size`/`space` is total.
    const pools = ((poolRes.data ?? []) as Array<{
      name: string;
      status: string;
      topology?: { data?: Array<{ stats?: { allocated?: number; alloc?: number; size?: number; space?: number } }> };
    }>).map((p) => {
      let usedBytes = 0;
      let totalBytes = 0;
      for (const vdev of p.topology?.data ?? []) {
        const stats = vdev.stats ?? {};
        usedBytes += stats.allocated ?? stats.alloc ?? 0;
        totalBytes += stats.size ?? stats.space ?? 0;
      }
      return { name: p.name, status: p.status, usedBytes, totalBytes };
    });

    res.json({
      cpuPercent: Number(cpuPercent.toFixed(1)),
      memUsedGb,
      memTotalGb,
      pools,
    });
  } catch (err) {
    logger.error({ err }, "TrueNAS widget error");
    res.status(502).json({ error: "Failed to fetch TrueNAS data" });
  }
});

// ────────────────────────────────────────────────
// Media Server Widget (Plex or Jellyfin)
// ────────────────────────────────────────────────
router.get("/media", requireAuth, async (_req, res) => {
  // Prefer saved Plex connection details; fall back to env-configured media
  // server (which may be Plex or Jellyfin).
  const saved = getSavedConnection("plex");
  const savedToken = saved.token || saved.apiKey;

  let serverType = process.env["MEDIA_SERVER_TYPE"] || "jellyfin"; // "plex" | "jellyfin"
  let baseUrl = process.env["MEDIA_SERVER_URL"];
  let apiKey = process.env["MEDIA_SERVER_API_KEY"];

  if (saved.url && savedToken) {
    serverType = "plex";
    baseUrl = saved.url;
    apiKey = savedToken;
  }

  if (!baseUrl || !apiKey) {
    res.json([
      { id: "1", title: "The Last of Us", type: "show", year: 2023, thumb: null, addedAt: new Date().toISOString() },
      { id: "2", title: "Oppenheimer", type: "movie", year: 2023, thumb: null, addedAt: new Date().toISOString() },
      { id: "3", title: "Severance", type: "show", year: 2022, thumb: null, addedAt: new Date().toISOString() },
    ]);
    return;
  }

  try {
    if (serverType === "jellyfin") {
      const r = await httpClient.get(`${baseUrl}/Items`, {
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
      });
      const items = (r.data?.Items ?? []).map((item: { Id: string; Name: string; Type: string; ProductionYear?: number; ImageTags?: { Primary?: string }; DateCreated?: string }) => ({
        id: item.Id,
        title: item.Name,
        type: item.Type.toLowerCase(),
        year: item.ProductionYear ?? null,
        thumb: item.ImageTags?.Primary
          ? `${baseUrl}/Items/${item.Id}/Images/Primary?api_key=${apiKey}&maxHeight=200`
          : null,
        addedAt: item.DateCreated ?? null,
      }));
      res.json(items);
    } else {
      // Plex — recently added items. The token rides as the X-Plex-Token header
      // and is also appended to thumbnail URLs so the browser can load them.
      const r = await httpClient.get(`${baseUrl}/library/recentlyAdded`, {
        headers: { "X-Plex-Token": apiKey, Accept: "application/json" },
      });
      const items = (r.data?.MediaContainer?.Metadata ?? []).slice(0, 6).map((item: { ratingKey: string; title: string; type: string; year?: number; thumb?: string; addedAt?: number }) => ({
        id: String(item.ratingKey),
        title: item.title,
        type: item.type,
        year: item.year ?? null,
        thumb: item.thumb ? `${baseUrl}${item.thumb}?X-Plex-Token=${apiKey}` : null,
        addedAt: item.addedAt ? new Date(item.addedAt * 1000).toISOString() : null,
      }));
      res.json(items);
    }
  } catch (err) {
    logger.error({ err }, "Media widget error");
    res.status(502).json({ error: "Failed to fetch media data" });
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
    logger.error({ err }, "Sonarr widget error");
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
    logger.error({ err }, "Radarr widget error");
    res.status(502).json({ error: "Failed to fetch Radarr data" });
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
        { name: "ubuntu-24.04-desktop-amd64.iso", progress: 73.5, state: "downloading", dlSpeed: 5.2e6, upSpeed: 1.1e5 },
        { name: "archlinux-x86_64.iso", progress: 100, state: "uploading", dlSpeed: 0, upSpeed: 8.4e5 },
      ],
      downloadSpeed: 5.2e6,
      uploadSpeed: 9.5e5,
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

    const torrents = ((torrentsRes.data ?? []) as Array<{ name: string; progress: number; state: string; dlspeed: number; upspeed: number }>)
      .slice(0, 8)
      .map((t) => ({
        name: t.name,
        progress: Math.round((t.progress ?? 0) * 100),
        state: t.state,
        dlSpeed: t.dlspeed ?? 0,
        upSpeed: t.upspeed ?? 0,
      }));

    const transfer = (transferRes.data ?? {}) as { dl_info_speed?: number; up_info_speed?: number };

    res.json({
      torrents,
      downloadSpeed: transfer.dl_info_speed ?? 0,
      uploadSpeed: transfer.up_info_speed ?? 0,
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
    logger.error({ err }, "qBittorrent widget error");
    res.status(502).json({ error: "Failed to fetch qBittorrent data" });
  }
});

// ────────────────────────────────────────────────
// Pi-hole Widget
// ────────────────────────────────────────────────
// Targets the Pi-hole v5 `admin/api.php` endpoint. `summaryRaw` returns numeric
// (un-formatted) values so we don't have to parse comma-grouped strings, and the
// auth token gates the privileged fields (status, query/block counts).
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
    const r = await httpClient.get(`${baseUrl}/admin/api.php`, {
      params: { summaryRaw: "", auth: apiKey ?? "" },
    });

    const data = (r.data ?? {}) as {
      dns_queries_today?: unknown;
      ads_blocked_today?: unknown;
      ads_percentage_today?: unknown;
      domains_being_blocked?: unknown;
      status?: unknown;
    };

    // Pi-hole answers 200 even when the auth token is wrong or the request hit a
    // non-Pi-hole host; in those cases the privileged summary fields are absent.
    // Treat a missing `status` string or non-numeric query count as a failure so
    // the tile surfaces an error instead of zeros.
    const status = data.status;
    const queries = Number(data.dns_queries_today);
    if (typeof status !== "string" || Number.isNaN(queries)) {
      logger.warn({ baseUrl }, "Pi-hole returned an unexpected payload (check API key/URL)");
      res.status(502).json({ error: "Invalid Pi-hole response — check the URL and API key" });
      return;
    }

    res.json({
      queriesTotal: queries,
      adsBlocked: Number(data.ads_blocked_today) || 0,
      adsPercentage: Number(data.ads_percentage_today) || 0,
      domainsBlocked: Number(data.domains_being_blocked) || 0,
      status: status === "enabled" ? "enabled" : "disabled",
    });
  } catch (err) {
    logger.error({ err }, "Pi-hole widget error");
    res.status(502).json({ error: "Failed to fetch Pi-hole data" });
  }
});

export default router;
