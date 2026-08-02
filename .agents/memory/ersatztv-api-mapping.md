---
name: ErsatzTV widget API mapping
description: How the ErsatzTV dashboard tile derives reachability, active streams, and now-playing from ErsatzTV's no-auth IPTV endpoints.
---

ErsatzTV is a homelab live/linear TV server used **no-auth** here: the connection card and all widget/ping calls need only a base URL (no API key). Reuse the shared self-signed-TLS `httpClient`.

Endpoints (both unauthenticated, fetched as text via `responseType: "text"`):
- `GET /iptv/channels.m3u` — channel list. Reachability/ping uses this. Each channel is an `#EXTINF:` line with `tvg-id`, `tvg-chno` (channel number), `tvg-name`, and the display name after the trailing comma; the next line is the stream URL (ignored).
- `GET /iptv/xmltv.xml` — XMLTV EPG. `<programme channel="<id>" start="YYYYMMDDHHMMSS +0000" stop="...">` with `<title>`. Match the M3U `tvg-id` (fall back to channel number) against the programme `channel` attr.

**Now playing rule:** a programme is current when `start ≤ now < stop` (stop is exclusive, so a show ending exactly now yields the next one). XMLTV time has an optional `±HHMM` offset; absent offset → treat as UTC. Titles may be CDATA or carry XML entities — decode both.

**Up next rule:** the future programme with the *earliest* `start > now` — programmes are NOT guaranteed ordered in the feed, so track the min per channel rather than taking the first future entry. BOTH `/ersatztv/channels` (playable lineup) and the `/ersatztv` monitoring widget expose `upNextTitle`/`upNextStart` (ISO 8601, null when nothing further is scheduled).

**Guide grid schedule:** `/ersatztv/channels` also returns `programs` per channel — programmes overlapping `[now, now+3h)`, sorted after collection (feed is unordered). The guide is ADDITIVE: an XMLTV fetch failure degrades to empty `programs` with a warn log and must never 502 the channel lineup (M3U alone is enough to tune). The Video Player pop-out renders it as a DirecTV-style grid; empty/absent `programs` shows a placeholder row.

**Active streams metric:** comes from `GET /api/sessions` (no-auth) — a JSON array, one entry per active transcode session (MPEG-TS + HLS Segmenter); `activeStreams = array.length`. Fetched with its **own** try/catch so an older instance / missing endpoint / network error returns `null` (tile omits the metric) and **never 502s the whole tile**. Older note that "no endpoint exists" is wrong — `/api/sessions` is the source.

**Widget convention:** unconfigured (no base URL) → sample data; configured-but-fetch-fails → 502. `reachable` is always `true` in a 200 (an unreachable configured server 502s instead); the field exists so the tile can render the "health" metric uniformly.

Metrics (catalog priority): `health`, `activeStreams`, `nowPlaying`, `upNext` (the up-next line rides inside the nowPlaying channel list — it adds a third line per row and bumps the budgeted row height, it is not its own section).

**Video Player live-stream resilience:** hls.js in-instance budgets (3 startLoad + 3 recoverMediaError) are only the first layer — exhaustion triggers destroy + delayed full re-attach (4s, up to 3 auto retries via a ref surviving effect re-runs) before the error/Retry state; FRAG_BUFFERED resets everything. Stop button (Ersatz-only) unmounts the `<video>` and gates the attach effect so segment fetches cease and the ErsatzTV transcoder session winds down. `videoPageSwitchMute` (default true) forces `muted:true` into playback memory on save and mutes live on tab-hide.

**Playback requirements (user-facing):** browsers cannot play raw MPEG-TS — channel Streaming Mode must be **HLS Segmenter**. Audio-but-no-video means the channel's FFmpeg profile outputs a codec the browser can't decode (MPEG-2, or HEVC w/o support) — fix is an H.264 video profile. The Video Player tile shows an audio-only hint badge for this case, and the tile settings modal documents both requirements.

**Guide grid scales to the tile:** ErsatzGuideGrid measures its overlay with a ResizeObserver and derives zoom (1–2×, from height/rows; sizes row/header/channel-col/fonts) and pxPerMin (width/120min, floored at 3.6×zoom). Programmatic scroll-to-now re-applies on scale change; an autoScrollingRef flag stops those synthetic scroll events from being treated as user scrolls (userScrolledRef would otherwise self-disable the reapply).
