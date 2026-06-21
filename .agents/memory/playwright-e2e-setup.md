---
name: Playwright e2e setup (NixOS / Replit)
description: How to run the checked-in Playwright e2e suite on Replit's NixOS env and how it authenticates against the dashboard
---

# Playwright e2e suite

Root config `playwright.config.ts` + specs under `tests/e2e/`; run with `pnpm run test:e2e`.

## Browser libs on NixOS
- `pnpm exec playwright install chromium` downloads the browser, but it won't launch out of the box — NixOS has no `/usr/lib`, so it fails on missing `libglib-2.0.so.0`, then `libgbm.so.1`, etc.
- Fix: install the deps via the package-management skill's `installSystemDependencies` (Nix attrs, NOT apt names). Needed set includes: glib, nss, nspr, atk, at-spi2-atk, at-spi2-core, cups, dbus, expat, libdrm, libxkbcommon, mesa, alsa-lib, pango, cairo, gtk3, gdk-pixbuf, fontconfig, freetype, libglvnd, **libgbm** (separate package — provides libgbm.so.1), and the xorg.* libs (libX11, libXcomposite, libXdamage, libXext, libXfixes, libXrandr, libxcb, libXrender, libXtst, libXi, libXcursor, libXScrnSaver). `libxshmfence` is NOT in the rippkgs index — omit it.

## Pointing the suite at a server
- Default `baseURL` is `http://localhost:3000` and the config auto-boots `pnpm run dev:local` as a webServer (CI path; off-Replit the Vite `/api` proxy is ON).
- **On Replit the Vite `/api` proxy is OFF** (gated on REPL_ID), so localhost:3000 has no API. To verify locally here, run against the platform-proxied dev domain which path-routes `/api` to the API server: `E2E_BASE_URL="https://$REPLIT_DEV_DOMAIN" pnpm exec playwright test` (setting E2E_BASE_URL skips the embedded webServer).

## Auth in tests (NOT cookies)
- Auth is a **Bearer JWT**: `POST /api/auth/register` (or `/login`) returns `{ token, user }`; the web app stores it in `localStorage["token"]` and sends `Authorization: Bearer <token>`.
- In a spec: register via `page.request`, then (a) pass `{ Authorization: 'Bearer '+token }` on API calls like `POST /api/tiles`, and (b) `page.addInitScript(t => localStorage.setItem('token', t), token)` BEFORE the first `goto('/')` so the browser app is authed on load.
