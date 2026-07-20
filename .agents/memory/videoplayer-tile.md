---
name: Video Player tile
description: Video Player tile sources, playback semantics, and yule-log-vs-error rule
---
- Unconfigured/sample = royalty-free yule log webm (Wikimedia Commons URL constant in VideoPlayerTile), muted+looped with a "Yule log" badge; a CONFIGURED source that fails must show the explicit error state — never fall back to the yule log.
- Sources share one seam: uploads/urls are settings-only lists; plex/jellyfin go through /widgets/videoplayer(+/libraries) with ?server= (reuses the audio-player connection resolvers); YouTube hands playback to an iframe embed (youtubeEmbedSrc parses watch/youtu.be/shorts/playlist/bare-id; single-loop needs playlist=<same id>).
- Uploads backend accepts video/mp4+webm pass-through up to 200MB (images still 10MB, sniffed); video uploads filtered client-side by mimetype startsWith("video/").
- Plex show libraries return show containers with no playable parts — re-query with type=4 (episodes) for direct-play URLs; playlist capped at 200.
- **Why:** the yule-log-vs-error split is a task requirement (silent fallback hides broken servers); the audio-connection reuse keeps one saved Plex/Jellyfin connection powering both tiles.
- **How to apply:** any new video source plugs in behind videoSource; remember pickTileSettings whitelist AND the local TileSettings interface in api-server tiles.ts (both must list new video* keys or saves silently drop/typecheck fails).
