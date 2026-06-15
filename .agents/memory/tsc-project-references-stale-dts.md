---
name: tsc project references serve stale .d.ts
description: Why a workspace typecheck reports missing exports/fields that clearly exist in source
---

Running an artifact's `pnpm typecheck` (`tsc -p tsconfig.json --noEmit`) can report errors like
"Module '@workspace/api-client-react' has no exported member X" or "Property Y does not exist on type Tile"
even though the source under `lib/<pkg>/src` clearly defines them.

**Why:** The artifact tsconfig lists `references` to the lib packages, which are `composite: true` and emit
declarations to `lib/<pkg>/dist` (emitDeclarationOnly). `tsc -p` (non-build mode) resolves a referenced
project through its **stale `dist/*.d.ts`**, not its current `src`. After `src/generated` is regenerated
(e.g. spec adds Radarr/integration/metrics), the `dist` declarations and `tsconfig.tsbuildinfo` are out of
date, so the typecheck sees the old API surface. The dev app still runs fine because Vite/esbuild compile
from source and skip type-checking.

**How to apply:** Before trusting (or debugging) a workspace typecheck failure, rebuild the referenced libs'
declarations first: `npx tsc --build lib/api-client-react/tsconfig.json lib/api-zod/tsconfig.json lib/db/tsconfig.json`
(add others as needed), then re-run the artifact typecheck. Errors localized to untouched files
(Settings.tsx, dashboard.tsx, hooks) across many packages are the tell-tale sign of stale refs, not real regressions.
