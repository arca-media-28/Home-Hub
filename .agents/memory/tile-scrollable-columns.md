---
name: Tile scrollable reveal + multi-column flow
description: How the per-tile "scrollable" toggle and wide-tile multi-column list flow work in homelab-dashboard tiles.
---

# Scrollable reveal
- When `tileSettings.scrollable` is on, `tileDensity(..., scrollable=true)` forces `level="lg"` AND `tileBudget.remaining = Infinity`. That makes the existing reveal math (`block()`, `list()`, and SportsTile's both-active loop) naturally return EVERYTHING with no per-widget special-casing.
- Widget roots are `w-full h-full`. Inside the scrollable body (`flex-1 min-h-0 overflow-auto`) that `h-full` pins them to the body height and clips — so scroll revealed nothing. Fix: IntegrationTile wraps the widget in an auto-height `<div className="min-h-full">` only when scrollable, so `h-full` resolves to content height; the body then actually scrolls. Non-scroll path renders the widget directly (unchanged).

# Multi-column flow (wide-but-short tiles)
- `tileColumns(bodyWidth)` = `floor(width/230)` clamped 1..4 (COLUMN_WIDTH_PX=230, MAX_COLUMNS=4). So 2 cols needs ≥460px, not 230.
- `listColumnClass(columns, singleColumnClass)` returns `"grid gap-x-4 gap-y-1.5"` when >1 else the single-column class VERBATIM (keeps the single-column path unchanged). `listColumnStyle(columns)` returns `{gridTemplateColumns: repeat(n, minmax(0,1fr))}` when >1 else undefined.
- `tileBudget.list()` scales capacity by columns (rowsPerColumn*columns; deducts ceil(rows/columns)*rowPx) so a wider tile reveals proportionally more rows.

**How to apply:** split a list container's spacing class (e.g. `space-y-1`) from its chrome (borders, `mt-auto`, `flex-1 min-h-0`). Pass ONLY the spacing class as the single-column class; keep chrome outside. For a section that has a HEADER + rows in one container, do NOT make the section a grid (the header becomes a cell) — wrap just the mapped rows in a new grid `<div>`. Widgets that use `density` (not `tileBudget`) compute `tileColumns(density.bodyWidth)` directly (ProwlarrTile, NewsTile).

**Why:** wide-short tiles wasted horizontal space and the scroll toggle clipped before scroll applied. The Infinity-budget + min-h-full wrapper combo solves reveal with zero per-widget reveal logic.
