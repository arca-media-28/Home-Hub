---
name: Homelab Dashboard theming
description: How to reskin the whole homelab-dashboard app via global tokens, and the gotchas.
---

# Reskinning homelab-dashboard

The app (artifacts/homelab-dashboard) is React+Vite + Tailwind v4 + shadcn (new-york), with all
design tokens centralized in `src/index.css`. A full visual reskin is mostly a token edit, not a
per-component rewrite.

**Keystone:** `src/index.css` defines HSL tokens. shadcn components reference these via the
`@theme inline` block, so changing `--background/--card/--primary/--foreground/--border/--input/
--ring/--secondary/--muted/--accent`, the `--app-font-*` family, and `--radius` propagates to every
Button/Input/Card/Dialog/Dropdown/Select automatically.

**Multi-theme system (3 themes):** the old single `:root` + mirrored `.dark` is GONE. There is now a
real theme picker. Themes were deliberately consolidated from 6 minor recolors to 3 MAJORLY distinct
ones (user feedback: prefer fewer, dramatically different themes). The three: **Rack** (dark
terminal — mono, sharp 0-radius, hard grid bg, flat, UPPERCASE wide-tracked labels, amber),
**Hearth** (warm light editorial — Fraunces serif headings, 1.25rem radius, gradient wash, soft
diffuse shadows, near-borderless cards, sentence case, burnt orange), **Nebula** (cosmic dark —
Space Grotesk, glassy translucent `.bg-card` w/ backdrop-blur, violet glow shadows + glow borders,
radial glow bg no grid, sentence case, violet/cyan). `:root` holds shared constants + Rack (dark
default); each alternate theme is a `[data-theme="hearth|nebula"]` override block
(full palette/fonts/radius/elevate). To add/remove a theme you MUST update THREE places: `ThemeId`
type + `THEMES` array in `src/lib/theme.ts`, the `KNOWN` array in the `index.html` before-paint
script, and the `[data-theme=...]` blocks in `index.css` (token block + structural-traits section).
Unknown saved theme ids fall back to DEFAULT_THEME (rack) in both the before-paint script and
`readSavedTheme`, so removing a theme is migration-safe.
The active theme is set via the `data-theme` attribute on `<html>`. `*-border` etc. derived tokens
use `hsl(from ... )` relative color so they recompute per active theme (all selectors target
documentElement). See `src/lib/theme.ts` (THEME metadata, localStorage keys `homehub:theme` /
`homehub:colors`), `src/components/ThemeProvider.tsx` (context), `src/components/AppearanceSettings.tsx`
(Settings UI), and the inline before-paint `<script>` in `index.html` (`window.__homehubApplyTheme`)
that applies theme + custom primary/background BEFORE first paint to avoid a flash. Custom colors are
stored PER-THEME and override the selected theme's defaults; "reset" clears the active theme's override.

**Sharp-corner gotcha:** `--radius-sm/md/lg/xl` were `calc(var(--radius) ± Npx)`. With `--radius:0`
those compute to negative or 4px values, so `rounded-md`/`rounded-xl` are NOT fully sharp. To force
hard corners everywhere, set all four `--radius-*` to `var(--radius)` (i.e. 0), not just `--radius`.
`rounded-full` and bare `rounded` are fixed Tailwind values and ignore the radius tokens — sharpen
those by editing the className directly (progress bars, thumbnails).

**Old-theme leaks to check beyond tokens:** hardcoded colors that bypass tokens —
`TileEditModal` default `bgColor` for new app tiles, `AppTile` fallback `bg`, and `not-found.tsx`
(used raw `bg-gray-*`/`text-gray-*`). Status colors in tiles (green/amber/red) are intentional and
fine to keep.

**Structural variety (not just color):** themes also differ in FORM via theme-scoped CSS in
`index.css` AFTER the token blocks (unlayered, so it beats Tailwind's `@layer utilities` by source
order regardless of specificity). Three levers: (1) elevation — Tailwind `shadow-*` is remapped in
`@theme inline` to runtime `var(--app-shadow-*)`, and each theme defines its own `--app-shadow-*`
(Rack flat, light themes soft-diffuse, Nebula colored glow); (2) ambient background — per-theme
`[data-theme=...] .bg-dot-pattern` overrides the default grid (Hearth/Grove gradient wash, Quiet
bare, Nebula glows+grid, Tide blue grid; only pages use `.bg-dot-pattern`); (3) typographic voice —
soft themes (hearth/quiet/grove/tide) override `.uppercase`→none and `.tracking-wide(r/st)`→normal
to drop the terminal label motif, while Rack/Nebula keep it; Hearth also gets serif `h1,h2,h3`.
**Why:** the terminal motifs (grid bg, flat surfaces, UPPERCASE wide-tracked labels) live in
component markup, so without these scoped overrides every theme reads as a recolored "Rack".
`THEME` metadata carries `radius`+`font` so the Appearance picker previews each theme's own shape
and typeface inline.

**Verifying authed surfaces:** the dashboard is behind JWT auth (token in localStorage). Direct
`curl $REPLIT_DEV_DOMAIN/api/...` does NOT reach the API (web and api-server are separate artifacts
with their own routing), and the screenshot tool can't seed localStorage. Use the testing skill
(`runTest`) to register through the UI and screenshot the dashboard/modal instead.
