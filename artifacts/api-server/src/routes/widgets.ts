import { Router } from "express";
import axios from "axios";
import { requireAuth } from "../lib/auth.js";
import { connectionStmts } from "../lib/db.js";

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
// Uses JSON-RPC 2.0 over HTTP API
// ────────────────────────────────────────────────
router.get("/truenas", requireAuth, async (_req, res) => {
  const saved = getSavedConnection("truenas");
  const baseUrl = saved.url || process.env["TRUENAS_URL"];
  const apiKey = saved.apiKey || process.env["TRUENAS_API_KEY"];

  if (!baseUrl || !apiKey) {
    // Return mock data when not configured
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
    const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" };

    // CPU usage
    const cpuRes = await axios.get(`${baseUrl}/api/v2.0/reporting/get_data`, {
      headers,
      data: JSON.stringify({ graphs: [{ name: "cpu" }], reporting_query: { start: "now-30s", end: "now" } }),
      timeout: 5000,
    }).catch(() => null);

    // Memory
    const memRes = await axios.get(`${baseUrl}/api/v2.0/reporting/get_data`, {
      headers,
      data: JSON.stringify({ graphs: [{ name: "memory" }], reporting_query: { start: "now-30s", end: "now" } }),
      timeout: 5000,
    }).catch(() => null);

    // Pools
    const poolRes = await axios.get(`${baseUrl}/api/v2.0/pool`, { headers, timeout: 5000 }).catch(() => null);

    const cpuPercent = cpuRes?.data?.[0]?.data?.slice(-1)?.[0]?.[1] ?? 0;
    const memData = memRes?.data?.[0]?.data?.slice(-1)?.[0];
    const memUsedGb = memData ? (memData[1] ?? 0) / 1e9 : 0;
    const memTotalGb = memData ? ((memData[1] ?? 0) + (memData[2] ?? 0)) / 1e9 : 0;

    // TrueNAS pool stats: bytes[0] = used, bytes[1] = available (free)
    const pools = (poolRes?.data ?? []).map((p: { name: string; status: string; topology?: { data?: Array<{ stats?: { bytes: number[] } }> } }) => {
      const usedBytes = p.topology?.data?.[0]?.stats?.bytes?.[0] ?? 0;
      const freeBytes = p.topology?.data?.[0]?.stats?.bytes?.[1] ?? 0;
      return {
        name: p.name,
        status: p.status,
        usedBytes,
        totalBytes: usedBytes + freeBytes,
      };
    });

    res.json({ cpuPercent: Number(cpuPercent.toFixed(1)), memUsedGb, memTotalGb, pools });
  } catch (err) {
    console.error("TrueNAS error:", err);
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
      const r = await axios.get(`${baseUrl}/Items`, {
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
        timeout: 5000,
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
      // Plex
      const r = await axios.get(`${baseUrl}/library/recentlyAdded`, {
        headers: { "X-Plex-Token": apiKey, Accept: "application/json" },
        timeout: 5000,
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
    console.error("Media server error:", err);
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
      axios.get(`${baseUrl}/api/v3/queue`, { headers, timeout: 5000 }).catch(() => null),
      axios.get(`${baseUrl}/api/v3/calendar`, {
        headers,
        params: { start: now.toISOString().split("T")[0], end: end.toISOString().split("T")[0] },
        timeout: 5000,
      }).catch(() => null),
    ]);

    const queue = (queueRes?.data?.records ?? []).slice(0, 5).map((item: { id: number; title: string; status: string; sizeleft?: number; size?: number }) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      progress: item.size ? Math.round((1 - (item.sizeleft ?? 0) / item.size) * 100) : 0,
      size: item.size ?? null,
    }));

    const upcoming = (calendarRes?.data ?? []).slice(0, 5).map((ep: { id: number; title: string; series?: { title: string }; airDateUtc?: string; seasonNumber?: number; episodeNumber?: number }) => ({
      id: ep.id,
      title: ep.title,
      seriesTitle: ep.series?.title ?? "",
      airDate: ep.airDateUtc?.split("T")[0] ?? "",
      seasonNumber: ep.seasonNumber ?? null,
      episodeNumber: ep.episodeNumber ?? null,
    }));

    res.json({ queue, upcoming });
  } catch (err) {
    console.error("Sonarr error:", err);
    res.status(502).json({ error: "Failed to fetch Sonarr data" });
  }
});

export default router;
