import { Router } from "express";
import { connectionStmts, healthStmts, type DbServiceConnection } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import {
  runPing,
  connectionToValues,
  isConfigured,
  type TestValues,
} from "../lib/ping.js";

const router = Router();

const SUPPORTED_SERVICES = ["truenas", "plex", "jellyfin", "sonarr", "radarr", "qbittorrent", "pihole", "nginx-proxy-manager", "prowlarr", "tailscale", "ersatztv"];

function formatConnection(c: DbServiceConnection) {
  let token: string | null = null;
  if (c.extra) {
    try {
      const parsed = JSON.parse(c.extra) as { token?: string };
      token = parsed.token ?? null;
    } catch {
      token = null;
    }
  }

  return {
    service: c.service,
    url: c.url,
    apiKey: c.api_key,
    username: c.username,
    password: c.password,
    token,
    updatedAt: c.updated_at,
  };
}

// GET /api/connections — list all saved service connections
router.get("/", requireAuth, (_req, res) => {
  const rows = connectionStmts.findAll.all();
  res.json(rows.map(formatConnection));
});

// GET /api/connections/health — last-known health of each checked connection,
// produced by the background scheduler and polled by the dashboard.
router.get("/health", requireAuth, (_req, res) => {
  const rows = healthStmts.findAll.all();
  res.json(
    rows.map((r) => ({
      service: r.service,
      ok: Boolean(r.ok),
      message: r.message,
      checkedAt: r.checked_at,
    })),
  );
});

// GET /api/connections/status — ping every saved connection right now and report
// whether each backing service is currently reachable. Reuses runPing so the
// dashboard badges show the same status the on-demand test would.
router.get("/status", requireAuth, async (_req, res) => {
  const rows = connectionStmts.findAll.all();
  const bySaved = new Map(rows.map((r) => [r.service, r]));

  const statuses = await Promise.all(
    SUPPORTED_SERVICES.map(async (service) => {
      const row = bySaved.get(service);
      const values = row ? connectionToValues(row) : null;
      if (!values || !isConfigured(values)) {
        return { service, configured: false, ok: false, message: "Not configured" };
      }
      const result = await runPing(service, values);
      return { service, configured: true, ok: result.ok, message: result.message };
    }),
  );

  res.json(statuses);
});

// PUT /api/connections/:service — upsert a single service's connection
router.put("/:service", requireAuth, (req, res) => {
  const service = String(req.params["service"]);

  if (!SUPPORTED_SERVICES.includes(service)) {
    res.status(400).json({ error: `Unsupported service: ${service}` });
    return;
  }

  const body = req.body as {
    url?: string;
    apiKey?: string;
    username?: string;
    password?: string;
    token?: string;
  };

  const extra = body.token !== undefined ? JSON.stringify({ token: body.token }) : null;

  connectionStmts.upsert.run(
    service,
    body.url ?? null,
    body.apiKey ?? null,
    body.username ?? null,
    body.password ?? null,
    extra
  );

  const updated = connectionStmts.findByService.get(service)!;
  res.json(formatConnection(updated));
});

// POST /api/connections/:service/test — ping a service using supplied values
router.post("/:service/test", requireAuth, async (req, res) => {
  const service = String(req.params["service"]);

  if (!SUPPORTED_SERVICES.includes(service)) {
    res.status(400).json({ error: `Unsupported service: ${service}` });
    return;
  }

  const body = (req.body ?? {}) as TestValues;

  const result = await runPing(service, body);
  res.json(result);
});

export default router;
