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
export const httpClient: AxiosInstance = axios.create({
  timeout: HTTP_TIMEOUT,
  httpsAgent: insecureHttpsAgent,
  // Don't auto-throw on >=300 here; callers decide. Keep axios default (throws
  // on non-2xx) so individual routes can surface a clear error state.
});

// Turn an arbitrary thrown error (usually an AxiosError) into a short,
// user-facing message. Shared so the on-demand test, the background scheduler,
// and the widget routes all describe failures the same way.
export function normalizeHttpError(err: unknown): string {
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
