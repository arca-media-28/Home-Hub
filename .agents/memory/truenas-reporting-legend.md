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
- `aggregations.mean` holds one value per legend column EXCLUDING `"time"`. On
  SCALE 25.10 `mean` is an OBJECT keyed by legend name (`{cpu:2.7, cpu0:3.5, …}`
  or `{available:8.8e9}`); older versions used a positional ARRAY. `latestByLegend`
  must handle BOTH (object → use as-is; array → zip against legend minus "time").
  Do NOT assume the object form "falls through to data rows" — read it directly so
  the headline number is the aggregate, not a single last sample.

**Why:** zipping mean against the full legend (or slicing the timestamp off the
data row while keeping the full legend) is off-by-one and silently maps `idle`,
`used`, `free`, etc. to the wrong values. Test fixtures that omit `"time"` pass
while production is wrong.

**How to apply:** any parser over TrueNAS reporting graphs must branch on the
data source (raw rows vs mean). Keep fixtures realistic (include `"time"`).

## 1b. The body attribute is `query`, NOT `reporting_query` (SCALE 25.10)
- `reporting/get_data` POST body = `{ graphs:[{name,identifier?}], query:{start,end,aggregate} }`.
- SCALE 25.10 rejects `reporting_query` with HTTP **400** `"The following
  attributes are not expected: reporting_query"` — confirmed by live diagnostic.
  This (not the window shape) is the cause of CPU 0% / RAM 0.0 GB while pools load.
- **Why:** the middleware method is `get_data(graphs, query)`; the REST wrapper
  maps body keys to arg names, so the key must be `query`.
- 25.10 graph notes: `interface` REQUIRES an identifier (e.g. `enp14s0` physical
  NIC vs `pterodactyl0`/docker bridge — exclude virtual); `cpu`/`memory`/`arcsize`
  have identifiers:null (no id needed).
- **CRITICAL — `/reporting/graphs` list ≠ `get_data` accepted enum.** The graphs
  list advertises the split ARC graphs (`demanddatahitpercentage`,
  `demanddatahitspersecond`, …) but `get_data` REJECTS them with HTTP **422** and
  the enum it DOES accept is the legacy set: `cpu,cputemp,disk,interface,load,
  processes,memory,uptime,arcactualrate,arcrate,arcsize,arcresult,disktemp,ups*`.
  So `arcactualrate`/`arcrate`/`arcresult` ARE still valid in get_data (just not
  listed by /reporting/graphs). Use those for ARC hit ratio, NOT demand* graphs.
- **`get_data` 422s the ENTIRE batch on ONE invalid graph name.** A single bad
  name (e.g. demanddatahitpercentage) nukes interface + arcsize too → Network I/A
  AND ZFS ARC tiles both go blank. Keep best-effort/uncertain graph names in their
  OWN get_data POST, isolated from guaranteed-valid ones (allSettled, merge before
  parse).
- 25.10 cpu legend = `["time","cpu","cpu0"…"cpuN"]` — `cpu` is AGGREGATE usage %
  (NO idle column); parse `cpu["cpu"]` directly, fall back to `100-idle` only for
  older versions. memory legend = `["time","available"]` ONLY (no used/free) →
  total RAM must come from system/info physmem; used = physmem - available.

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
- Net throughput + ZFS ARC come from reporting graphs `interface` and `arcsize`
  — requested in their OWN POST, settled independently from the cpu/memory call.
- 25.10 extras call resolves a physical `interface` identifier first (via
  `resolvePhysicalInterface` over GET reporting/graphs, excluding lo/docker/veth/
  br-/pterodactyl/etc). Then it issues TWO get_data POSTs (allSettled): a CORE one
  `[interface(id), arcsize]` (guaranteed-valid names) and a SEPARATE ARC-ratio one
  `[arcresult, arcrate, arcactualrate]`. Merge both result arrays, parse once.
- ARC hit ratio reads the FIRST of `arcresult/arcrate/arcactualrate` that returns
  data; the parser accepts either a direct percentage dimension
  (percentage/percent/hit%/ratio/hitratio/value) OR a hits/misses pair it converts
  to `hits/(hits+misses)*100`. The demand* percentage graphs do NOT work (422).
- **Why split into two POSTs:** one invalid graph name 422s the whole batch (that
  is exactly how demanddatahitpercentage blanked Network + ARC). Isolating the
  uncertain ARC-ratio names means they can never regress interface/arcsize.
- Unit assumptions (documented in code): interface values are kilobits/s → Mbps
  `/1000`; `arcsize` is bytes → GB `/1e9`. Parser tolerates legend key aliases
  (received/rx/in, sent/tx/out, arc_size/size/arcsz/arc/c for size).

## 4. Sparkline series need a longer, NON-aggregated extras window
- The core CPU/RAM call stays aggregated (short now-90s…now-30s, `aggregate:true`
  → single mean). The net/ARC extras call uses a LONGER trailing window
  (`now-1800s…now-30s`) with `aggregate:false` so each `data` row is one time
  step → a real per-sample series for sparklines.
- **Why:** `aggregate:true` collapses the rows to one mean value; you cannot draw
  a trend from a single point. Zip each legend column across ALL rows
  (`seriesByLegend`), then downsample to ≤30 evenly-spaced points to bound payload.
- Current value still works: with no mean present, `latestByLegend` falls back to
  the LAST data row, so the headline number is just the most recent sample.
- ARC hit-ratio series: prefer the graph's percentage dimension per-row; if only
  hit/miss rates exist, zip the two series and compute `h/(h+m)*100` per row.
