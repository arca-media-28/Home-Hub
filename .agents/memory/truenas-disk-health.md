---
name: TrueNAS disk health (temperature + SMART)
description: How the TrueNAS widget sources and maps per-disk temperature and SMART status
---

The TrueNAS widget surfaces per-disk health from two endpoints, fetched
best-effort alongside the existing reporting (CPU/RAM) and pool calls:

- `GET /api/v2.0/disk` — disk inventory; temperature read from `temperature`
  (fallback `temp`); name from `name` (fallback `devname`).
- `GET /api/v2.0/smart/test/results` — per-disk SMART test history; each entry
  is `{ disk, tests: [{ status }] }`. The **latest** test in the array decides
  health: `SUCCESS` → passed, `FAILED`/`FAILURE`/`ERROR` → failed, anything
  else/empty → `null` (unknown).

**Why:** disk/SMART are additive signals — a homelab user still wants CPU/RAM/
pools even if SMART is unavailable. So these two calls are settled with
`Promise.allSettled` and a failure in either only drops that signal; they never
contribute to the 502 "unavailable" decision (that stays reserved for both
reporting AND pool failing).

**How to apply:** merged shape is `{ name, temperatureC, smartPassed }` with
nulls for unknown. Tile styling: temp ≥50°C → amber warning, SMART fail → red
(mirrors pool ONLINE/offline colors). Disk rows reveal fits-to-budget like pool
rows, so a short tile may show only the first N disks — not a bug.
