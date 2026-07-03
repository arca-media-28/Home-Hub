---
name: Client-side tile fetches get blocked
description: Why browser-direct third-party API calls fail for some users and the server-side pattern that fixes it
---

**Rule:** Dashboard tiles should not fetch third-party APIs directly from the browser. Route them through the API server as a `/widgets/*` endpoint, even when the API is keyless and CORS-friendly.

**Why:** Direct browser requests to third-party hosts get blocked by ad blockers, DNS filters (Pi-hole — common in this homelab audience), strict privacy modes, and embedded-iframe restrictions. The tile then shows a generic "Failed to fetch" even though the API is up (server can reach it fine).

**How to apply:**
- Weather was migrated this way: `GET /api/widgets/weather` accepts `lat`+`lon` OR `city`, plus `units=c|f`; the server does reverse geocoding (BigDataCloud, best-effort → "Current location"), city geocoding (Open-Meteo geocoding API), and the forecast call. No `service_connections` row needed — it's keyless.
- Use `cloudHttpClient` (TLS-verifying) for these public cloud APIs, never the insecure `httpClient`.
- Error contract: 400 when neither coords nor city given, 404 with `Couldn't find "X"` for an un-geocodable city, 502 with a specific "Weather service unreachable…" message when upstream fails. The tile surfaces the `{error}` body verbatim (via `ApiError.data`).
- Browser geolocation still runs client-side (only the browser can ask permission); only the resulting coords are sent to the server.
- Sports (ESPN) and Sleeper tiles are still browser-direct by explicit task scoping — they share the same vulnerability if users report similar failures.
