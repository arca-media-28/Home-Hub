import { Router } from "express";
import axios from "axios";
import { connectionStmts, type DbServiceConnection } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

const SUPPORTED_SERVICES = ["truenas", "plex", "sonarr", "radarr", "qbittorrent"];

interface TestValues {
  url?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  token?: string;
}

interface TestResult {
  ok: boolean;
  message: string;
}

const TIMEOUT = 6000;

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

// Ping a single service using the supplied values. Each branch hits a cheap,
// auth-protected endpoint so a 2xx response confirms both reachability and
// valid credentials.
async function pingService(service: string, v: TestValues): Promise<TestResult> {
  const url = v.url?.trim();
  if (!url) {
    return { ok: false, message: "Enter a Base URL first." };
  }
  const base = trimSlash(url);

  switch (service) {
    case "truenas": {
      if (!v.apiKey) return { ok: false, message: "Enter an API Key first." };
      await axios.get(`${base}/api/v2.0/system/info`, {
        headers: { Authorization: `Bearer ${v.apiKey}` },
        timeout: TIMEOUT,
      });
      return { ok: true, message: "Connected" };
    }
    case "plex": {
      const plexToken = v.token?.trim() || v.apiKey?.trim();
      if (!plexToken) return { ok: false, message: "Enter a Plex Token or API Key first." };
      await axios.get(`${base}/identity`, {
        headers: { "X-Plex-Token": plexToken, Accept: "application/json" },
        timeout: TIMEOUT,
      });
      return { ok: true, message: "Connected" };
    }
    case "sonarr":
    case "radarr": {
      if (!v.apiKey) return { ok: false, message: "Enter an API Key first." };
      await axios.get(`${base}/api/v3/system/status`, {
        headers: { "X-Api-Key": v.apiKey },
        timeout: TIMEOUT,
      });
      return { ok: true, message: "Connected" };
    }
    case "qbittorrent": {
      if (!v.username || !v.password) {
        return { ok: false, message: "Enter a username and password first." };
      }
      const form = new URLSearchParams({ username: v.username, password: v.password });
      const r = await axios.post(`${base}/api/v2/auth/login`, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: TIMEOUT,
      });
      if (typeof r.data === "string" && r.data.trim() === "Fails.") {
        return { ok: false, message: "Invalid username or password." };
      }
      return { ok: true, message: "Connected" };
    }
    default:
      return { ok: false, message: `Unsupported service: ${service}` };
  }
}

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

// POST /api/connections/:service/test — ping a service using supplied values
router.post("/:service/test", requireAuth, async (req, res) => {
  const service = String(req.params["service"]);

  if (!SUPPORTED_SERVICES.includes(service)) {
    res.status(400).json({ error: `Unsupported service: ${service}` });
    return;
  }

  const body = (req.body ?? {}) as TestValues;

  try {
    const result = await pingService(service, body);
    res.json(result);
  } catch (err) {
    let message = "Could not reach service";
    if (axios.isAxiosError(err)) {
      if (err.response) {
        const status = err.response.status;
        message =
          status === 401 || status === 403
            ? "Authentication failed — check your credentials."
            : `Service responded with an error (${status}).`;
      } else if (err.code === "ECONNABORTED") {
        message = "Connection timed out.";
      } else {
        message = "Could not reach service — check the URL and port.";
      }
    }
    res.json({ ok: false, message });
  }
});

export default router;
