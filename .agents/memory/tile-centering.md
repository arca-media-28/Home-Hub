---
name: Centered live-tile bounding-box layout
description: How live-status tiles center their enabled content in the tile box while keeping metric-priority reveal.
---

# Centered tile body

Live-status tiles (Prowlarr, Tailscale, Nginx Proxy Manager, ErsatzTV, and the
TrueNAS CpuTempView) center their enabled content within the measured bounding
box instead of pinning it to the top edge.

## The pattern
- Shared wrapper `CenteredTileBody` (in `components/tiles/TileBody.tsx`) is just
  `flex h-full w-full flex-col justify-center` + `gap`/`padding` props. Use it as
  the widget root in place of the old `w-full h-full p-3 flex flex-col ...`.
- **Why it works both ways:** when a growing list child has `flex-1`, it absorbs
  all free space so the group fills the box top-to-bottom and `justify-center`
  has nothing to distribute; when only fixed-height blocks remain (list toggled
  off), `justify-center` centers them as a group. Conditionally-rendered sections
  collapse cleanly because `gap` only applies between rendered children — no
  leftover empty band where a hidden metric used to be.
- Do NOT add `justify-center` on top of a `mt-auto` bottom-pinned list — remove
  the `mt-auto` (NPM used it) so the stats+list read as one centered group.

## Gauge scaling
- Fixed-px gauges (CpuTempView was hardcoded 132) must take `density` and size to
  `Math.min(bodyWidth - 32, bodyHeight - reserveH)` clamped ~[72,220], mirroring
  CpuRamView/ArcView. reserveH ≈ 56 for padding+caption, +40 when an extra row
  (per-core chips) is shown, so the reserved band tracks what's actually rendered.

**How to apply:** keep list chrome (borders, `flex-1 min-h-0`, overflow) on the
list element itself and pass only the spacing class through the multi-column
helpers; the wrapper stays layout-only. Pre-existing `overflow-y-auto` on
Prowlarr's indexer list is intentional and unchanged.
