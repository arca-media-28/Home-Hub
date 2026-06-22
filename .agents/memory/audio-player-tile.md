---
name: Audio Player tile + app-level audio engine
description: How the Audio Player tile and the shared playback engine are structured, and the source seam for adding new music sources
---

# Audio Player tile

## App-level playback engine
- A single `AudioPlayerProvider`/`useAudioPlayer` owns ONE `HTMLAudioElement` mounted in `App.tsx`, so playback persists across navigation and only one stream plays at a time.
- A tile "owns" the global player via `ownerId = "audioplayer:<source>"`; the tile shows the live player track when it is the owner, else the backend's reported now-playing.
- **Why:** the brief requires single-stream, navigation-persistent audio with a clean seam for future sources.

## Source seam (adding a new music source)
- Backend `/widgets/audioplayer` takes `?source=` (enum in OpenAPI); frontend stores the choice in `TileSettings.audioSource` (must stay in the `pickTileSettings` whitelist in api-server `routes/tiles.ts` or it silently reverts to demo).
- A track is streamable only if it carries `streamUrl`; demo/sample payloads set `streamUrl=null`, which disables in-browser controls.
- **How to apply:** add the source to the OpenAPI `source` enum + the `audioSource` Select in `TileEditModal`, then branch in the `/audioplayer` route. Spotify is the queued follow-up.

## Gotchas
- Demo now-playing reports `state:"playing"`, so the play/pause toggle's accessible name is **"Pause"** (not "Play") in tests.
- The api-server Replit workflow `dev` script is `build && start` (NO watch). After editing backend routes you MUST restart the `artifacts/api-server: API Server` workflow or requests 404 / hit stale code. (The `--watch` loop only exists under `pnpm run dev:local`.)
