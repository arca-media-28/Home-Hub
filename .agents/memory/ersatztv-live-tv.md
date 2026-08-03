---
name: ErsatzTV live TV in Video Player tile
description: HLS stream proxy + token-query auth pattern for playing ErsatzTV channels in the browser
---

# ErsatzTV live TV (Video Player source "ersatztv")

- Streams proxy through api-server (`/api/widgets/ersatztv/stream/*splat`) because the browser usually can't reach the LAN ErsatzTV host. Only `iptv/` paths allowed (no path traversal).
- **Token-query auth pattern**: native HLS / hls.js media requests can't carry Authorization headers reliably, so the stream proxy accepts the JWT as `?token=` OR Bearer (`ersatzStreamAuth` uses `verifyToken`). The channels endpoint bakes the proxy path into `streamUrl`; the client appends its token (`withAuthToken`).
- Playlist rewriting (`rewriteErsatzPlaylist`, exported for tests): every same-origin URI (plain lines + `URI="…"` attrs) is resolved against the axios **final redirect URL** (`upstream.request.res.responseUrl` — ErsatzTV redirects channel playlists into per-session paths) and rewritten to the proxy prefix with `token` param. Foreign origins left alone. Segments pass through as arraybuffer.
- Frontend: hls.js loaded lazily when URL contains `.m3u8` and no native HLS; **do NOT set `src` on the video element when hls.js attaches** (`src={isHlsUrl && !nativeHls ? undefined : url}`) or it races the MediaSource attach. Fatal HLS error → explicit error state (never yule log when configured).
- Tuned channel persists in `tileSettings.videoErsatzChannel` (string channel number, whitelisted in pickTileSettings); sample lineup has `streamUrl: null` so the tile filters them out and stays in yule-log demo.
- **Why**: token in query is the only way authenticated media segments work across native HLS and hls.js; rewriting against the redirect-followed URL is required or relative segment URIs 404.
- e2e trick: `page.route` the stream URL and never fulfill → hls.js stays "loading" long enough to test the channel pop-out without a real stream.
- Guide programme popover: EVERY block (incl. read-only mode) opens a details popover (title, start–stop, duration, Watch button when airing+tunable); tuning no longer fires from clicking the airing block directly.
- Popover inside the overflow-hidden guide overlay MUST clamp its top using measured offsetHeight vs overlay clientHeight — naive anchor math clips it on small embedded tiles and Playwright clicks get "intercepted" by the overlay div.
