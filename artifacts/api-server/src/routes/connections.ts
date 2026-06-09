import { Router } from "express";
import { connectionStmts, type DbServiceConnection } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

const SUPPORTED_SERVICES = ["truenas", "plex", "sonarr", "radarr", "qbittorrent"];

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

export default router;
