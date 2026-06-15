import { httpClient } from "./http.js";

// Normalized Pi-hole summary, identical regardless of whether the data came
// from a v5 (`admin/api.php`) or v6 (`/api/...`) instance.
export interface PiholeData {
  queriesTotal: number;
  adsBlocked: number;
  adsPercentage: number;
  domainsBlocked: number;
  status: "enabled" | "disabled";
}

// Expected (non-network) failure when talking to Pi-hole: wrong password or an
// unrecognizable payload. Carries a user-facing message. The `name` is checked
// by `normalizeHttpError` so these surface verbatim instead of a generic string.
export class PiholeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiholeError";
  }
}

const AUTH_ERROR = "Invalid API key/password.";
const RESPONSE_ERROR = "Invalid Pi-hole response — check the URL and API key.";

// Fetch and normalize Pi-hole stats, auto-detecting the API version.
//
// Pi-hole v6 replaced the legacy `admin/api.php` endpoint with a session-based
// REST API at `/api/`. We try v6 first; if the host doesn't expose that API
// (404), we fall back to the v5 endpoint, so a single saved connection works
// regardless of which version the user runs. Detection is based on the actual
// responses, never on guessing from the URL.
//
// Throws `PiholeError` for wrong credentials / bad payloads, and lets real
// network errors (timeout, refused, unreachable) propagate to the caller.
export async function fetchPiholeData(
  baseUrl: string,
  apiKey: string | undefined,
): Promise<PiholeData> {
  const v6 = await tryV6(baseUrl, apiKey);
  if (v6) return v6;
  return fetchV5(baseUrl, apiKey);
}

// ── v6 (REST API with session login) ───────────────────────────────────────

// Attempt the v6 flow. Returns null when the host is not a v6 instance (so the
// caller falls back to v5). Throws PiholeError on bad credentials.
async function tryV6(baseUrl: string, apiKey: string | undefined): Promise<PiholeData | null> {
  let authData: unknown;
  try {
    const resp = await httpClient.post(
      `${baseUrl}/api/auth`,
      { password: apiKey ?? "" },
      { headers: { "Content-Type": "application/json" } },
    );
    authData = resp.data;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    // A response with a status code means we reached an HTTP server.
    if (status !== undefined) {
      // v6 rejects a wrong app password with 401.
      if (status === 401) throw new PiholeError(AUTH_ERROR);
      // No v6 REST API here (v5 lighttpd serves /admin only, 404), or some other
      // HTTP error — fall back to the legacy v5 endpoint.
      return null;
    }
    // No response at all — real connectivity failure; let the caller surface it.
    throw err;
  }

  const session = (authData as { session?: { valid?: boolean; sid?: string | null } })?.session;
  if (!session) {
    // 200 without a session object — not a recognizable v6 response.
    return null;
  }
  if (session.valid !== true) {
    throw new PiholeError(AUTH_ERROR);
  }

  // sid is null when the instance has no password set; such instances also
  // don't require the SID header on subsequent calls.
  const sid = session.sid ?? undefined;
  try {
    return await fetchV6Stats(baseUrl, sid);
  } finally {
    if (sid) await deleteV6Session(baseUrl, sid).catch(() => {});
  }
}

async function fetchV6Stats(baseUrl: string, sid: string | undefined): Promise<PiholeData> {
  const headers = sid ? { "X-FTL-SID": sid } : {};

  const [summaryResp, blockingResp] = await Promise.all([
    httpClient.get(`${baseUrl}/api/stats/summary`, { headers }),
    httpClient.get(`${baseUrl}/api/dns/blocking`, { headers }),
  ]);

  const summary = (summaryResp.data ?? {}) as {
    queries?: { total?: unknown; blocked?: unknown; percent_blocked?: unknown };
    gravity?: { domains_being_blocked?: unknown };
  };
  const blocking = (blockingResp.data ?? {}) as { blocking?: unknown };

  const queries = Number(summary.queries?.total);
  if (Number.isNaN(queries)) {
    throw new PiholeError(RESPONSE_ERROR);
  }

  return {
    queriesTotal: queries,
    adsBlocked: Number(summary.queries?.blocked) || 0,
    adsPercentage: Number(summary.queries?.percent_blocked) || 0,
    domainsBlocked: Number(summary.gravity?.domains_being_blocked) || 0,
    status: blocking.blocking === "enabled" ? "enabled" : "disabled",
  };
}

// Best-effort logout so we don't pile up sessions on the FTL (which caps the
// number of concurrent sessions). Failures here are intentionally ignored.
async function deleteV6Session(baseUrl: string, sid: string): Promise<void> {
  await httpClient.delete(`${baseUrl}/api/auth`, { headers: { "X-FTL-SID": sid } });
}

// ── v5 (legacy admin/api.php) ───────────────────────────────────────────────

async function fetchV5(baseUrl: string, apiKey: string | undefined): Promise<PiholeData> {
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

  // Pi-hole v5 answers 200 even when the auth token is wrong or the request hit
  // a non-Pi-hole host; in those cases the privileged summary fields are absent.
  // Treat a missing `status` string or non-numeric query count as a failure so
  // the caller surfaces an error instead of zeros.
  const status = data.status;
  const queries = Number(data.dns_queries_today);
  if (typeof status !== "string" || Number.isNaN(queries)) {
    throw new PiholeError(RESPONSE_ERROR);
  }

  return {
    queriesTotal: queries,
    adsBlocked: Number(data.ads_blocked_today) || 0,
    adsPercentage: Number(data.ads_percentage_today) || 0,
    domainsBlocked: Number(data.domains_being_blocked) || 0,
    status: status === "enabled" ? "enabled" : "disabled",
  };
}
