import { Router } from "express";
import { connectionStmts, healthStmts, type DbServiceConnection } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import {
  listImapAccounts,
  addImapAccount,
  removeImapAccount,
  listCalDavAccounts,
  addCalDavAccount,
  removeCalDavAccount,
  type ImapAccount,
  type CalDavAccount,
} from "../lib/mailAccounts.js";
import {
  runPing,
  connectionToValues,
  isConfigured,
  type TestValues,
} from "../lib/ping.js";

const router = Router();

const SUPPORTED_SERVICES = ["truenas", "plex", "jellyfin", "subsonic", "sonarr", "radarr", "lidarr", "qbittorrent", "pihole", "nginx-proxy-manager", "prowlarr", "tailscale", "ersatztv", "stocks"];

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

// ── IMAP / CalDAV multi-account management ────────────────────────────────────
// These lists live in the `extra` JSON of the "imap"/"caldav" rows and support
// several accounts each, so they get dedicated add/remove routes instead of
// the single-connection PUT below. Passwords never leave the server.

function sanitizeImap(a: ImapAccount) {
  return { id: a.id, label: a.label, host: a.host, port: a.port, secure: a.secure, username: a.username };
}
function sanitizeCalDav(a: CalDavAccount) {
  return { id: a.id, label: a.label, url: a.url, username: a.username };
}

// GET /api/connections/imap/accounts
router.get("/imap/accounts", requireAuth, (_req, res) => {
  res.json(listImapAccounts().map(sanitizeImap));
});

// POST /api/connections/imap/accounts
router.post("/imap/accounts", requireAuth, (req, res) => {
  const body = (req.body ?? {}) as {
    label?: string | null;
    host?: string;
    port?: number | null;
    secure?: boolean | null;
    username?: string;
    password?: string;
  };
  if (!body.host?.trim() || !body.username?.trim() || !body.password) {
    res.status(400).json({ error: "host, username and password are required" });
    return;
  }
  const accounts = addImapAccount({
    label: body.label ?? null,
    host: body.host,
    port: typeof body.port === "number" ? body.port : null,
    secure: typeof body.secure === "boolean" ? body.secure : null,
    username: body.username,
    password: body.password,
  });
  res.json(accounts.map(sanitizeImap));
});

// DELETE /api/connections/imap/accounts/:id
router.delete("/imap/accounts/:id", requireAuth, (req, res) => {
  const next = removeImapAccount(String(req.params["id"]));
  if (next === null) {
    res.status(404).json({ error: "No IMAP account with that id" });
    return;
  }
  res.json(next.map(sanitizeImap));
});

// GET /api/connections/caldav/accounts
router.get("/caldav/accounts", requireAuth, (_req, res) => {
  res.json(listCalDavAccounts().map(sanitizeCalDav));
});

// POST /api/connections/caldav/accounts
router.post("/caldav/accounts", requireAuth, (req, res) => {
  const body = (req.body ?? {}) as {
    label?: string | null;
    url?: string;
    username?: string;
    password?: string;
  };
  if (!body.url?.trim() || !body.username?.trim() || !body.password) {
    res.status(400).json({ error: "url, username and password are required" });
    return;
  }
  const accounts = addCalDavAccount({
    label: body.label ?? null,
    url: body.url,
    username: body.username,
    password: body.password,
  });
  res.json(accounts.map(sanitizeCalDav));
});

// DELETE /api/connections/caldav/accounts/:id
router.delete("/caldav/accounts/:id", requireAuth, (req, res) => {
  const next = removeCalDavAccount(String(req.params["id"]));
  if (next === null) {
    res.status(404).json({ error: "No CalDAV account with that id" });
    return;
  }
  res.json(next.map(sanitizeCalDav));
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
