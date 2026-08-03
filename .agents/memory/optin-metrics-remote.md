---
name: Opt-in metrics + cross-tile remote
description: How defaultOff metrics work (null selection ≠ all) and how one tile controls another via PageTilesContext (ErsatzTV guide → video player remote).
---

## Opt-in (defaultOff) metrics
- `MetricDef.defaultOff?: boolean` in the metrics catalog marks a metric that stays OFF when the tile's `metrics` selection is `null` (legacy "show all").
- `defaultMetricKeys(integration)` = all keys minus defaultOff ones. Both `resolveEnabledMetrics(integration, null)` AND TileEditModal's null-selection handling (`enabledKeys` + `toggleMetric` base) must use it — if only one side does, the modal shows a checked box the tile ignores (or vice versa).
- Explicit selections are always honored, including opt-ins.

**Why:** the ErsatzTV "TV guide" metric would otherwise pop up on every existing tile; opt-in metrics let heavy/space-hungry features ship without changing legacy tiles.

## Cross-tile remote via PageTilesContext
- `src/components/tiles/pageTiles.tsx`: `PageTilesContext` (dashboard.tsx wraps its main return in the provider with the current scope's tiles), `usePageTiles()`, `findErsatzPlayerTile()` (first tile with integration `videoplayer` + `tileSettings.videoSource === "ersatztv"`).
- Tuning = the same tile-update pattern the player itself uses: `updateTile` then `setQueryData(getGetTilesQueryKey())` + `invalidateQueries`; the player reacts to its `videoErsatzChannel` change and shows its tuning banner — no direct ref/event bus needed.
- No eligible player → render non-interactive elements (divs/spans), not disabled buttons; `ErsatzGuideGrid` branches on `onTune === undefined`.
- Scope is per page/device-mode/variant automatically because the provider only receives the currently rendered tiles.

**How to apply:** any future "tile A controls tile B" feature should read from `usePageTiles()` and write via tile-update, keeping the controlled tile the single source of truth.
