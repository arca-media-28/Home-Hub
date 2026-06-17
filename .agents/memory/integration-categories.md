---
name: Integration categories + media server param
description: How integrations are grouped into categories and how Plex vs Jellyfin tiles resolve their backing connection.
---

- Shared category model lives in `src/lib/integrationCategories.ts` (dashboard): `categoryOf(key)` + `groupByCategory(items, keyOf)`, order News→Media→Downloads→Server→Other, unmapped→Other. It is keyed by BOTH vocabularies — tile integration values (e.g. `media`) and connection service keys (e.g. `plex`) — both mapping to the same category. Reuse it in any new panel that lists integrations so the two panels never drift.

- Plex and Jellyfin tiles BOTH render via `MediaTile`/`/widgets/media`. They are disambiguated by a `server` query param (`plex`|`jellyfin`), derived in MediaTile from the tile's `integration` value (`jellyfin`→jellyfin, else plex). `WidgetProps.integration` carries it. Backend `/widgets/media` reads the saved `plex` connection for plex and the saved `jellyfin` connection for jellyfin (env MEDIA_SERVER_* is only a last-resort fallback, gated on matching MEDIA_SERVER_TYPE).
  **Why:** a single endpoint serves two media tile types on the same page; without the param both would clobber each other's React Query cache and both would read the Plex connection.
  **How to apply:** any second tile type that shares a widget endpoint needs a distinguishing query param baked into BOTH the request and the React Query key (`getGetMediaRecentQueryKey(params)`), or the tiles collide.

- Jellyfin connection: base URL + apiKey (passed as `?api_key=` query param to Jellyfin, e.g. `/System/Info` for the connection test). Continue Watching is Plex-only — MediaTile gates the `continue` metric on `isPlex`, and Jellyfin's metric catalog only has `recent`.
