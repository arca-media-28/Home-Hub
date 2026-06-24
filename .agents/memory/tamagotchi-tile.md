---
name: Tamagotchi pet tile
description: How the virtual-pet Fun tile models living state and persists across reloads
---

# Tamagotchi pet tile

A self-contained client-side virtual-pet tile in the "Fun" category (integration value `tamagotchi`).

- State keys live in `tileSettings`: `petHunger`, `petHappiness`, `petEnergy` (0-100) and `petUpdatedAt` (epoch ms).
- "Feels alive across sessions" depends entirely on `petUpdatedAt` being a *persisted* wall-clock anchor. On mount the stats are recomputed via `decayTo(now)` from the stored anchor.
- **Persistence must NOT be gated on care actions.** A pet that only saves on Feed/Play/Rest re-defaults its anchor to `now` on every reload, so a never-touched pet appears to reset and elapsed time is lost. Required save points:
  1. On first mount when `petUpdatedAt` is missing → write starting stats + anchor immediately (one-time init).
  2. On `visibilitychange` (tab hidden) and on unmount → persist the decayed-to-now state, regardless of the debounce.
  3. Care actions → debounced save (~800ms) as before.
- The slow in-tile tick (15s) only re-renders drift; it does NOT persist (would be storage-churn).
- Renders its OWN surface and bypasses the standard integration header (branch in `renderTileContent` in dashboard.tsx), like Note/Timer. Treated as contentless in the editor (name forced "", no URL/image/bg/metrics).
- Note/Timer safeguards still apply: reset local state only when a DIFFERENT tile id mounts; preserve all other tileSettings keys on PUT; reconcile saved tile into the getTiles cache in onSuccess so a refetch can't clobber live stats.

## Customization (look)

- Four appearance keys in `tileSettings`: `petBodyColor` (preset key like "green" or custom #hex), `petEyes`, `petNose`, `petMouth` — all `string|null`. Defaults: green/round/dot/smile.
- The face is composable **SVG** (Eyes/Nose/Mouth parts on a 0-100 viewBox), NOT the old emoji string. A single exported `PetFace` component renders body circle + SVG face and is reused by both the live tile and the editor's live preview, so they always match.
- Body color is fully user-chosen now; mood no longer drives body color. Mood only *overrides the expression*: sleepy→closed eyes + "z", hungry/sad→frown; otherwise the user's chosen face shows. `resolveBodyGradient()` maps preset key→gradient or builds a glossy gradient from a #hex.
- Appearance is edited in the modal (`isTamagotchi` branch in the settings closure); that branch MUST preserve `petHunger/petHappiness/petEnergy/petUpdatedAt` (read from `tile.tileSettings`) or saving the look resets the pet — same pattern as Note preserving noteBody/noteItems.
- New string keys need the pickTileSettings() allow-list in api-server `routes/tiles.ts` (string handling) AND the openapi `petBodyColor/petEyes/petNose/petMouth` defs + codegen, or they get stripped on save.

**Why:** the task required the pet to survive reloads and reflect hours of elapsed time with no server-side tick; code review rejected the first pass because passive decay wasn't persisted until first interaction.

**How to apply:** any new "living"/stateful toy tile must persist its time anchor at add-time and on hide/unmount, not just on user actions; reuse the contentless-editor + own-surface wiring rather than IntegrationTile.
