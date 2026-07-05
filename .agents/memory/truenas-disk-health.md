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

**Temperature value coercion:** `POST /disk/temperatures` values are run through
`coerceTempValue` — it accepts a plain number, a numeric string ("34"), or a
nested object (`{temperature_c}`/`{temp}`/…), so a SCALE version changing the
value shape no longer blanks every temperature. Only call it when `tempRes.data`
is a plain object (a bare job-id number/array means the endpoint stopped
returning the map → warn + fall back to the graph).

**Disk-temp FALLBACK + CPU temp (cputemp/disktemp graphs):** a SEPARATE
`reporting/get_data` POST (`graphs:[{name:"cputemp"},{name:"disktemp"}]`, same
past-ending window) rides the first allSettled batch as a 7th element. Keep it
isolated from the core cpu/memory POST — get_data 422s the ENTIRE batch on one
bad graph name, and `httpPost.mock.calls[0]` must stay the core reporting call.
`disktemp` graph (legend `["time","sda",…]`, °C per disk) is a FALLBACK: it fills
only disks whose live-endpoint temp is missing (POST /disk/temperatures WINS).
`cputemp` graph (legend `["time","cpu0",…]`, no package column) → headline
`cpuTempC` = hottest core, `cpuTempCoresC[]` = all cores; readings ≤0 = no
sensor → null/[]. Both additive (never 502). Surfaced as a dedicated tile metric
`truenasMetric:"cputemp"` (CpuTempView + TempGauge; thresholds <70 green /70-84
amber /≥85 red) — auto-appears in the picker via TRUENAS_METRIC_VARIANTS, but
still needs the `cputemp` literal added to pickTileSettings whitelist, the
tiles.ts local TileSettings union, and the openapi truenasMetric enum.
