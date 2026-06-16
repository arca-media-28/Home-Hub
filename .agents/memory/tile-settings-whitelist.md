---
name: tileSettings persistence whitelist
description: Why a new per-tile setting can save with HTTP 200 yet silently never persist
---

Per-tile config (`tileSettings`) is NOT stored field-for-field. The api-server tiles route has a hand-written `pickTileSettings()` allow-list (in `routes/tiles.ts`) that is applied on BOTH serialize (request body → DB) and parse (DB → response). Any key not explicitly listed there is silently dropped.

**Why:** Adding a new setting to the OpenAPI `TileSettings` schema + regenerating the client + wiring the edit modal is NOT enough. The PUT/POST returns 200 and the tile re-renders in its unconfigured/demo state because the value was stripped before it ever hit the column. This looks like a frontend caching bug but is a backend allow-list omission.

**How to apply:** When adding ANY new per-tile setting, also extend the `TileSettings` interface AND the `pickTileSettings()` body in `artifacts/api-server/src/routes/tiles.ts` with a typeof/null check matching the existing pattern. Verify with an e2e that sets the value, reopens the editor, and confirms the configured (not demo) state renders.
