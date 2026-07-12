---
name: Weather tile responsive layout
description: Row/list/col layout thresholds for the weather tile and e2e overflow-check gotchas
---

# Weather tile responsive layout

- Three threshold-based modes from measured density: **row** (forecast list BESIDE conditions, 50/50 halves) when `bodyWidth >= 340 && bodyWidth > bodyHeight * 1.2`; **list** (vertical day list BELOW, spreads via justify-evenly) when `bodyHeight >= 280 && bodyHeight > bodyWidth * 0.9 && bodyWidth >= 140`; else **col** (legacy horizontal strip, markup unchanged).
- Filling the space matters as much as picking the mode: user rejected a version where mode was right but content hugged a corner. Row/list day rows use a `grid-cols-[Nrem_1fr_auto]` (day / centered icon / right-aligned temps) so lines fill their column; a `big` flag (`bodyHeight >= 240 && bodyWidth >= 280`) scales up icon/temp typography on roomy tiles.
- Day counts: row `min(avail, max(2, floor((h-20)/26)))`, list `min(avail, max(3, floor((h-150)/30)))`, col stays width-driven (3–5). Server fetches `forecast_days: 7` (today + 6 upcoming).
- **Why:** wide/tall tiles wasted space; the e2e test mirrors these exact thresholds and formulas, so changing any constant means updating `tests/e2e/weather-tile-layout.spec.ts` in lockstep.

## E2E layout-test gotchas
- Generic "no element overflows" checks false-positive on `truncate` (clipping by design) and `leading-none` text (glyph box exceeds line-height by a few px) — exclude both by className.
- Seed-based body-size estimates differ from real measured heights — compute expected counts from the rendered DOM, not grid math.
- **How to apply:** mock the widget endpoint via `page.route("**/api/widgets/...")`, seed tiles via `POST /api/tiles` (accepts `integration` + `tileSettings`), derive expectations from measured element sizes. For quick visual eyeballing, a scratch Playwright script (must live inside the workspace for module resolution) that registers a throwaway user + saves a screenshot beats guessing from formulas.
