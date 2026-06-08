---
name: Verifying dark canvas mockups
description: external_url screenshots can falsely show dark mockup pages as pure black; use app_preview to confirm.
---
When verifying mockup-sandbox preview pages (`/__mockup/preview/...`), the `external_url`
screenshot path can return a pure-black image for **dark-themed** components even when the
component renders perfectly. This is a capture/caching/timing artifact of that service, not a
real bug — re-running external_url reproduces the same black frame.

**How to apply:** If an external_url screenshot of a dark preview looks blank/black but the route
returns 200 and logs show no React error, re-verify with the `app_preview` screenshot type
(hits localhost directly) before assuming the component is broken.

Separately: never load fonts via CSS `@import url(...)` inside an injected `<style>` in a mockup
component — it is render-blocking. The sandbox `index.html` already preloads ~25 Google families
(incl. Space Mono, JetBrains Mono, IBM Plex, Fraunces, Outfit, etc.); just reference them by
font-family. Check `artifacts/mockup-sandbox/index.html` for the bundled list.
