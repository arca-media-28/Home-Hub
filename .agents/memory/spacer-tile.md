---
name: Spacer layout tile
description: How the invisible spacer tile type works across spec, dashboard, and modal.
---
The "spacer" TileIntegration is a layout-only tile: an invisible gap users add to shape grid spacing.

- **Rendering** (dashboard.tsx `renderTileContent` + grid item wrapper): in locked mode it renders `null` and the wrapper has no border/bg/shadow plus `pointer-events-none` (no click target, fully transparent). In edit mode it shows a dashed `border-primary/40` box with a small centered "Spacer" label, and keeps the normal edit ring so it can be moved/resized/deleted. The grid cell still occupies space in both modes (react-grid-layout uses the saved w/h regardless of content).
- **Editor** (TileEditModal): `isSpacer = integration === TileIntegration.spacer`. When true the modal hides Name, URL, hide-title checkbox, Background Color, and Image sections, and shows a one-line description. `handleSave` force-clears name/url/bgColor/imageUrl for a spacer so converting an existing tile leaves nothing behind. Title color/size and metrics were already gated to `integration === NONE`, so they stay hidden.
- **Categories**: `spacer: "Other"` in integrationCategories.ts groups it under "Other" in the dropdown.
- **Backend**: NO change needed. `integration` is stored as a free string with no whitelist/validation in api-server routes/tiles.ts, and `pickTileSettings` only copies known keys (spacer sends null tileSettings). The task's "guard the backend" step was a no-op in practice.

**Why:** keeps the spacer purely client-side; the only durable contract is the enum value `spacer` added to all three integration enums (Tile, TileInput, TileUpdate) in lib/api-spec/openapi.yaml, then `pnpm --filter @workspace/api-spec run codegen`.

**Divider sibling (`divider`, label "Section Label"):** a *visible* layout tile mirroring the spacer. Same client-only pattern (enum added to all 3 openapi enums + codegen; no backend change). Renders its `name` as uppercase tracked text with NO card surface, visible in BOTH locked and edit modes (unlike spacer which is null/invisible when locked). In the modal it KEEPS the Name field (relabeled "Label", placeholder "Media") but strips URL/image/background/hide-title/scrollable/metrics. Shared gate `isLayoutTile = isSpacer || isDivider` drives the stripping in handleSave and the JSX (`{!isLayoutTile && …}`); the Name field stays gated on `!isSpacer` so the divider keeps it. Dashboard `renderTileContent` + grid wrapper treat both via `isLayoutTile` (no card border/bg, pointer-events-none when locked).
