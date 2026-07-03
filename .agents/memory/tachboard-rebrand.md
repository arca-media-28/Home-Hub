---
name: Tachboard rebrand compatibility seams
description: What must stay legacy-named after the HomeHub → Tachboard rebrand so existing users keep data/themes.
---

# Tachboard rebrand (July 2026)

The app is branded **Tachboard** (Friction Industries) everywhere user-visible, but
several identifiers deliberately keep the old names for backward compatibility:

- **localStorage keys stay `homehub:*`** (`homehub:theme`, `homehub:colors`,
  `homehub:customThemes`) — renaming would reset every existing user's theme.
- **Theme file format is dual-marker**: new exports write `format: "tachboard-theme"`;
  `validateCustomTheme` also accepts the legacy `"homehub-theme"` and normalises it
  to the new marker. Constants `THEME_FILE_FORMAT` / `LEGACY_THEME_FILE_FORMAT` in
  `customThemes.ts`. E2e custom-theme spec intentionally uploads a legacy-format file.
- **Docker volume stays `homelab-data`** — renaming orphans self-hosters' SQLite DB.
  Compose service/container are now `tachboard`.
- **Internal package/dir names unchanged** (`@workspace/homelab-dashboard`,
  `artifacts/homelab-dashboard`) — out of scope by decision, high churn zero benefit.
- Global apply-theme fn renamed to `window.__tachboardApplyTheme`; custom font link
  id is `tachboard-custom-font`. OpenAPI `info.description` is "Tachboard API"
  (info.title must stay "Api" — codegen import paths depend on it).

**Why:** rebrand must not reset saved settings, themes, or self-host data.
**How to apply:** never "clean up" the homehub-prefixed storage keys, legacy format
marker, or the `homelab-data` volume name without a migration.
