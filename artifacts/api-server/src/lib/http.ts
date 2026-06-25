import axios, { type AxiosInstance } from "axios";
import https from "https";

// Default timeout for all outbound service requests (ms).
export const HTTP_TIMEOUT = 6000;

// Homelab services (TrueNAS, Plex, and others) very commonly serve their API
// over HTTPS with a self-signed certificate. Node's default agent rejects those
// certs, which makes every HTTPS connection fail before a request is even sent.
// This agent accepts them so a configured service actually connects.
const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

// Shared axios instance used by every widget route and the test/ping logic, so a
// connection test that passes also means the widget will work. Standardizes the
// timeout and the self-signed-TLS handling in one place.
//
// NOTE: this client disables TLS verification, which is appropriate for LAN
// homelab services that serve self-signed certs — but NOT for calls to public
// cloud APIs over the internet, where a bearer token would be exposed to MITM.
// Use `cloudHttpClient` for any internet-hosted, token-bearing API.
export const httpClient: AxiosInstance = axios.create({
  timeout: HTTP_TIMEOUT,
  httpsAgent: insecureHttpsAgent,
  // Don't auto-throw on >=300 here; callers decide. Keep axios default (throws
  // on non-2xx) so individual routes can surface a clear error state.
});

// Secure axios instance for public cloud APIs (e.g. api.tailscale.com). Uses
// Node's default TLS validation so bearer tokens are never sent over a
// connection whose certificate hasn't been verified.
export const cloudHttpClient: AxiosInstance = axios.create({
  timeout: HTTP_TIMEOUT,
});

// Normalize a user-entered base URL so axios always gets an absolute URL:
// prepend "http://" when no scheme is present and strip trailing slashes.
// Without a scheme, axios treats the value as a relative path and the request
// fails before it leaves the process. Returns undefined for empty input.
export function normalizeBaseUrl(url: string | undefined | null): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

// Turn an arbitrary thrown error (usually an AxiosError) into a short,
// user-facing message. Shared so the on-demand test, the background scheduler,
// and the widget routes all describe failures the same way.
export function normalizeHttpError(err: unknown): string {
  // Service-specific expected failures (e.g. PiholeError) carry a ready-to-show
  // message. Surface it verbatim instead of a generic string. Checked by name
  // to avoid an import cycle with the service helpers.
  if (err instanceof Error && err.name === "PiholeError") {
    return err.message;
  }
  if (axios.isAxiosError(err)) {
    if (err.response) {
      const status = err.response.status;
      return status === 401 || status === 403
        ? "Authentication failed — check your credentials."
        : `Service responded with an error (${status}).`;
    }
    if (err.code === "ECONNABORTED") {
      return "Connection timed out.";
    }
    return "Could not reach service — check the URL and port.";
  }
  return "Could not reach service";
}

// Structured failure detail for diagnostics. Unlike normalizeHttpError (which
// collapses everything to a short user-facing string and DISCARDS the response
// body), this preserves the upstream HTTP status, error code, and — crucially —
// the full response body. Many services (TrueNAS reporting/get_data among them)
// explain exactly WHY a request was rejected in that body, so a diagnostic must
// not throw it away. Never include request headers/credentials here.
export interface HttpFailureDetail {
  status: number | null;
  code: string | null;
  message: string;
  body: unknown;
}

export function describeHttpError(err: unknown): HttpFailureDetail {
  if (axios.isAxiosError(err)) {
    return {
      status: err.response?.status ?? null,
      code: err.code ?? null,
      message: err.message,
      body: err.response?.data ?? null,
    };
  }
  if (err instanceof Error) {
    return { status: null, code: null, message: err.message, body: null };
  }
  return { status: null, code: null, message: String(err), body: null };
}
