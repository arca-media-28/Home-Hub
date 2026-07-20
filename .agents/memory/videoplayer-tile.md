---
name: Video Player tile
description: Video Player tile sources, playback semantics, and yule-log-vs-error rule
---
- Unconfigured/sample = royalty-free yule log webm (Wikimedia Commons URL constant in VideoPlayerTile), muted+looped with a "Yule log" badge; a CONFIGURED source that fails must show the explicit error state — never fall back to the yule log.
- Sources share one seam: uploads/urls are settings-only lists; plex/jellyfin go through /widgets/videoplayer(+/libraries) with ?server= (reuses the audio-player connection resolvers); YouTube hands playback to an iframe embed (youtubeEmbedSrc parses watch/youtu.be/shorts/playlist/bare-id; single-loop needs playlist=<same id>).
- Uploads backend accepts video/mp4+webm pass-through up to 200MB (images still 10MB, sniffed); video uploads filtered client-side by mimetype startsWith("video/").
- Plex show libraries return show containers with no playable parts — re-query with type=4 (episodes) for direct-play URLs; playlist capped at 200.
- **Why:** the yule-log-vs-error split is a task requirement (silent fallback hides broken servers); the audio-connection reuse keeps one saved Plex/Jellyfin connection powering both tiles.
- Playback survives page switches AND full reloads via a localStorage store (`homehub:videoPlayback`, tileId-keyed, playlist-URL fingerprint, 14-day max-age, 40-entry cap; save on unmount + visibilitychange + pagehide) (order/pos/url/time/muted/volume/playing). Gotchas: at passive-effect cleanup React has already nulled videoRef, so the timestamp must come from a ref updated on timeupdate/seeked; clamp the restored time just shy of duration (never reject) or short clips skip the restore; e2e seek tests need route.fulfill to answer Range requests with 206 or Chromium marks the media unseekable (seekable end = 0) and currentTime writes no-op.
- **How to apply:** any new video source plugs in behind videoSource; remember pickTileSettings whitelist AND the local TileSettings interface in api-server tiles.ts (both must list new video* keys or saves silently drop/typecheck fails).
