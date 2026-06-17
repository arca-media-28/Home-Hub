---
name: react-grid-layout CJS browser quirk
description: react-grid-layout references process.env.NODE_ENV at runtime in the browser, requiring a Vite define shim to avoid crashes.
---

## Rule
When using `react-grid-layout` with Vite, add a `define` block to `vite.config.ts` to shim `process.env.NODE_ENV` in the browser bundle.

```ts
define: {
  "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
},
```

**Why:** `react-grid-layout` is a CJS package that calls `process.env.NODE_ENV` inside browser-executed code (e.g. in `DraggableCore.handleDragStart`). Without the shim, dragging any tile crashes the app with `ReferenceError: process is not defined`.

**How to apply:** Add to the `defineConfig({})` call in `vite.config.ts` alongside the other config blocks. This is required even though Vite normally handles `import.meta.env` — CJS packages that use Node's `process` object directly bypass that mechanism.

Also: Do NOT use named imports `{Responsive, WidthProvider}` from react-grid-layout with Vite — esbuild CJS interop doesn't lift them. Use the default `GridLayout` export and cast it as `ComponentType<any>` to work around missing TS prop types (cols, margin, containerPadding).

## v2.2.3 composable-config API (top-level props silently ignored)
The installed `react-grid-layout@2.2.3` is a **rewrite** whose `.` default export (`GridLayout`) reads grid settings from a single `gridConfig={{cols, rowHeight, margin, containerPadding, maxRows}}` prop (and `dragConfig`/`resizeConfig` for `isDraggable`/`isResizable`/`draggableHandle`). The classic **top-level** props (`cols`, `rowHeight`, `margin`, `containerPadding`, `isDraggable`, `isResizable`, `draggableHandle`) are **silently ignored** — it falls back to `defaultGridConfig` (cols=12, margin=[10,10], rowHeight=150). Verified: passing `cols={25}` for a tile at gridX=18 still clamps it to a 12-col grid.

**Why:** the dashboard's `<GridLayout cols=… margin=… rowHeight=… />` usage predates the rewrite, so on `^2.2.3` the wider-screen column scaling (`colsForWidth`) and custom 40px rows never reach the grid. The legacy top-level API lives at the `react-grid-layout/legacy` export instead.

**How to apply:** when asserting grid positioning in tests, do NOT rely on react-grid-layout's pixel output with top-level props — it won't honor them on v2.2.3. Either mock the grid and assert the props the component hands it, import from `react-grid-layout/legacy`, or migrate the dashboard to the `gridConfig`/`dragConfig` composable API.
