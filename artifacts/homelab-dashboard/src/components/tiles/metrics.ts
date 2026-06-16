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
    { key: "pools", label: "ZFS pools" },
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
const SEED_ROW_HEIGHT = 80;
const SEED_MARGIN = 12;
const SEED_COLS = 12;
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
): TileDensity {
  const bodyHeight = measured ? measured.height : seedBodyHeight(gridH, showHeader);
  const bodyWidth = measured ? measured.width : seedBodyWidth(gridW);
  return { bodyHeight, bodyWidth, level: levelFor(bodyHeight) };
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

export interface TileBudget {
  // Measured body width, for any width-dependent layout choices.
  readonly width: number;
  // Remaining vertical pixels (after the widget's own padding).
  readonly remaining: number;
  // Reveal a fixed-height block. Returns true (and deducts) if it fits or if it
  // is the first item requested; false otherwise.
  block(px: number): boolean;
  // Reveal a list section with `headerPx` of fixed chrome and `available` rows
  // of `rowPx` each. Returns the number of rows to render (0 hides the whole
  // section). Guarantees at least one row if nothing has been shown yet.
  list(headerPx: number, rowPx: number, available: number): number;
}

// Build a budget from a density. `paddingY` is the widget root's own vertical
// padding (p-3 → 24px) which is not part of the content space for reveal.
export function tileBudget(density: TileDensity, paddingY = 24): TileBudget {
  let remaining = Math.max(0, density.bodyHeight - paddingY);
  let shown = 0;

  return {
    width: density.bodyWidth,
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
      let rows = Math.floor(afterHeader / Math.max(1, rowPx));
      if (rows < 1 && force) rows = 1; // never leave the body empty
      rows = Math.max(0, Math.min(available, rows));
      if (rows === 0) return 0; // header alone is useless — hide the section
      remaining = afterHeader - rows * rowPx;
      shown += 1 + rows;
      return rows;
    },
  };
}
