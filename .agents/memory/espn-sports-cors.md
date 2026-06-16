---
name: ESPN public API CORS quirk
description: Which ESPN site-API endpoints are browser-fetchable (CORS) and which are not, for keyless client-side sports widgets.
---

The Sports tile fetches ESPN's keyless public API directly in the browser (no backend, no key), base `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}`.

Not all sibling endpoints send CORS headers, even though they share a host/path:
- `/scoreboard` — sends `access-control-allow-origin: *` → browser-fetchable. Used for live scores.
- `/news` — sends CORS → browser-fetchable. Used for headlines.
- `/teams` — does NOT send CORS → a browser `fetch` fails. `site.web.api.espn.com/.../teams` (nice inline shape) ALSO lacks CORS. `sports.core.api.espn.com/v2/...teams` HAS CORS but returns `$ref` pagination (one extra fetch per team, ~30/league) — too expensive.

**Why:** the editor's team multi-select needs a team list, but no single endpoint gives both CORS and an inline list cheaply.

**How to apply:** team rosters are stable reference data, so bake them in. The catalog in `lib/sports.ts` (`LEAGUE_TEAMS`, exposed via `getLeagueTeams`) was generated server-side (curl has no CORS limit) as `[teamId, name]` pairs; the ids match scoreboard/news feeds so team filtering lines up. Refresh occasionally for soccer promotion/relegation. Do NOT reintroduce a live browser fetch for teams.
