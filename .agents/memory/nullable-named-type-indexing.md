---
name: Indexing @nullable named schema types
description: Why TileSettings["field"] fails despite the field existing
---
Orval/codegen generates `@nullable` named object schemas (e.g. `TileSettings`, `TileMetrics`) as a UNION: `{ ...props } | null`. Consequences in consumer code:

- `TileSettings["someField"]` → TS2339 "Property does not exist" because the `null` arm has no properties.
- `keyof TileSettings` → `never` (keyof of a union is the INTERSECTION of each arm's keys, and `keyof null` is `never`).
- Yet `tile.tileSettings?.someField` works fine, because the `Tile` interface inlines the non-null object shape, and optional chaining handles null.

**Fix:** index/keyof the non-null form: `NonNullable<TileSettings>["someField"]`.

**Why this matters:** the symptom looks exactly like a stale-cache / stale-.d.ts bug (field is clearly in src AND dist, tsc resolves to the right file, `tsc --build` on libs passes). It is NOT a cache problem. Before chasing caches, run a probe: `const y: {__x:1} = (x as TileSettings)` — if the error says "Type 'null' is not assignable", the named type is nullable.
