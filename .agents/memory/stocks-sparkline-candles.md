---
name: Stocks sparkline candles
description: How the Stocks tile sparkline (recent closes) endpoint + frontend gating works
---

The Stocks tile can render an inline price-trend sparkline per watchlist row.

- Endpoint: `GET /widgets/stocks/candles?symbols=A,B` →
  `{ series: [{ symbol, closes: number[] }], sample: boolean }`.
- Convention (same as /widgets/stocks): no provider key → sample series
  (`sample:true`); key configured but upstream fails → 502; key configured
  but no symbols → empty non-sample.
- Live path proxies Finnhub `/stock/candle` (resolution D, ~45-day window),
  keeps the last ~30 closes, drops symbols whose response is not `s:"ok"`.

**Why the sample matters:** sample closes are deterministic per-symbol and
drift toward the symbol's *sample* `changePercent` direction, with the final
close pinned to the sample price. So the sparkline's first→last direction
(green up / red down) matches the row's daily-change tone even with no key —
important because the Replit/dev environment always runs the sample path.

**How to apply (frontend, StocksTile.tsx):**
- Metric key is `sparkline` (label "Trend sparkline") in metrics.ts stocks
  catalog. It gates rendering via the `enabled` set.
- The candles query is `enabled`-gated on the metric (don't fetch when off)
  and refreshes slowly (15m interval / 10m stale) since closes change daily.
- Sparkline only shows when the metric is on AND the tile body is wide
  (`density.bodyWidth >= 240`) to avoid cramping narrow tiles.
