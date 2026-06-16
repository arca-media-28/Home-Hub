import { httpClient, cloudHttpClient, normalizeHttpError, normalizeBaseUrl, HTTP_TIMEOUT } from "./http.js";
import { fetchPiholeData } from "./pihole.js";
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

const TIMEOUT = HTTP_TIMEOUT;

// Ping a single service using the supplied values. Each branch hits a cheap,
// auth-protected endpoint so a 2xx response confirms both reachability and
// valid credentials.
export async function pingService(service: string, v: TestValues): Promise<TestResult> {
  // Tailscale is a cloud service: it has no per-user base URL. We reuse the
  // `url` field to carry the tailnet name and `apiKey` for the API access token,
  // hitting the fixed api.tailscale.com host instead of a LAN URL.
  if (service === "tailscale") {
    const tailnet = v.url?.trim();
    const token = v.apiKey?.trim();
    if (!tailnet) return { ok: false, message: "Enter a tailnet name first." };
    if (!token) return { ok: false, message: "Enter an API access token first." };
    // Secure (TLS-verifying) client: this is a public cloud API carrying a token.
    await cloudHttpClient.get(
      `https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(tailnet)}/devices`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return { ok: true, message: "Connected" };
  }

  const base = normalizeBaseUrl(v.url);
  if (!base) {
    return { ok: false, message: "Enter a Base URL first." };
  }

  switch (service) {
    case "truenas": {
      if (!v.apiKey) return { ok: false, message: "Enter an API Key first." };
      await httpClient.get(`${base}/api/v2.0/system/info`, {
        headers: { Authorization: `Bearer ${v.apiKey}` },
      });
      return { ok: true, message: "Connected" };
    }
    case "plex": {
      const plexToken = v.token?.trim() || v.apiKey?.trim();
      if (!plexToken) return { ok: false, message: "Enter a Plex Token or API Key first." };
      await httpClient.get(`${base}/identity`, {
        headers: { "X-Plex-Token": plexToken, Accept: "application/json" },
      });
      return { ok: true, message: "Connected" };
    }
    case "sonarr":
    case "radarr": {
      if (!v.apiKey) return { ok: false, message: "Enter an API Key first." };
      await httpClient.get(`${base}/api/v3/system/status`, {
        headers: { "X-Api-Key": v.apiKey },
      });
      return { ok: true, message: "Connected" };
    }
    case "qbittorrent": {
      if (!v.username || !v.password) {
        return { ok: false, message: "Enter a username and password first." };
      }
      const form = new URLSearchParams({ username: v.username, password: v.password });
      const r = await httpClient.post(`${base}/api/v2/auth/login`, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (typeof r.data === "string" && r.data.trim() === "Fails.") {
        return { ok: false, message: "Invalid username or password." };
      }
      return { ok: true, message: "Connected" };
    }
    case "nginx-proxy-manager": {
      if (!v.username || !v.password) {
        return { ok: false, message: "Enter an email and password first." };
      }
      // NPM's v2 API mints a session token from email (identity) + password
      // (secret). A token in the response confirms valid credentials.
      const r = await httpClient.post(
        `${base}/api/tokens`,
        { identity: v.username, secret: v.password },
        { headers: { "Content-Type": "application/json" } },
      );
      const token = (r.data as { token?: string } | undefined)?.token;
      if (!token) return { ok: false, message: "Invalid email or password." };
      return { ok: true, message: "Connected" };
    }
    case "prowlarr": {
      if (!v.apiKey) return { ok: false, message: "Enter an API Key first." };
      await httpClient.get(`${base}/api/v1/system/status`, {
        headers: { "X-Api-Key": v.apiKey },
      });
      return { ok: true, message: "Connected" };
    }
    case "pihole": {
      if (!v.apiKey) return { ok: false, message: "Enter an API Key first." };
      // Auto-detect v6 (REST API) vs v5 (admin/api.php). A successful fetch
      // confirms both reachability and valid credentials; bad credentials or an
      // unrecognizable payload throw a PiholeError that runPing turns into a
      // clear message.
      await fetchPiholeData(base, v.apiKey);
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
    return { ok: false, message: normalizeHttpError(err) };
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
