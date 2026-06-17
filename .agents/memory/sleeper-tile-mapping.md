---
name: Sleeper fantasy tile
description: Durable gotchas for the Sleeper (fantasy sports) live tile in homelab-dashboard
---

# Sleeper fantasy tile

Client-side, keyless live tile (modeled after the ESPN Sports tile). Sleeper's
read endpoints are fully public, so all data is fetched directly in the browser
— there is no api-server widget endpoint and no service connection.

## Non-obvious gotchas
- **Projections live on a different host/base.** League/roster/matchup/state are
  under `https://api.sleeper.app/v1/...`, but projections are at
  `https://api.sleeper.app/projections/<sport>/<season>/<week>` (NO `/v1`). Easy
  to miss and silently 404.
- **Projected score = sum of the matchup entry's `starters` projections**, using
  the column that matches the league's scoring format. Derive the format from
  `league.scoring_settings.rec` (1 → PPR, 0.5 → half-PPR, else standard). The
  matchup endpoint gives actual `points`; projections give the per-player
  estimate — the task requires showing BOTH per team.
- **`starters` contains `"0"` placeholders** for empty lineup slots — filter
  them out before summing.
- Projections are best-effort: on any failure, fall back to actual-only rather
  than failing the whole tile.

## Decisions
- Mapped to the existing **"News"** category (no "Sports" category exists in
  integrationCategories).
- **Sports limited to nfl/nba/lcs** — only sports Sleeper's `/state/<sport>`
  endpoint supports; default nfl.
- Editor uses a lazy **"Load leagues"** picker (resolve username → list that
  user's leagues for the sport+season), mirroring the News "Test feed" pattern.
- Large blobs (`/players/<sport>`, projections) are cached aggressively and
  gated so most tiles never pay for them.

## Recent moves (transactions) rendering
- The feed is grouped **per-transaction**, not per-player: `buildTransactionFeed`
  groups every add/drop by rosterId into `parties` (1 party = waiver/free agent,
  2 parties = trade so both sides show). Sleeper trade `drops` map gives the
  team that gave a player up.
- Player headshots: `https://sleepercdn.com/content/<sport>/players/thumb/<id>.jpg`
  (sport-keyed). Many ids 404 (defenses, stale players) — `PlayerAvatar` MUST
  fall back to `nameInitials()` via `<img onError>`.
- Move blocks are **variable height**, so the tile can't use `budget.list`'s
  fixed-row math. It greedily reveals whole moves against `budget.remaining`
  (estimated via `estimateTransactionHeight`), budgeting one column's height and
  rendering into `budget.columns` (safe under-fill; more columns only shortens).

## Wiring reminder
Adding a new integration tile touches the standard set: openapi.yaml settings +
all three integration enums (then run api-spec codegen), api-server
`pickTileSettings()` allow-list (or settings save 200 but never persist —
see tile-settings-whitelist), plus the dashboard IntegrationTile render switch,
TileEditModal config UI, integrationCategories, and metrics.ts row heights.
