---
name: Adding visualizer styles
description: What must change when adding a new Audio Visualizer render style (vinyl/cd precedent).
---
Adding a visualizer style is NOT frontend-only: `tileSettings.visualizerStyle` is an
enum in `lib/api-spec/openapi.yaml`, so a new value must be added there + codegen
(`pnpm --filter @workspace/api-spec run codegen`) + rebuild lib refs, or the dashboard
typecheck fails ("vinyl" not assignable) even though the API route itself accepts any string.

**Why:** the generated TileSettings type in api-client-react is the source of truth for the
frontend; the backend whitelist (pickTileSettings) passes any string through.

**How to apply:** update VisualizerTile.tsx (union, options, normalize, switch), the
TileEditModal preview icon block, AND the openapi enum. Album art for canvas renderers comes
from `useAlbumArt` (visualizer/albumArt.ts): loads with crossOrigin="anonymous", failure→null
→ generic label/disc fallback. Idle states must keep repainting (slow drift/pulse) — the e2e
spec (tests/e2e/visualizer-vinyl-cd.spec.ts) asserts frames keep changing while idle.
