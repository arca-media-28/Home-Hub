import axios from "axios";
import type { DbServiceConnection } from "./db.js";

export interface TestValues {
  url?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  token?: string;
}

export interface TestResult {
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
export async function pingService(service: string, v: TestValues): Promise<TestResult> {
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

// Wrap pingService with consistent axios error handling so both the on-demand
// test route and the background scheduler report failures identically.
export async function runPing(service: string, values: TestValues): Promise<TestResult> {
  try {
    return await pingService(service, values);
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
    return { ok: false, message };
  }
}

// Convert a stored connection row into the loosely-typed values pingService
// expects, pulling the Plex token out of the JSON `extra` blob.
export function connectionToValues(c: DbServiceConnection): TestValues {
  let token: string | undefined;
  if (c.extra) {
    try {
      const parsed = JSON.parse(c.extra) as { token?: string };
      token = parsed.token ?? undefined;
    } catch {
      token = undefined;
    }
  }

  return {
    url: c.url ?? undefined,
    apiKey: c.api_key ?? undefined,
    username: c.username ?? undefined,
    password: c.password ?? undefined,
    token,
  };
}

// A connection is "configured" — worth health-checking — once it has a base URL.
// Services missing credentials simply report as not-ok and never trigger a
// false "went down" alert because the dashboard only alerts on healthy→down.
export function isConfigured(values: TestValues): boolean {
  return Boolean(values.url?.trim());
}
