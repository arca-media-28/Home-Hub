---
name: Tile metrics + size-aware density
description: Conventions for per-tile metric selection and size-aware widget detail on the homelab dashboard
---

# Tile metric selection & density convention

Integration tiles show a user-chosen subset of metrics, scaled by tile size.

## Durable decisions
- A tile's persisted metric selection is nullable: **null/absent = "show all"**
  (backward-compatible default), an **explicit list is honored exactly**, and an
  **empty list = show nothing**. Resolution always intersects with the
  integration's catalog so stale keys can't leak after an integration change.
- **Why:** keeps tiles honest (only what the user picked) while never breaking
  tiles created before metric selection existed.
- The verbose section of a widget renders when the tile is large enough OR when
  the lighter metric(s) are turned off — so a tile showing only the heavy metric
  still has something to display.
- Adding a metric/integration is a catalog edit plus honoring the key in the
  widget; no schema change is needed.

## Cross-cutting trap (cost a rejected review once)
- The bulk layout-save endpoint returns **full Tile objects**, and the frontend
  replaces its tile cache with that response on resize. Any field added to the
  Tile contract (integration, metrics, …) MUST be included by the layout route's
  tile formatter too, or resizing silently drops it from cached state. Keep the
  layout route and the tiles route using the **same** formatter, not two copies.

**How to apply:** when extending the Tile shape, update the shared formatter and
confirm both `/tiles` and `/tiles/layout` responses carry the new field; add a
layout-save round-trip test asserting the field survives a resize.

## Generic per-integration extra config
- `tile_settings` (DB col) / `tileSettings` (API, schema `TileSettings`) is the
  generic JSON-object extension point for per-integration widget config, distinct
  from `metrics`. **null = no extra settings.** First consumer is qBittorrent's
  `categoryFilter: string[] | null` (null = all categories), passed to widgets via
  `WidgetProps.tileSettings` from `IntegrationTile`.
- **Why:** avoids a new column per integration knob. Add new keys to the
  `TileSettings` schema + the parse/serialize allow-list in `routes/tiles.ts`
  (both only copy known keys, so unknown keys are dropped on write).
