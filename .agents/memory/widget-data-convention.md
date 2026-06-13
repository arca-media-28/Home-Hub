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
  NOT `stats.bytes` (those are I/O counters).
- Sonarr/Radarr: queue needs `includeSeries`/`includeMovie` (+ `includeEpisode`
  for Sonarr) and returns rows under `records`; calendar needs the same include
  flags or titles render blank.
- qBittorrent: cookie auth — `POST /api/v2/auth/login` (form body) → grab `SID`
  from `set-cookie`, then send `Cookie: SID=...` to `/api/v2/torrents/info` and
  `/api/v2/transfer/info`.
