---
name: Pterodactyl widget API mapping
description: How the Pterodactyl game-server tile talks to the panel and the filter-checkbox null/[] semantics.
---

- Uses the panel **client API** (per-user key `ptlc_…`), Bearer auth + `Accept: application/json`.
- List: `GET /api/client?per_page=100` → `data[].attributes {identifier, name, limits.memory}` (memory in MiB; `0` = unlimited → `memLimitMb: null`).
- Per-server stats: `GET /api/client/servers/{identifier}/resources` → `attributes.current_state`, `resources.cpu_absolute` (%), `memory_bytes`. Resource calls are **additive**: failure → state `"unknown"` + null stats, never 502. List failure → 502.
- Ping: `GET {base}/api/client`.
- **Player occupancy**: NOT in the panel API. api-server queries the game itself via gamedig (`lib/gameQuery.ts`): game type guessed from name+invocation+docker_image keywords (java+`.jar` fallback → minecraft); host = default allocation `ip_alias` || routable ip || `sftp_details.ip`; valheim query port = game port + 1. Running servers only, any failure → `players: null` (additive). gamedig must stay in build.mjs `external` (runtime registry).

**Filter checkbox semantics (applies to any server/pool picker):** stored `null`/`[]` both mean "show all" in the tile, but in the edit modal `[]` must mean "none checked" (only `null` = all). If `[]` is treated as "all" in the modal, unchecking "All servers" leaves every box checked and clicking a server *removes* it — the user ends up with the inverse selection. Save collapses `[]`/full-list back to `null`.

**Shape responsiveness:** list container uses `flex-1 min-h-0 overflow-hidden` ONLY when rows are truncated; when everything fits it shrinks to content so `CenteredTileBody` centers health+list as a group. Multi-column grid needs `content-start` or rows stretch across a tall tile with huge gaps. `rowScale` tiers (1: ≥16px/row slack → text-sm, 2: ≥40px/row, or 64px with resources → text-lg + CPU/RAM usage BARS) upsize rows; only when all rows fit. Wide-short bodies (≥380px and >1.8×height) use a side-by-side layout: health block fixed-left, rows fill right in up to 4 columns with their own width/height math (budget.list not used there).
