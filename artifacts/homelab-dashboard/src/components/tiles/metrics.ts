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
  [TileIntegration.media]: [{ key: "recent", label: "Recently added" }],
  [TileIntegration.pihole]: [
    { key: "queries", label: "DNS queries today" },
    { key: "blocked", label: "Ads blocked today" },
    { key: "status", label: "Pi-hole status" },
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
// Translate a tile's grid dimensions into a density used by widgets to decide
// how compact/expanded to render. Height drives vertical room; width nudges the
// list length up a touch on wide tiles.

export type DensityLevel = "sm" | "md" | "lg";

export interface TileDensity {
  level: DensityLevel;
  // How many rows a list-style section should show before clipping/scrolling.
  listLimit: number;
  // Whether to render the verbose/expanded form of a section.
  expanded: boolean;
}

export function tileDensity(gridW: number, gridH: number): TileDensity {
  let level: DensityLevel;
  if (gridH >= 5) level = "lg";
  else if (gridH >= 3) level = "md";
  else level = "sm";

  const base = level === "lg" ? 8 : level === "md" ? 5 : 2;
  // Wider tiles get a little more room for list rows.
  const listLimit = gridW >= 4 ? base + 2 : base;

  return { level, listLimit, expanded: level !== "sm" };
}
