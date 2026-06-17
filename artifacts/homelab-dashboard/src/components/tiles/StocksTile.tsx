import {
  useGetStocksWidget,
  getGetStocksWidgetQueryKey,
  useGetStockCandles,
  getGetStockCandlesQueryKey,
} from "@workspace/api-client-react";
import type { StockQuote } from "@workspace/api-client-react";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";
import { tileBudget, ROW_PX, TWO_LINE_ROW_PX, STAT_ROW_PX, listColumnClass, listColumnStyle } from "./metrics";

// Compact inline sparkline of recent closing prices. Renders a single polyline
// scaled to fit the given box, colored by overall direction (first → last). The
// path is purely decorative, so it is hidden from assistive tech.
function Sparkline({ closes, width = 56, height = 18 }: { closes: number[]; width?: number; height?: number }) {
  if (closes.length < 2) return null;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const stepX = width / (closes.length - 1);
  // Leave 1px padding top/bottom so the stroke never clips at the edges.
  const pad = 1;
  const usableH = height - pad * 2;
  const points = closes
    .map((c, i) => {
      const x = i * stepX;
      const y = pad + (1 - (c - min) / span) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = closes[closes.length - 1] >= closes[0];
  const stroke = up ? "rgb(34 197 94)" : "rgb(239 68 68)"; // green-500 / red-500
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="flex-shrink-0"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Format a currency-ish number compactly. Large totals get thousands grouping;
// per-share prices keep two decimals.
function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSigned(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtMoney(n)}`;
}

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

// Tailwind color class for an up/down/flat value.
function toneClass(n: number): string {
  if (n > 0) return "text-green-500";
  if (n < 0) return "text-red-500";
  return "text-muted-foreground";
}

interface Row {
  quote: StockQuote;
  shares: number | null;
  costBasis: number | null;
}

export default function StocksTile({ enabled, density, tileSettings }: WidgetProps) {
  const watchlist = tileSettings?.stockWatchlist ?? [];
  // Symbols requested from the backend (in watchlist order). When the watchlist
  // is empty we send nothing and the route returns representative sample quotes.
  const symbols = watchlist.map((e) => e.symbol).filter(Boolean);
  const symbolsParam = symbols.length > 0 ? symbols.join(",") : undefined;
  const params = { symbols: symbolsParam };

  const { data, isLoading, isError } = useGetStocksWidget(params, {
    query: {
      queryKey: getGetStocksWidgetQueryKey(params),
      refetchInterval: 60_000,
      staleTime: 30_000,
      retry: 1,
    },
  });

  // Recent closing-price series for the sparkline metric. Only fetched when the
  // "sparkline" metric is enabled; closes change slowly, so refresh sparingly.
  const showSparkline = enabled.has("sparkline");
  const { data: candleData } = useGetStockCandles(params, {
    query: {
      queryKey: getGetStockCandlesQueryKey(params),
      enabled: showSparkline,
      refetchInterval: 15 * 60_000,
      staleTime: 10 * 60_000,
      retry: 1,
    },
  });
  const closesBySymbol = new Map((candleData?.series ?? []).map((s) => [s.symbol, s.closes]));

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-1">
        <TrendingDown className="w-5 h-5 opacity-50" />
        <span>Quotes unavailable</span>
      </div>
    );
  }

  if (data.quotes.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-center text-muted-foreground text-sm gap-1 px-3">
        <TrendingUp className="w-5 h-5 opacity-50" />
        <span>Add symbols in this tile's settings.</span>
      </div>
    );
  }

  // Join quotes back to their watchlist entry so we can carry per-symbol shares
  // and cost basis (the watchlist holds them; the quote response does not).
  const entryBySymbol = new Map(watchlist.map((e) => [e.symbol, e]));
  const rows: Row[] = data.quotes.map((quote) => {
    const entry = entryBySymbol.get(quote.symbol);
    const shares = entry?.shares != null && entry.shares > 0 ? entry.shares : null;
    const costBasis = entry?.costBasis != null && entry.costBasis > 0 ? entry.costBasis : null;
    return { quote, shares, costBasis };
  });

  const showChange = enabled.has("dailyChange");
  const showPortfolio = enabled.has("portfolio");

  // The portfolio summary only matters when at least one row tracks shares.
  const hasPositions = rows.some((r) => r.shares != null);
  const positioned = rows.filter((r) => r.shares != null);
  const totalValue = positioned.reduce((sum, r) => sum + r.quote.price * (r.shares ?? 0), 0);
  const totalGainLoss = positioned
    .filter((r) => r.costBasis != null)
    .reduce((sum, r) => sum + (r.quote.price - (r.costBasis ?? 0)) * (r.shares ?? 0), 0);
  const totalCost = positioned
    .filter((r) => r.costBasis != null)
    .reduce((sum, r) => sum + (r.costBasis ?? 0) * (r.shares ?? 0), 0);
  const totalGainPct = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;
  const showSummary = showPortfolio && hasPositions;

  // Reveal as much as fits: the portfolio summary block first (priority), then
  // as many symbol rows as the measured body allows. Rows that carry shares are
  // two-line (price + position), so cost slightly more.
  const budget = tileBudget(density);
  const wide = density.bodyWidth >= 240;
  const summaryVisible = showSummary && budget.block(STAT_ROW_PX);
  const rowCost = showPortfolio && hasPositions ? TWO_LINE_ROW_PX : ROW_PX;
  const rowCount = budget.list(0, rowCost, rows.length);
  const visibleRows = rows.slice(0, rowCount);

  return (
    <div className="w-full h-full p-3 flex flex-col gap-2 text-foreground">
      {summaryVisible && (
        <div className="flex items-baseline justify-between gap-2 border-b border-border pb-1.5">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Portfolio value
            </div>
            <div className="text-lg font-bold tabular-nums leading-tight">
              ${fmtMoney(totalValue)}
            </div>
          </div>
          {totalCost > 0 && (
            <div className={`text-right text-xs font-medium tabular-nums ${toneClass(totalGainLoss)}`}>
              <div>{fmtSigned(totalGainLoss)}</div>
              <div>{fmtPct(totalGainPct)}</div>
            </div>
          )}
        </div>
      )}

      <div
        className={`flex-1 min-h-0 ${listColumnClass(budget.columns, "flex flex-col gap-1.5")}`}
        style={listColumnStyle(budget.columns)}
      >
        {visibleRows.map(({ quote, shares, costBasis }) => {
          const positionValue = shares != null ? quote.price * shares : null;
          const gainLoss =
            shares != null && costBasis != null ? (quote.price - costBasis) * shares : null;
          const closes = closesBySymbol.get(quote.symbol);
          const sparkVisible = showSparkline && wide && closes != null && closes.length >= 2;
          return (
            <div key={quote.symbol} className="min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex items-baseline gap-1.5">
                  <span className="text-xs font-semibold">{quote.symbol}</span>
                  {wide && quote.name && (
                    <span className="text-[10px] text-muted-foreground truncate">
                      {quote.name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {sparkVisible && <Sparkline closes={closes} />}
                  <span className="text-xs font-medium tabular-nums">
                    ${fmtMoney(quote.price)}
                  </span>
                  {showChange && (
                    <span className={`text-xs tabular-nums ${toneClass(quote.changePercent)}`}>
                      {fmtPct(quote.changePercent)}
                    </span>
                  )}
                </div>
              </div>
              {showPortfolio && positionValue != null && (
                <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground tabular-nums">
                  <span>
                    {shares} sh · ${fmtMoney(positionValue)}
                  </span>
                  {gainLoss != null && (
                    <span className={toneClass(gainLoss)}>{fmtSigned(gainLoss)}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {data.sample && (
        <div className="text-[10px] text-muted-foreground text-center pt-0.5">
          Sample data — add a stock API key for live quotes
        </div>
      )}
    </div>
  );
}
