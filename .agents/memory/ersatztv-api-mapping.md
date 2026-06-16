---
name: ErsatzTV widget API mapping
description: How the ErsatzTV dashboard tile derives reachability, active streams, and now-playing from ErsatzTV's no-auth IPTV endpoints.
---

ErsatzTV is a homelab live/linear TV server used **no-auth** here: the connection card and all widget/ping calls need only a base URL (no API key). Reuse the shared self-signed-TLS `httpClient`.

Endpoints (both unauthenticated, fetched as text via `responseType: "text"`):
- `GET /iptv/channels.m3u` — channel list. Reachability/ping uses this. Each channel is an `#EXTINF:` line with `tvg-id`, `tvg-chno` (channel number), `tvg-name`, and the display name after the trailing comma; the next line is the stream URL (ignored).
- `GET /iptv/xmltv.xml` — XMLTV EPG. `<programme channel="<id>" start="YYYYMMDDHHMMSS +0000" stop="...">` with `<title>`. Match the M3U `tvg-id` (fall back to channel number) against the programme `channel` attr.

**Now playing rule:** a programme is current when `start ≤ now < stop` (stop is exclusive, so a show ending exactly now yields the next one). XMLTV time has an optional `±HHMM` offset; absent offset → treat as UTC. Titles may be CDATA or carry XML entities — decode both.

**Active streams metric:** comes from `GET /api/sessions` (no-auth) — a JSON array, one entry per active transcode session (MPEG-TS + HLS Segmenter); `activeStreams = array.length`. Fetched with its **own** try/catch so an older instance / missing endpoint / network error returns `null` (tile omits the metric) and **never 502s the whole tile**. Older note that "no endpoint exists" is wrong — `/api/sessions` is the source.

**Widget convention:** unconfigured (no base URL) → sample data; configured-but-fetch-fails → 502. `reachable` is always `true` in a 200 (an unreachable configured server 502s instead); the field exists so the tile can render the "health" metric uniformly.

Metrics (catalog priority): `health`, `activeStreams`, `nowPlaying`.
