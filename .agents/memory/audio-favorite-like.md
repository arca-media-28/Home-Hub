---
name: Audio Player like/favorite
description: How the Audio Player tile's heart button maps "liked" across Plex/Subsonic/Jellyfin, and why Spotify is excluded.
---

The Audio Player tile has a heart that favorites the now-playing track on the
connected source. One endpoint `POST /widgets/audioplayer/favorite`
{source,id,liked} dispatches per source; reads expose `liked` on AudioTrack.

Per-source mapping (the non-obvious part):
- **Plex** has NO boolean track favorite. Use the user rating: write via
  `PUT /:/rate?key=<id>&identifier=com.plexapp.plugins.library&rating=<n>` with
  `X-Plex-Token`. Like = rating 10; unlike = rating **0**. Plex validates
  `rating` to 0–10 and **rejects the negative "clear" sentinel (-1) with HTTP
  400** — that was the original unlike bug. Reads map a rating >=
  `PLEX_LIKE_THRESHOLD` (8) back to liked, and 0 is under it, so the toggle still
  round-trips.
- **Subsonic/Navidrome**: `star.view` / `unstar.view` with `{id}`. Read state
  from the song's `starred` field (an ISO date present only when starred → treat
  any value as liked).
- **Jellyfin**: favorite is USER-SCOPED — `POST`/`DELETE
  /Users/{jfUserId}/FavoriteItems/{id}`. Must resolve a userId first
  (`GET /Users`, take first, cached ~5min per baseUrl). Crucially, `IsFavorite`
  only populates on item reads when a `userId` query param accompanies the
  `/Items` request; the session's NowPlayingItem rarely carries UserData, so
  backfill the now-playing like state from the userId-scoped album queue entry.

**Why Spotify is excluded** (intentional fast-follow): liking needs the
`user-library-modify`/`user-library-read` OAuth scopes, which the app's Spotify
auth doesn't request. Adding them would force every linked user to re-authorize.
Spotify uses a separate player component anyway, so the heart simply isn't added
there.

Setter contract: each returns "ok" | "unconfigured" (→404) and THROWS on real
API failure (→502 via describeHttpError). Frontend does optimistic update keyed
by track id, invalidates now-playing on success, reverts + shows a destructive
button tone on failure.
