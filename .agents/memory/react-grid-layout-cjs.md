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
