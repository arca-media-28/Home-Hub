---
name: Homelab Dashboard theming
description: How to reskin the whole homelab-dashboard app via global tokens, and the gotchas.
---

# Reskinning homelab-dashboard

The app (artifacts/homelab-dashboard) is React+Vite + Tailwind v4 + shadcn (new-york), with all
design tokens centralized in `src/index.css`. A full visual reskin is mostly a token edit, not a
per-component rewrite.

**Keystone:** `src/index.css` defines HSL tokens in `:root` (and a mirrored `.dark`). shadcn
components reference these via the `@theme inline` block, so changing `--background/--card/--primary/
--foreground/--border/--input/--ring/--secondary/--muted/--accent`, the `--app-font-*` family, and
`--radius` propagates to every Button/Input/Card/Dialog/Dropdown/Select automatically.

**Why mirror `:root` and `.dark`:** there is no theme toggle and nothing adds a `.dark` class to
`<html>`, so `:root` IS the active theme. Set the desired palette in `:root` directly; keep `.dark`
identical so a future toggle won't revert to a stale palette.

**Sharp-corner gotcha:** `--radius-sm/md/lg/xl` were `calc(var(--radius) ± Npx)`. With `--radius:0`
those compute to negative or 4px values, so `rounded-md`/`rounded-xl` are NOT fully sharp. To force
hard corners everywhere, set all four `--radius-*` to `var(--radius)` (i.e. 0), not just `--radius`.
`rounded-full` and bare `rounded` are fixed Tailwind values and ignore the radius tokens — sharpen
those by editing the className directly (progress bars, thumbnails).

**Old-theme leaks to check beyond tokens:** hardcoded colors that bypass tokens —
`TileEditModal` default `bgColor` for new app tiles, `AppTile` fallback `bg`, and `not-found.tsx`
(used raw `bg-gray-*`/`text-gray-*`). Status colors in tiles (green/amber/red) are intentional and
fine to keep.

**Verifying authed surfaces:** the dashboard is behind JWT auth (token in localStorage). Direct
`curl $REPLIT_DEV_DOMAIN/api/...` does NOT reach the API (web and api-server are separate artifacts
with their own routing), and the screenshot tool can't seed localStorage. Use the testing skill
(`runTest`) to register through the UI and screenshot the dashboard/modal instead.
