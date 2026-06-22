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
- **How to apply:** add the source to the OpenAPI `source` enum + the `audioSource` Select in `TileEditModal`, then branch in the `/audioplayer` route.

## Spotify source
- Manual OAuth (no Replit integration). Creds + tokens live in the `service_connections` row keyed `spotify` (`api_key`=clientId, `password`=clientSecret, `extra`=JSON tokens). Spotify is NOT in the generic SERVICES/health-scheduler — it has its own Settings card and `/connections/spotify/*` routes mounted BEFORE the generic connections router.
- OAuth base-path trap: `/api` is proxied at HOST ROOT but the SPA is served under `BASE_PATH`. Frontend sends authorize body `origin = window.location.origin + import.meta.env.BASE_URL`; backend derives redirectUri = `<hostOrigin>/api/connections/spotify/callback` and returnTo = `<base>/settings`. Callback redirects to `returnTo?spotify=connected|error`.
- OAuth-in-iframe trap: `accounts.spotify.com` sets `frame-ancestors`, and the Replit preview is an iframe — so `window.location.href = authUrl` shows "refused to connect". Open the consent flow in a TOP-LEVEL popup: `window.open("about:blank", …)` SYNCHRONOUSLY in the click handler (before the await, or the popup blocker kills it), then set `popup.location.href` once authorize resolves. The callback returns to `/settings?spotify=…`; that page detects `window.opener` (it's the popup) → `postMessage({type:"spotify-auth",result}, origin)` + `window.close()`; the dashboard tab listens for that message → invalidate status query + toast. Top-level (no opener) path keeps the inline toast + param-strip.
- `/widgets/audioplayer?source=spotify` returns `{auth:"needed"|"connected", premium, canControl, device, nowPlaying, queue}`; tile branches: auth=needed → Connect CTA, no device → no-device state, else now-playing + remote controls via `POST /widgets/spotify/command` (actions play/pause/next/previous/transfer; Spotify 404 = no active device → return 404).
- Premium-only in-browser playback via Web Playback SDK (`useSpotifyPlayback` in `SpotifyAudioPlayer.tsx`, token from `GET /connections/spotify/token`); non-Premium degrades to remote-only. When SDK plays, pause the shared HTMLAudioElement engine (added `pause()` to `audioPlayer.tsx`).
- "Play in browser" transfer trap: handing playback to the SDK device (`PUT /me/player {device_ids,play:true}`, our `transfer` command) returns Spotify **404 "Device not found"** unless `player.activateElement()` was called FIRST, synchronously inside the click gesture (browser autoplay policy gates the SDK device). Hook exposes `activate()`; click does `await sdk.activate()` then transfer. Also note the SDK needs EME/`encrypted-media` — the Replit preview iframe may block it, so real in-browser audio may only work in a full browser tab.
- Generated client `source` param is a typed enum — pass `{ source: "spotify" as const }` or tsc rejects the plain string.

## Gotchas
- Demo now-playing reports `state:"playing"`, so the play/pause toggle's accessible name is **"Pause"** (not "Play") in tests.
- The api-server Replit workflow `dev` script is `build && start` (NO watch). After editing backend routes you MUST restart the `artifacts/api-server: API Server` workflow or requests 404 / hit stale code. (The `--watch` loop only exists under `pnpm run dev:local`.)
