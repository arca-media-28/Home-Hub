---
name: Audio Visualizer tile + Web Audio tap
description: Why the visualizer's analyser graph is built lazily, and the CORS silence tradeoff behind it
---

The Audio Visualizer is a self-contained Fun tile (integration `visualizer`) that
reads the app-level audio player's live frequency data and paints a canvas
(styles: bars / lava / vu), or a synthetic idle animation when nothing plays.

## Web Audio graph is built LAZILY, not always-on
`createMediaElementSource()` permanently reroutes the `<audio>` element through the
Web Audio graph, and a cross-origin media stream WITHOUT CORS headers plays as
**silence** once routed. Tachboard stream URLs point straight at the user's media
servers (Plex/Jellyfin/Subsonic) which are cross-origin, so building the graph
unconditionally would risk silencing playback for every user.

**Decision:** the audio player only builds the AudioContext + AnalyserNode when a
visualizer tile calls `enableVisualizer()` on mount (guarded so it runs once).
Only then is `el.crossOrigin = "anonymous"` set (before the next load) so
CORS-capable servers stay both audible and analysable. Graph creation + resume
happen on the play gesture (autoplay policy). Users without a visualizer tile are
completely unaffected.

**Why:** zero-regression for the default experience; the silence tradeoff is
scoped only to users who add a visualizer AND stream from a non-CORS server.

**How to apply:** never move graph construction earlier / make it eager. If you
add another consumer of the analyser, reuse the same lazy `enableVisualizer` seam.

## Idle animation is the main testable path on Replit
Demo tracks have `streamUrl: null`, so nothing actually plays in the Replit env —
the synthetic idle signal (in `useVisualizer`) is what renders. `getByteFrequencyData`
returning all-zeros (silent cross-origin) also falls through to the idle signal.
