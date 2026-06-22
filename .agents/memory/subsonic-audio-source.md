---
name: Navidrome / Subsonic audio source
description: How the Subsonic-compatible Audio Player source authenticates and is wired into the widget/ping/connections seams
---

# Subsonic / Navidrome audio source

- Service key is `subsonic` (covers Navidrome, Airsonic, Gonic — all share the Subsonic REST API). Stored connection = url + username + password (no apiKey/token).
- **Salted-token auth**: every request needs `u`=username, `t`=md5(password+salt), `s`=random salt, `v`=1.16.1, `c`=client. Helper `lib/subsonic.ts` (`subsonicAuthParams`, `subsonicGet`, `subsonicMediaQuery`). Generate ONE auth per request and reuse its salt for both API calls and the media URLs (stream/cover art) so they stay valid.
- **Subsonic always returns HTTP 200**, even on auth/credential failure — the real status lives in `subsonic-response.status` ("ok"|"failed") with `error.message`. `subsonicGet` throws on a failed status so callers' try/catch surface it as a configured-failure (502) / ping failure. Never trust the HTTP code alone.
- Now-playing from `getNowPlaying.view` (entry may be a single object OR array). Queue = that track's album via `getAlbum.view?id=albumId`. No now-playing → newest album via `getAlbumList2.view?type=newest&size=1` then `getAlbum`.
- Stream URL uses `/rest/stream.view?id=...&format=mp3&<auth>` so the shared `<audio>` engine plays any source codec; artwork uses `/rest/getCoverArt.view?id=<coverArt||albumId>&size=300&<auth>`.
- **Live progress**: Subsonic has no real playback cursor — the ONLY live signal is the now-playing entry's `minutesAgo` (whole minutes since the server last registered the track as playing). `estimateSubsonicProgressMs` derives progressMs = minutesAgo*60_000 clamped to durationMs; absent/invalid → null so the tile degrades to its old no-progress behavior. Coarse (minute-granularity) but real. now-playing entry still gets state "playing".
- Frontend routes `subsonic` to the SAME `StreamAudioPlayer` as Plex/Jellyfin (only Spotify has its own component).
- **Public test server**: https://demo.navidrome.org with demo/demo — handy for verifying the connection test + widget end-to-end.
