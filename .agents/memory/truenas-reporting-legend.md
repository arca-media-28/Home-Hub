---
name: TrueNAS reporting legend + window quirks
description: How TrueNAS reporting/get_data aligns legend/data/mean and the time-window the modern backend accepts
---

# TrueNAS reporting/get_data quirks

Two real-world quirks that fixtures can hide:

## 1. Legend has a leading "time" column — and the three arrays align differently
- `legend` starts with `"time"`, e.g. `["time","user","system","interrupt","nice","idle"]`.
- Each `data` row is aligned to the FULL legend — the unix timestamp sits in the
  `"time"` column. Zip the row directly against the legend (do NOT slice off the
  first element).
- `aggregations.mean` holds one value per legend column EXCLUDING `"time"`. Zip it
  against `legend` with `"time"` removed.

**Why:** zipping mean against the full legend (or slicing the timestamp off the
data row while keeping the full legend) is off-by-one and silently maps `idle`,
`used`, `free`, etc. to the wrong values. Test fixtures that omit `"time"` pass
while production is wrong.

**How to apply:** any parser over TrueNAS reporting graphs must branch on the
data source (raw rows vs mean). Keep fixtures realistic (include `"time"`).

## 2. The reporting window must end in the PAST, not "now"
- `start`/`end` must be integer unix seconds (modern Netdata backend, SCALE
  24.04+ incl. 25.10, rejects relative `"now-30s"` strings).
- The most recent samples aren't collected yet, so a window ending at `now` is
  rejected → the call fails and CPU/RAM fall back to 0 while pools still load.
- Documented working form: a short trailing window ending a few seconds ago,
  e.g. `now-90s … now-30s`, with `aggregate: true`.

**Why:** the only path that yields exactly 0 for BOTH CPU and RAM (while pools
work) is the partial-failure fallback — i.e. reporting/get_data was rejected.

## 3. Network + ARC extras ride a SEPARATE reporting/get_data POST
- Net throughput + ZFS ARC come from reporting graphs `interface`,
  `arcactualrate`, `arcsize` — requested in their OWN POST, settled
  independently from the cpu/memory call.
- **Why:** the `interface` graph can require an `identifier` on some installs and
  may be rejected (422). Bundling it with cpu/memory would regress CPU/RAM to 0
  on rejection. Isolating it keeps the failure additive (net/ARC → null, no 502).
- Unit assumptions (untested against live, documented in code): interface values
  are kilobits/s → Mbps `/1000`; `arcsize` is bytes → GB `/1e9`; `arcactualrate`
  is hits/misses per sec → ratio `hits/(hits+misses)*100`. Parser tolerates
  legend key aliases (received/rx, sent/tx, arc_size/size/arcsz).
