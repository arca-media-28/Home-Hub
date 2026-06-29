---
name: Bonsai (living-plant) tile
description: How the Fun-section Bonsai toy tile models living state and is tuned; what to watch when testing it.
---

# Bonsai tile

A self-contained, client-side Fun tile (integration key `bonsai`) — a toy bonsai the user Waters/Prunes. Built on the same in-place-persistence pattern as the Tamagotchi/Note/Timer tiles (decay-from-anchor on mount + slow tick + debounced save + visibilitychange/unmount flush; preserve all other tileSettings keys on PUT; whitelist new keys in `pickTileSettings()` or they get stripped).

## State model
- Three persisted stats in tileSettings: `bonsaiHydration` (0-100), `bonsaiOvergrowth` (0-100, shown to user as tidiness = 100 - overgrowth), `bonsaiGrowth` (0-100), plus `bonsaiUpdatedAt` (wall-clock anchor).
- Growth depends on *health* = (hydration + (100-overgrowth))/2, which itself changes as hydration/overgrowth drift. So decay must be **integrated in small steps** (0.5h), not a single linear delta — growth accrues only during the sub-intervals where health ≥ threshold.
- Stages: sapling <34, young 34-66, mature ≥67 (drives the SVG canopy size).

## Tuning (validated by simulation, not guessed)
**Why:** first-pass rates made once-a-day care *decline* — overgrowth gain per day exceeded the prune amount (ratcheting up) and a day's hydration loss exceeded the water amount (bottoming out), so a diligent daily carer saw the tree shrink. Always simulate the daily-care loop AND multi-day neglect before committing rates.
**How to apply:** the end-of-day trough (≈24h after care) intentionally reads "Struggling" as the daily nudge to water; that trough is literally the same point as 24h-neglect-from-full, so you can't make "cared-for@24h" look healthy while "neglected@24h" looks bad — the real distinction is 24h vs 48h+. Tuned so daily care reaches mature in ~a week and neglect is recoverable.

## Customization (look)

- Four cosmetic keys in `tileSettings`: `bonsaiPotColor`, `bonsaiLeafColor` (preset key or custom #hex), `bonsaiBlossom` ("none" or preset color), `bonsaiStyle` ("upright"|"slanted"|"windswept"|"cascade"). All `string|null`. Cosmetic ONLY — never affects hydration/overgrowth/growth.
- Chosen leaf color is the *healthy* tone; dryness still lerps it toward dry tan. Tree style is one shared blob layout + a per-style canopy transform (STYLE_FORK) + S-curve trunk path, so species read distinctly without duplicating geometry.
- Edited in the modal `isBonsai` branch (mirrors `isTamagotchi`); that branch MUST preserve bonsaiHydration/Overgrowth/Growth/UpdatedAt or saving the look resets the tree. `BonsaiTree`/`BonsaiPreview` exported + reused for the editor preview. New keys need pickTileSettings allow-list + openapi defs + codegen.
- Bonsai is now in the editor's `isContentless` set (paints its own surface, like Tamagotchi) — previously it wasn't, so the editor used to show name/URL/image fields that the tile ignored.

## Testing gotcha
The TileEditModal integration picker is a Radix `<Select>` (combobox), NOT a native select. e2e/runTest must click the trigger then click the grouped `<SelectItem>` in the popover; Playwright hit-testing may treat a grouped option as "outside viewport" and need a DOM-click workaround. A tile saved with `integration: null` (blank card) means the dropdown was never actually operated — not a render bug.
