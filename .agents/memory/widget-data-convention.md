---
name: Widget data + outbound HTTP convention
description: How homelab widget routes decide mock vs error, and the shared self-signed-TLS HTTP client
---

# Widget data convention (api-server)

Rule: a widget route returns built-in **sample/mock data only when the backing
service is genuinely unconfigured** (no saved base URL / required creds). A
configured-but-failing service must surface an **explicit error** (HTTP 502) so
the dashboard tile renders its error state — never silently fall back to mock.

**Why:** the original widgets used `axios(...).catch(() => null)` and then mapped
null to zeros/empty, so a broken/unreachable service looked "fine" with fake
zeroes. Users couldn't tell a real outage from real data. Tiles render an
"unavailable" state on `isError`, so the route must actually error.

**How to apply:** in any new widget route, branch on configured vs not. If
unconfigured → `res.json(sample)`. If configured → make the real calls WITHOUT a
swallowing `.catch`, wrap the whole block in try/catch, and on failure
`res.status(502).json({ error })`.

# Shared outbound HTTP client

`artifacts/api-server/src/lib/http.ts` exports `httpClient` (an axios instance
with a default timeout and an https agent set to `rejectUnauthorized: false`) and
`normalizeHttpError(err)`. Use `httpClient` for ALL outbound service calls in
widgets and ping.

**Why:** homelab services (TrueNAS, Plex, etc.) usually serve HTTPS with
self-signed certs; Node's default agent rejects them so every HTTPS connection
failed before this. The same client backs both the test/ping and the widgets so
"Test connection" passing implies the widget works.

# Service-specific gotchas

- TrueNAS reporting: `POST /api/v2.0/reporting/get_data` with the query in the
  JSON **body** (a GET-with-body does not reliably send it). Response is one
  entry per requested graph; each data row starts with a timestamp, so values
  align to `legend` after dropping column 0. CPU% = 100 − idle. Pool capacity
  comes from ZFS vdev stats (`allocated`/`alloc` used, `size`/`space` total),
  NOT `stats.bytes` (those are I/O counters). **`reporting_query.start`/`end`
  must be integer unix-timestamps (seconds), NOT relative strings.** The modern
  Netdata backend (SCALE 24.04+, incl. 25.10 "Goldeye") rejects `now-30s`/`now`,
  which 502'd the tile while the Settings test (system/info only) still passed —
  classic test-passes-widget-fails. Also: reporting (CPU/RAM) and pool (storage)
  are **independent** — settle them separately (Promise.allSettled), render
  partial data, and only 502 when BOTH fail. Log the failing call by name.
- Sonarr/Radarr: queue needs `includeSeries`/`includeMovie` (+ `includeEpisode`
  for Sonarr) and returns rows under `records`; calendar needs the same include
  flags or titles render blank.
- qBittorrent: cookie auth — `POST /api/v2/auth/login` (form body) → grab the
  session cookie from `set-cookie`, then send it back as `Cookie:` on
  `/api/v2/torrents/info` and `/api/v2/transfer/info`. **Cookie name is version-
  dependent:** v4 uses `SID=...`; v5.x renamed it to `QBT_SID_<port>=...` (the
  suffix is qB's *internal* WebUI port, which can differ from the reachable port
  when behind Docker port-mapping/reverse-proxy). Capture and resend the full
  `name=value` pair verbatim — do NOT hardcode `SID=`. Symptom of the v4-only
  bug against a v5 server: login returns 200 but extract fails → "no session" →
  tile shows unavailable. The **full category catalog** (incl. categories with
  no active torrents) comes from `GET /api/v2/torrents/categories` — an OBJECT
  keyed by category name (use `Object.keys`), NOT derivable from torrents/info.
  Fetch it best-effort (own try/catch → empty list on failure) so it never
  breaks the torrents/transfer response; the widget exposes it as `categories`.
- NPM (Nginx Proxy Manager) v2 API: auth via `POST /api/tokens`
  ({identity:email, secret:password}) → bearer token. Data endpoints use
  **hyphens**: `/api/nginx/proxy-hosts` and `/api/nginx/dead-hosts` (NOT
  `dead_hosts`). Symptom of the underscore typo: "Test connection" shows
  **Connected** (ping only does the token login) but the tile shows
  **unavailable** — the widget logs in fine, then the dead-hosts call 404s,
  `Promise.all` rejects (not a 401), and the route 502s. Lesson: a passing test
  + failing tile means the bug is in a widget-only data call, not auth/config.
- Pi-hole supports BOTH v5 and v6 via auto-detect in `lib/pihole.ts`
  (`fetchPiholeData`), shared by the widget route, ping, and health check. v6
  removed `admin/api.php` (returns HTTP 400) and uses a session REST API: `POST
  /api/auth` {password} → `{session:{valid,sid}}`; pass `sid` in the `X-FTL-SID`
  header to `GET /api/stats/summary` (queries.total/blocked/percent_blocked,
  gravity.domains_being_blocked) and `GET /api/dns/blocking` (blocking:enabled).
  Detection: try v6 first; on the /api/auth catch, read `err.response?.status`
  DIRECTLY (do NOT rely on `axios.isAxiosError` — the test harness fakes errors
  without the `isAxiosError` flag) → 401 = wrong password (throw PiholeError),
  any other status = fall back to v5 `admin/api.php`, no `.response` = real
  network error (rethrow). Passwordless v6 returns `sid:null` → skip the header.
  Best-effort `DELETE /api/auth` to free the session (FTL caps concurrent
  sessions). Expected failures throw `PiholeError` (name checked by
  `normalizeHttpError` to surface its message verbatim — avoids an import cycle).
- **Error logging:** widget catch-all branches must log
  `logger.error({ reason: normalizeHttpError(err) }, "...")`, NOT
  `logger.error({ err }, ...)`. Logging the raw axios error serializes a
  ~2000-line object per failure (floods the LAN container logs and buries the
  real cause). normalizeHttpError gives a one-line reason (timeout/refused/4xx).
