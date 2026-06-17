import type { CSSProperties } from "react";
import { TileIntegration } from "@workspace/api-client-react";

// ── Metric catalogs ──────────────────────────────────────────────────────────
// Single source of truth for the selectable metrics of every integration. Each
// entry has a stable `key` (persisted on the tile and checked by widgets) and a
// human `label` (shown in the tile editor). The order here is the priority order
// used when deciding what to reveal first as a tile grows.

export interface MetricDef {
  key: string;
  label: string;
}

export const METRIC_CATALOG: Record<string, MetricDef[]> = {
  [TileIntegration.truenas]: [
    { key: "cpu", label: "CPU usage" },
    { key: "ram", label: "RAM usage" },
    { key: "network", label: "Network I/O" },
    { key: "arc", label: "ZFS ARC" },
    { key: "pools", label: "ZFS pools" },
    { key: "disks", label: "Disk health" },
  ],
  [TileIntegration.sonarr]: [
    { key: "queue", label: "Download queue" },
    { key: "upcoming", label: "Upcoming releases" },
  ],
  [TileIntegration.radarr]: [
    { key: "queue", label: "Download queue" },
    { key: "upcoming", label: "Upcoming releases" },
  ],
  [TileIntegration.qbittorrent]: [
    { key: "speeds", label: "Global speeds" },
    { key: "torrents", label: "Active torrents" },
  ],
  [TileIntegration.media]: [
    { key: "recent", label: "Recently added" },
    { key: "continue", label: "Continue Watching" },
  ],
  [TileIntegration.jellyfin]: [
    { key: "recent", label: "Recently added" },
    { key: "continue", label: "Continue Watching" },
  ],
  [TileIntegration.pihole]: [
    { key: "queries", label: "DNS queries today" },
    { key: "blocked", label: "Ads blocked today" },
    { key: "status", label: "Pi-hole status" },
  ],
  [TileIntegration["nginx-proxy-manager"]]: [
    { key: "hosts", label: "Proxy hosts" },
    { key: "dead", label: "Dead hosts" },
    { key: "ssl", label: "SSL warnings" },
  ],
  [TileIntegration.prowlarr]: [
    { key: "indexerSummary", label: "Indexer summary" },
    { key: "indexerList", label: "Per-indexer status" },
    { key: "grabCount", label: "Grabs (24h)" },
    { key: "healthWarnings", label: "Health warnings" },
  ],
  [TileIntegration.tailscale]: [
    { key: "summary", label: "Device summary" },
    { key: "exitNodes", label: "Exit nodes" },
    { key: "keyWarnings", label: "Key warnings" },
    { key: "devices", label: "Device list" },
  ],
  [TileIntegration.ersatztv]: [
    { key: "health", label: "Health status" },
    { key: "activeStreams", label: "Active streams" },
    { key: "nowPlaying", label: "Now playing" },
  ],
  [TileIntegration.stocks]: [
    { key: "dailyChange", label: "Daily change" },
    { key: "sparkline", label: "Trend sparkline" },
    { key: "portfolio", label: "Portfolio totals" },
  ],
};

// All metric keys for an integration (used as the default "show all" set).
export function allMetricKeys(integration: string | null | undefined): string[] {
  if (!integration) return [];
  return (METRIC_CATALOG[integration] ?? []).map((m) => m.key);
}

// Resolve the set of enabled metric keys for a tile. A null/undefined selection
// means "show all" (backward-compatible default); an explicit array (including
// an empty one) is honored as-is, intersected with the integration's catalog so
// stale keys never leak through.
export function resolveEnabledMetrics(
  integration: string | null | undefined,
  selected: string[] | null | undefined,
): Set<string> {
  const all = allMetricKeys(integration);
  if (selected == null) return new Set(all);
  const valid = new Set(all);
  return new Set(selected.filter((k) => valid.has(k)));
}

// ── Size-aware density ────────────────────────────────────────────────────────
// Density is driven by the *measured* pixel size of a tile's live-status body
// (via a ResizeObserver in IntegrationTile), not by coarse grid units. Widgets
// turn this into a vertical "budget" and reveal as many sections/rows as fit,
// hiding the rest — so growing a tile reveals more detail and a tile never needs
// a scroll bar. Grid units only seed the first paint before measurement settles.

// Grid → pixel seed constants, matching the dashboard's GridLayout config.
const SEED_ROW_HEIGHT = 40;
const SEED_MARGIN = 12;
const SEED_COLS = 24;
const SEED_GRID_WIDTH = 1200;
// Header is h-11 (44px) plus a 1px top border on the body when shown.
const SEED_HEADER_PX = 45;

export type DensityLevel = "sm" | "md" | "lg";

export interface TileDensity {
  // Measured (or seeded) available pixel space of the live-status body. These
  // are the content-box dimensions of the body container (no padding/border),
  // i.e. the room a widget actually has to fill.
  bodyHeight: number;
  bodyWidth: number;
  // Coarse hint derived from bodyHeight, kept for any width/layout tweaks.
  level: DensityLevel;
  // When the tile's "scrollable" option is on, the body scrolls instead of
  // clipping, so widgets must stop hiding content: reveal budgets read as
  // unbounded and the coarse level is pinned to the largest tier. Centralizing
  // it here lets every widget honor scroll with little or no widget-side change.
  scrollable: boolean;
}

// Estimate the body's pixel height from grid units, used only as a seed for the
// first paint before the ResizeObserver reports a real measurement.
export function seedBodyHeight(gridH: number, showHeader: boolean): number {
  const total = gridH * SEED_ROW_HEIGHT + Math.max(0, gridH - 1) * SEED_MARGIN;
  return Math.max(0, total - (showHeader ? SEED_HEADER_PX : 0));
}

// Rough seed for the body width from grid units (replaced by the measured width
// almost immediately, so precision here is not important).
export function seedBodyWidth(gridW: number): number {
  const colW = (SEED_GRID_WIDTH - SEED_MARGIN * (SEED_COLS + 1)) / SEED_COLS;
  return Math.max(0, gridW * colW + Math.max(0, gridW - 1) * SEED_MARGIN);
}

function levelFor(bodyHeight: number): DensityLevel {
  if (bodyHeight >= 320) return "lg";
  if (bodyHeight >= 160) return "md";
  return "sm";
}

// Build the density for a tile. When `measured` is provided (the body's real
// content-box size) it wins; otherwise we seed from grid units so first paint is
// reasonable.
export function tileDensity(
  gridW: number,
  gridH: number,
  measured?: { width: number; height: number } | null,
  showHeader = true,
  scrollable = false,
): TileDensity {
  const bodyHeight = measured ? measured.height : seedBodyHeight(gridH, showHeader);
  const bodyWidth = measured ? measured.width : seedBodyWidth(gridW);
  // When the body scrolls, nothing is hidden — so the coarse level reads as the
  // largest tier so level-gated widgets (e.g. Prowlarr's indexer list) also show
  // their full content.
  const level = scrollable ? "lg" : levelFor(bodyHeight);
  return { bodyHeight, bodyWidth, level, scrollable };
}

// ── Horizontal columns ────────────────────────────────────────────────────────
// Short, wide tiles otherwise hide content vertically while leaving the right
// side empty. To use that room, the revealed list/row-heavy sections flow into
// multiple columns once the body is wide enough. The count is driven purely by
// the measured body width — a narrow tile stays a single column — and capped so
// rows never get too cramped to read.
const COLUMN_WIDTH_PX = 230;
const MAX_COLUMNS = 4;

export function tileColumns(bodyWidth: number): number {
  if (!Number.isFinite(bodyWidth) || bodyWidth <= 0) return 1;
  return Math.max(1, Math.min(MAX_COLUMNS, Math.floor(bodyWidth / COLUMN_WIDTH_PX)));
}

// Class + style helpers a widget applies to a list container so its rows flow
// into the resolved number of columns. With a single column the widget keeps its
// existing vertical-spacing class verbatim (so the non-multi-column path is
// byte-for-byte unchanged); with more columns it switches to a CSS grid that
// fills left-to-right, preserving metric-priority reading order.
export function listColumnClass(columns: number, singleColumnClass: string): string {
  return columns > 1 ? "grid gap-x-4 gap-y-1.5" : singleColumnClass;
}

export function listColumnStyle(columns: number): CSSProperties | undefined {
  return columns > 1
    ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
    : undefined;
}

// ── Reveal budget ─────────────────────────────────────────────────────────────
// A small stateful helper a widget builds once per render from its density. The
// widget calls `block`/`list` in metric-priority order; each call reveals the
// item only if it still fits the remaining vertical space (and deducts its
// cost). To avoid an empty body on the smallest tiles, the *first* requested
// item is always revealed even if it slightly overflows the measured space.

// Shared, deliberately slightly-generous pixel estimates for common elements.
// Leaning generous means we under-fill rather than clip, since the body now
// clips overflow instead of scrolling.
export const BAR_PX = 34; // labelled progress bar (label line + bar + spacing)
export const ROW_PX = 24; // single-line list row (text-xs)
export const TWO_LINE_ROW_PX = 38; // two-line list row
export const MEDIA_ROW_PX = 44; // list row with a 32px cover thumbnail
export const STAT_ROW_PX = 50; // big-number stat block
export const SECTION_PX = 26; // a section label/header incl. top spacing

// Sleeper (fantasy) tile element heights, used by SleeperTile's budget math so
// its section reveal is consistent with the rest of the system.
export const SLEEPER_MATCHUP_PX = 112; // matchup block: two team rows + actual/projected scores + vs
export const SLEEPER_STANDING_ROW_PX = 22; // one ranked standings row (text-xs)
// Recent-moves rendering is per-transaction (variable height) rather than a
// fixed row, so SleeperTile estimates each move's height from these parts.
export const SLEEPER_TX_HEADER_PX = 16; // a move's type/time header line
export const SLEEPER_TX_TEAM_PX = 15; // a trade party's team-name heading
export const SLEEPER_TX_PLAYER_PX = 24; // one player line (20px avatar + label)
export const SLEEPER_TX_BLOCK_PX = 10; // a move block's own padding/margin

export interface TileBudget {
  // Measured body width, for any width-dependent layout choices.
  readonly width: number;
  // Remaining vertical pixels (after the widget's own padding). Reads as
  // Infinity when the tile is scrollable (nothing is hidden).
  readonly remaining: number;
  // How many columns the revealed list/row sections should flow into, derived
  // from the measured body width (1 when narrow). Widgets pass this to
  // listColumnClass/listColumnStyle when rendering their rows.
  readonly columns: number;
  // Reveal a fixed-height block. Returns true (and deducts) if it fits or if it
  // is the first item requested; false otherwise. Always true when scrollable.
  block(px: number): boolean;
  // Reveal a list section with `headerPx` of fixed chrome and `available` rows
  // of `rowPx` each. Returns the number of rows to render (0 hides the whole
  // section). Rows fill the configured columns, so a wider tile fits more rows
  // before anything is hidden. Guarantees at least one row if nothing has been
  // shown yet, and returns every available row when scrollable.
  list(headerPx: number, rowPx: number, available: number): number;
}

// Build a budget from a density. `paddingY` is the widget root's own vertical
// padding (p-3 → 24px) which is not part of the content space for reveal. When
// the tile is scrollable the body scrolls instead of clipping, so the vertical
// budget reads as unbounded (every block/row is revealed) while the column count
// still applies so the revealed content uses the horizontal space too.
export function tileBudget(density: TileDensity, paddingY = 24): TileBudget {
  const columns = tileColumns(density.bodyWidth);
  let remaining = density.scrollable
    ? Number.POSITIVE_INFINITY
    : Math.max(0, density.bodyHeight - paddingY);
  let shown = 0;

  return {
    width: density.bodyWidth,
    columns,
    get remaining() {
      return remaining;
    },
    block(px: number): boolean {
      const force = shown === 0;
      if (force || px <= remaining) {
        remaining -= px;
        shown++;
        return true;
      }
      return false;
    },
    list(headerPx: number, rowPx: number, available: number): number {
      if (available <= 0) return 0;
      const force = shown === 0;
      if (!force && headerPx > remaining) return 0;
      const afterHeader = remaining - headerPx;
      // Each column holds `rowsPerColumn` rows, so the section's row capacity
      // scales with the column count while its vertical cost is the height of a
      // single column's worth of rows.
      const rowsPerColumn = Math.floor(afterHeader / Math.max(1, rowPx));
      let rows = rowsPerColumn * columns;
      if (rows < 1 && force) rows = 1; // never leave the body empty
      rows = Math.max(0, Math.min(available, rows));
      if (rows === 0) return 0; // header alone is useless — hide the section
      const rowsTall = Math.ceil(rows / columns);
      remaining = afterHeader - rowsTall * rowPx;
      shown += 1 + rows;
      return rows;
    },
  };
}
