---
name: Device modes + adaptive variants
description: How switchable layout profiles (PC/Phone) and adaptive per-scale variant layouts scope tiles; key seams and gotchas.
---

- Tiles are scoped by (pageId, deviceModeId, variant). `variant` is `"<preset>-<orientation>"` (e.g. `fhd-landscape`) and is NULL for auto/fixed pages. Every tile list/save/create must pass all three or you read/write the wrong bucket (tilesParams feeds both the React Query key and the fetch).
- **Why:** omitting a scope param silently falls back to legacy behavior (all tiles), which corrupts layouts across modes.
- Default device mode is auto-provisioned per user; active mode is per-browser localStorage, reconciled against the server list on load (deleted mode → fall back to default).
- Adaptive preset resolves fixed scale from viewport major dimension: ≥3200 uhd, ≥2240 qhd, ≥1600 fhd, else compact; portrait when h>w. Resolution feeds the existing fixed-layout scaled render path; edit mode renders unscaled with a variant switcher (editVariantOverride cleared on page switch/edit-mode exit).
- Copy-from-variant: POST /pages/:id/copy-layout clones tiles from any populated (mode, variant); UI only offers it on an empty target.
- Export bumped v1→v2 (modes + variants); import accepts both.
- Playwright on Replit: default baseURL is localhost:3000 — must run with `E2E_BASE_URL=https://$REPLIT_DEV_DOMAIN` or register requests 404/fail.
