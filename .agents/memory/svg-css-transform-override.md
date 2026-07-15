---
name: CSS animation transform overrides SVG transform attribute
description: Why CSS-keyframe-animated SVG groups must not carry their placement in the transform attribute
---

A CSS `transform` (including one applied by an `animation` keyframe) overrides
the SVG `transform` *attribute* on the same element for as long as it applies.

**Why:** presentation attributes sit at the bottom of the CSS cascade, so an
animated class like `.aq-pellet { animation: ...translateY... }` wipes the
element's `translate(x y)` placement — the element snaps to the origin (top-left
of the viewBox) for the whole animation. Symptom: "everything animates at the
left edge instead of where it was placed."

**How to apply:** in animated SVG tiles (aquarium pellets, fish darts, bubbles),
always put positional `transform` attributes on an OUTER `<g>` and the animated
class on an INNER `<g>`. The aquarium e2e spec asserts pellet x ≈ click x as a
regression guard.
