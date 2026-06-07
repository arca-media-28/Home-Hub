---
name: react-grid-layout CJS interop with Vite
description: How to use react-grid-layout's Responsive and WidthProvider in a Vite project
---

# react-grid-layout CJS interop

## The Rule
Do NOT use `import { Responsive, WidthProvider } from "react-grid-layout"`.
Vite's esbuild pre-bundler does NOT lift extra properties set on `module.exports` as named ESM exports.

## Why
react-grid-layout's index.js does:
```js
module.exports = require("./build/ReactGridLayout").default; // the GridLayout component
module.exports.Responsive = ...;
module.exports.WidthProvider = ...;
```
Vite treats `module.exports` as the default export only. Named export destructuring fails at runtime ("does not provide an export named 'WidthProvider'").

## How to Apply
Use the default GridLayout export directly and measure container width with a ResizeObserver:

```tsx
import GridLayout from "react-grid-layout";

const [gridWidth, setGridWidth] = useState(1200);
const containerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  const ro = new ResizeObserver(entries => {
    setGridWidth(entries[0].contentRect.width);
  });
  ro.observe(el);
  return () => ro.disconnect();
}, []);

// In JSX:
<div ref={containerRef}>
  <GridLayout layout={layout} cols={12} rowHeight={80} width={gridWidth} ...>
    {children}
  </GridLayout>
</div>
```

Also: import `react-resizable/css/styles.css` fails (transitive dep not hoisted by pnpm).
Inline the CSS into `index.css` instead.
