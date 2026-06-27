---
name: Per-page fixed scale lock (CSS transform scaling)
description: How fixed-column pages are rendered via CSS transform scaling, and the layout/feedback-loop gotchas that bite when scaling a react-grid-layout grid to fit.
---

# Per-page fixed scale lock

A dashboard page carries a `layoutPreset` (auto/compact/fhd/qhd/uhd → fixed column count) and `layoutOrientation` (landscape/portrait). Fixed presets render the grid at a locked intrinsic pixel width (`COL_WIDTH*cols + GRID_MARGIN*(cols-1)`) and CSS-scale it to fit; auto keeps the responsive `colsForWidth` behavior.

## Three render branches (do not collapse them)
- **auto**: render the grid directly (responsive, today's behavior).
- **fixed + edit mode**: render at full intrinsic size, NO scale, `overflow-x-auto`. Scaling is disabled in edit mode so react-grid-layout's drag/resize pointer math stays in document coordinates.
- **fixed + locked**: wrap in a scaling container.

## Scaling container gotchas (each caused a real bug)
- **Feedback loop**: an effect that measures the scaled element's height and `setState`s it will infinite-loop if it (a) depends on a fresh-every-render value like the computed `layout` array and (b) sets unconditionally. Fix: measure with a `ResizeObserver` + a value guard (`setH(prev => prev === h ? prev : h)`). Scaling only mutates the OUTER wrapper, so the observed inner element never resizes in response — no loop. `offsetHeight`/ResizeObserver report the UNtransformed layout size, so they stay correct under `transform: scale()`.
- **Flex shrink defeats the fixed width**: the scaled inner sits in a `flex justify-center` parent to center it. As a flex child it will SHRINK below its set `width` on narrow viewports (so a 1500px fixed grid silently became 1248px = the viewport, i.e. it reflowed). Fix: `shrink-0` on the inner so its intrinsic width is honored.
- **Phantom scrollbar**: a CSS transform does NOT shrink the layout box. A downscaled grid's box is still wider/taller than the viewport, so `overflow-x-auto` shows a scrollbar even though the VISIBLE content fits. Use `overflow-hidden` on the reserving wrapper; with `transform-origin: top center` the box centers on the container center, so the visible scaled content lands exactly in-bounds and only the empty overflow is clipped.
- **Reserve scaled height**: the outer wrapper height must be set to `intrinsicHeight * scale` (not the box's own height) or the page leaves dead scroll space (downscale) / clips (upscale).
- **Portrait must clamp by width too**: portrait = fit-height (`availHeight/intrinsicHeight`), but a SHORT page makes that scale > the width-fit scale, so the grid would scale up past the viewport width and clip horizontally under `overflow-hidden`. Use `scale = min(heightScale, widthScale)` for portrait so it's always fully visible + centered. Landscape is width-fit only.
- **flex align-items:stretch feedback collapse**: the centering wrapper is `flex justify-center` and the measured inner is its flex child. Default `align-items: stretch` stretches the child to the PARENT's height — and the parent's height is `intrinsicHeight*scale`. The ResizeObserver reads that stretched child's offsetHeight back into intrinsicHeight, so when `scale < 1` (a fixed canvas WIDER than the viewport, i.e. the dense 2K/4K presets on a smaller screen) the height shrinks geometrically toward 0 each cycle and ALL tiles vanish. Fix: `items-start` on the flex parent so the child keeps its natural content height. **Why:** the measured element must not be sized by a value derived from its own measurement.

**Why:** transform scaling decouples visual size from layout-box size; every one of these is a place where the layout box (unscaled) leaks through.

## Verifying it in e2e
Screen-coordinate ratios are fragile. Robust no-reflow probe: read the grid root's `offsetWidth` (transform-independent → constant across viewports = locked, no reflow) and the wrapper's computed-transform scale via `new DOMMatrixReadOnly(getComputedStyle(el).transform).a` (changes with viewport = fit-to-width working). Test hook: `data-testid="fixed-scale-wrapper"` on the scaled inner.
