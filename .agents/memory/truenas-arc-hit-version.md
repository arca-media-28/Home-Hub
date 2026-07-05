---
name: TrueNAS ARC hit-ratio is version-dependent
description: Why ARC-hit graphs must be probed as isolated per-name get_data calls, and the empty-500 testing gotcha on the /truenas route
---

# ARC hit ratio differs across SCALE versions (mutually exclusive)

The two working forms of the ZFS ARC hit-ratio graph do NOT coexist on a box:
- **Older SCALE**: `reporting/get_data` accepts the legacy aggregate graphs
  (`arcresult` / `arcrate` / `arcactualrate`) even though `/reporting/graphs`
  does NOT advertise them, and REJECTS the `demand*hitpercentage` graphs with
  HTTP **422**.
- **Newer SCALE (25.x)**: the legacy names are GONE — get_data throws HTTP **500**
  `KeyError: 'arcresult'` — and the real hit% lives in the demand* percentage
  graphs (`demanddatahitpercentage`, vertical_label `"hit%"`) that
  `/reporting/graphs` advertises. `arcsize` (bytes) keeps working on both.

**Why isolated calls:** one unknown graph name fails the WHOLE get_data batch
(422 old / 500 new). So every ARC-hit candidate must ride its OWN get_data POST
(Promise.allSettled), and the first that returns data wins. Never batch the
best-effort ARC-hit candidates with the guaranteed-valid interface/arcsize graphs
or a rejected candidate takes Network + ARC size down with it.

**How to apply:** `ARC_HIT_GRAPHS` holds both legacy + demand* names; the parser
(`arcHitFrom`) handles a `/percent/i`-named graph by reading its sole non-time
legend column as the %. disktemp on 25.x must be fetched BY identifier (from
`/reporting/graphs`) over a WIDE window (now-3600 … now-30, aggregate) — disk
temps sample far slower than the cpu/mem window.

# Empty-500 gotcha on GET /widgets/truenas

The `/truenas` route has **no top-level try/catch** (unlike other widget routes
that end in a 502 catch). Under Express 5 any uncaught async throw becomes a
**500 with an empty `{}` body**. When a truenas test unexpectedly 500s, it is an
uncaught throw INSIDE the handler, not a normal error path.

**Testing lesson:** the widgets.test.ts `logger` mock must include EVERY pino
level the route calls. A missing `debug` (or any level) makes `logger.<lvl> is
not a function` throw → empty 500 in the exact code path that uses it. Keep the
mock at `{ error, warn, info, debug }`.
