---
name: Integration picker + metadata
description: App-store style integration picker for the tile editor and the shared metadata that feeds it
---

# Integration picker

The tile editor's "App integration" control is an app-store style pop-out
(`src/components/IntegrationPicker.tsx`), not a Radix Select. It shows grouped
cards (icon + name + one-line description), a name search box, selected-state
highlight, and a reachability dot.

- Display metadata (icon + description, keyed by TileIntegration value, plus a
  `none` entry) lives in `src/lib/integrationMeta.tsx`. Names still come from the
  `INTEGRATIONS` list in `TileEditModal` and grouping from `groupByCategory`
  (integrationCategories) — do not duplicate those.
- `INTEGRATION_SERVICE` (tile integration value → connection service key for the
  reachability dot) is the single source in `integrationMeta.tsx`; `dashboard.tsx`
  imports it. Only ~7 connection-backed integrations have a service key.
- The picker fetches `useGetConnectionsStatus` only while open (enabled gate) to
  avoid background polling; the dashboard still polls it on its own.

**Why:** the integration list grew to ~28 entries; a flat dropdown was unscannable.

**Gotcha — dashboard.layout.test.tsx:** that test hand-mocks
`@workspace/api-client-react`, so it must export EVERY value `dashboard.tsx`
touches at render. Because the dashboard imports `integrationMeta` (which reads
`TileIntegration.*` at module load) and calls the multi-page hooks
(`useGetPages`/`useCreatePage`/`useUpdatePage`/`useDeletePage`/`useReorderPages`
+ `getGetPagesQueryKey`) unconditionally, the mock needs `TileIntegration` (an
object whose values equal their keys) and all those page hooks, or it throws
"No X export is defined on the mock".
