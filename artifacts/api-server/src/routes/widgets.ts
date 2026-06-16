import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { connectionStmts } from "../lib/db.js";
import { httpClient, normalizeBaseUrl, normalizeHttpError } from "../lib/http.js";
import { fetchPiholeData } from "../lib/pihole.js";
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

// Build an app.plex.tv deep link for a single item so clicking its cover opens
// it directly in Plex. Needs the server's machineIdentifier (from the Plex
// MediaContainer root) and the item's ratingKey. Returns null when either is
// missing so callers can omit the link gracefully.
function plexDeepLink(machineId: string | undefined, ratingKey: string | undefined): string | null {
  if (!machineId || ratingKey == null) return null;
  const key = encodeURIComponent(`/library/metadata/${ratingKey}`);
  return `https://app.plex.tv/desktop/#!/server/${machineId}/details?key=${key}`;
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

  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  // The reporting endpoint must be a POST with the query as the JSON body.
  // (Issuing a GET with a body does not reliably send the payload.) The modern
  // Netdata-based backend (SCALE 24.04+, incl. 25.10 "Goldeye") rejects the old
  // relative time strings ("now-30s"/"now") — `start`/`end` must be integer unix
  // timestamps (seconds). Request a short trailing window and aggregate it.
  const nowSec = Math.floor(Date.now() / 1000);
  const reportingBody = {
    graphs: [{ name: "cpu" }, { name: "memory" }],
    reporting_query: { start: nowSec - 60, end: nowSec, aggregate: true },
  };

  // The reporting (CPU/RAM) and pool (storage) calls are independent. Settle
  // them separately so one failing source no longer blanks the whole tile —
  // whatever data is available still renders. Only a fully-unreachable server
  // (both calls fail) returns the 502 "unavailable" state.
  const [reportResult, poolResult] = await Promise.allSettled([
    httpClient.post(`${baseUrl}/api/v2.0/reporting/get_data`, reportingBody, { headers }),
    httpClient.get(`${baseUrl}/api/v2.0/pool`, { headers }),
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
    logger.error(
      { reason: normalizeHttpError(reportResult.reason) },
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

  res.json({ ...reporting, pools });
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
          url: null,
        };
      });
      res.json(items);
    } else {
      // Plex — recently added items. The token rides as the X-Plex-Token header
      // and is also appended to thumbnail URLs so the browser can load them.
      const r = await httpClient.get(`${baseUrl}/library/recentlyAdded`, {
        headers: { "X-Plex-Token": apiKey, Accept: "application/json" },
      });
      // The server's machineIdentifier (on the container root) is needed to build
      // app.plex.tv deep links for each item.
      const machineId: string | undefined = r.data?.MediaContainer?.machineIdentifier;
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
router.get("/media/continue", requireAuth, async (_req, res) => {
  // Resolve the connection the same way the /media route does. Continue Watching
  // is a Plex-only feature, so we only act on a Plex-typed connection.
  const saved = getSavedConnection("plex");
  const savedToken = saved.token || saved.apiKey;

  let serverType = process.env["MEDIA_SERVER_TYPE"] || "jellyfin";
  let baseUrl = process.env["MEDIA_SERVER_URL"];
  let apiKey = process.env["MEDIA_SERVER_API_KEY"];

  if (saved.url && savedToken) {
    serverType = "plex";
    baseUrl = saved.url;
    apiKey = savedToken;
  }

  // Unconfigured (or non-Plex env server) → return built-in sample data so the
  // tile has something to show, consistent with the /media convention.
  if (serverType !== "plex" || !baseUrl || !apiKey) {
    res.json([
      { id: "1", title: "Chapter 7", type: "episode", seriesName: "Severance", thumb: null, progress: 42, url: null },
      { id: "2", title: "Dune: Part Two", type: "movie", seriesName: null, thumb: null, progress: 18, url: null },
    ]);
    return;
  }

  try {
    const r = await httpClient.get(`${baseUrl}/library/onDeck`, {
      headers: { "X-Plex-Token": apiKey, Accept: "application/json" },
    });
    const machineId: string | undefined = r.data?.MediaContainer?.machineIdentifier;
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

export default router;
