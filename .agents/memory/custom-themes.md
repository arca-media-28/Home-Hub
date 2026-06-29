---
name: Custom uploaded themes
description: How user-uploaded dashboard themes work (export/edit/upload), and the safety boundary that keeps raw CSS out.
---

# Custom (user-uploaded) themes

Users export a JSON template from Appearance settings, edit colors + a fixed set of
structural knobs, and upload it back; it shows in the theme picker like a built-in.

## Safety boundary (the whole point)
- A template NEVER carries raw CSS. Only enumerated structural knobs:
  `shadow` (flat/soft/hard/glow), `backgroundPattern` (none/grid/dots/gradient),
  `uppercase` (bool), `headingFont` (sans/serif), plus colors, `radius`, `font`,
  optional `fontUrl`.
- `validateCustomTheme` (in `src/lib/customThemes.ts`) is the single gatekeeper:
  rejects wrong format/version, bad hex, oversized/odd radius, unsafe font strings
  (no `;{}`), non-enum values, and fontUrls that aren't https Google/Bunny font hosts.
  Returns `{ok:false,error}` with a specific message per failure.
- `readCustomThemes()` RE-VALIDATES every localStorage entry on load, so a
  hand-edited/corrupt `homehub:customThemes` value can't feed malformed data to the
  runtime. Keys must pass `isCustomThemeId` (prefix `custom:`).

## Where each piece lives (three mirrors — keep in sync)
- `src/lib/customThemes.ts` — the tested pure spec (schema, validation, persistence,
  id gen, `customThemeMeta`, `serializeTemplate`, `shadeHex`).
- `index.html` before-paint IIFE — `window.__homehubApplyTheme(theme, colors, customThemes)`
  now takes a 3rd arg. Custom branch sets colors via the SAME hexToHsl math, sets
  `--radius`/`--app-font-*`/outline+elevate vars inline, and sets data-* attributes
  (`data-shadow/-pattern/-uppercase/-heading`) on `<html data-theme="custom">`.
  `clearOverrides` wipes both built-in override vars AND the custom vars+attrs on every
  switch so nothing leaks across themes. A `<link id="homehub-custom-font">` carries fontUrl.
- `src/index.css` — all structural variation for custom lives in
  `[data-theme="custom"][data-shadow=…]` / `[data-pattern=…] .bg-dot-pattern` /
  `[data-uppercase="off"] .uppercase` / `[data-heading="serif"] h1,h2,h3` rules.
  No JS-injected CSS — inherently safe.

## Built-ins unchanged
- 6 built-ins behave exactly as before. `ThemeMeta` gained a `template` field
  (shadow/pattern/uppercase/headingFont/fontUrl) ONLY so export produces an accurate
  starting file; it doesn't change their rendering.

## ThemeProvider contract
- `theme` is now a `string` (built-in id OR `custom:` id), not the `ThemeId` union.
- Per-theme color overrides apply to built-ins only; custom themes carry their own
  colors, so the color pickers are hidden when a custom theme is active.
- Deleting the active custom theme falls back to `DEFAULT_THEME`.

**Why:** Task to let users theme the dashboard without an XSS/CSS-injection hole.
**How to apply:** Any new structural knob must be added in ALL THREE mirrors
(validate+enum in customThemes.ts, apply in index.html, CSS rule in index.css) or it
silently no-ops. Tests live in `src/lib/customThemes.test.ts` (node env → stub
`global.localStorage`).
