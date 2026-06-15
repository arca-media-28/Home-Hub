---
name: imagePosition placement (free pan, with legacy anchor/focal fallback)
description: How tile imagePosition positions images — free transform pan plus backward-compatible anchor/focal modes.
---
The tile `imagePosition` string column drives image placement and supports three
formats, all resolved in one place (`imageStyle.ts` → `resolveImageStyle`, used by
AppTile + IntegrationTile + the edit-modal preview):

1. **Free pan (current model):** `"pan(<x>,<y>)"` — a CSS `translate(x%, y%)` in
   percent of the tile box, combined with `scale(imageScale/100)` about center.
   This is what drag-to-reposition now produces.
2. **Legacy focal point:** `"X% Y%"` → CSS object-position (bounded).
3. **Legacy anchor key:** `"center"`, `"top-left"`, … → object-position via map.

**Why the move to translate-based pan:** the old object-position/focal model could
only pan along an axis that actually *overflowed* the tile (cover/none force-crop to
the tile aspect ratio), so at base scale you could often only move one axis, and
the image looked permanently cropped/cut-off when scaled down. A box-relative
`translate` pans freely on **both axes at any zoom**, is 1:1 in pixels
(`Δ% = dx/boxW*100`, no naturalWidth/Height measurement needed), and never
force-crops — the image is the canvas, the tile is the viewport.

**Rendering split (why a wrapper):** `resolveImageStyle` returns a box-sized
*wrapper* that carries the `translate(%)+scale` transform, plus the `<img>` inside
it. The wrapper stays tile-box-sized so a pan of N% is always N% of the tile (not
the image) → drag stays 1:1 at any zoom. The image is free to overflow the wrapper;
the tile container (`overflow-hidden`) does the clipping. This is essential for
"Actual size" (object-fit:none): if the img clipped at the element box, panning
just slid the native-res crop over the background and could never reveal the
off-screen parts. With the wrapper, "none" renders the image at natural size,
centered, overflowing — so panning reveals hidden parts and zoom in/out works.
All three call sites (AppTile, IntegrationTile header, TileEditModal preview) must
render `<div wrapperClassName/wrapperStyle><img className/style/></div>`.

**How to apply:**
- Pan helpers in `imageStyle.ts`: `isPan`/`parsePan`/`formatPan` (clamps to
  ±`PAN_LIMIT`=100), `DEFAULT_PAN="pan(0,0)"`. `resolveImageStyle` branches: pan →
  translate+scale (origin center); else legacy object-position (+ scale about that
  point). Anything new rendering tile images must go through `resolveImageStyle`.
- New images default to fit `DEFAULT_NEW_FIT="contain"` (show whole image) + center
  pan; `DEFAULT_FIT="cover"` is kept ONLY as the normalize fallback for legacy tiles
  with no imageFit, so their look doesn't shift.
- TileEditModal: drag always enabled when an image is present (no overflow gating);
  the image anchor grid was replaced by a "Recenter" button (sets DEFAULT_PAN). The
  *title* still uses the 9-anchor grid (titlePosition) — unrelated.
- Field stays a free string everywhere (no enum in openapi.yaml/zod/api-client), so
  no schema/DB migration. Legacy anchor/focal tiles keep rendering as saved until
  re-dragged, which upgrades them to the pan format.
