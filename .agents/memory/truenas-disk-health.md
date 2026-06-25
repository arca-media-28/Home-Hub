---
name: TrueNAS disk health (temperature + SMART)
description: How the TrueNAS widget sources and maps per-disk temperature and SMART status
---

The TrueNAS widget surfaces per-disk health from THREE endpoints, fetched
best-effort alongside the existing reporting (CPU/RAM) and pool calls:

- `GET /api/v2.0/disk` — disk inventory ONLY. **It carries NO live temperature
  field** (a `d.temperature` read returns null → tile shows "--"). Use it only
  for the disk name list (`name`, fallback `devname`).
- `POST /api/v2.0/disk/temperatures` — the REAL temperature source. Body
  `{ names:[...], powermode:"NEVER" }`; returns a FLAT object `{ "sda":34,
  "sdb":null, ... }`. Requires the explicit name list, so it can only run AFTER
  /disk resolves (sequential, not in the parallel allSettled batch).
- `GET /api/v2.0/smart/test/results` — per-disk SMART test history; each entry
  is `{ disk, tests: [{ status }] }`. The **latest** test in the array decides
  health: `SUCCESS` → passed, `FAILED`/`FAILURE`/`ERROR` → failed, anything
  else/empty → `null` (unknown). Empty when no SMART tests have ever run → all
  SMART cells legitimately "--".

**Why:** disk/SMART/temperatures are additive signals — a homelab user still
wants CPU/RAM/pools even if any of them is unavailable. The /disk and SMART
GETs ride the parallel `Promise.allSettled` batch; the temperatures POST runs
sequentially after it (needs names) in its own try/catch. A failure in ANY of
the three only drops that signal; none contribute to the 502 "unavailable"
decision (that stays reserved for both reporting AND pool failing).

**How to apply:** merged shape is `{ name, temperatureC, smartPassed }` with
nulls for unknown. Tile styling: temp ≥50°C → amber warning, SMART fail → red
(mirrors pool ONLINE/offline colors). Disk rows reveal fits-to-budget like pool
rows, so a short tile may show only the first N disks — not a bug.
