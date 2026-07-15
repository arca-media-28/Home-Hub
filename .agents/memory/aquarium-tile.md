---
name: Aquarium fun tile
description: Animated fish-tank toy tile — settings model, size-scaled population, e2e location gotcha
---

- Aquarium is a cosmetic Fun tile like bonsai/tamagotchi: paints its own full surface (dashboard branch bypasses the integration header), contentless in the edit modal (name/url/image stripped).
- Settings: `aquariumFishTypes` (3 slots, "none" allowed), `aquariumSandColor` (preset key OR raw #hex — resolveSandColor branches on leading `#`), `aquariumProps` (3 slots). Defaults seeded by the modal save path on create, tile also falls back to defaults when unset.
- Fish/prop counts scale with rendered pixel AREA via ResizeObserver (fish 2–14, props 1–3 budget); per-fish lanes/speeds are deterministic index-hashed jitter so re-renders don't reshuffle. Animation = CSS keyframes on SVG groups (swim translateX loop + step-end scaleX flip at the 50% turnaround + bob).
- Tank must be BOUNDED by the tile (user requirement): viewBox width is derived from measured tile aspect (height fixed) so it maps 1:1 with no slice-cropping, and fish turn at wall margins (per-tile keyframes named with tile.id) instead of swimming off-screen.
- **Why deterministic jitter:** Math.random in render would reshuffle the whole tank on every settings change or resize.
- Ambient motion (bubble streams + surface shimmer) is always-on pure CSS, no settings; a prefers-reduced-motion block disables all tank animations.
- Playwright e2e specs live at REPO ROOT `tests/e2e/` (root playwright.config.ts), NOT under artifacts/homelab-dashboard — specs placed inside the artifact dir are silently not found.
