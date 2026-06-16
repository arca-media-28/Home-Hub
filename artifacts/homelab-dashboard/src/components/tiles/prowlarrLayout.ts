import type { DensityLevel } from "./metrics";

// Resolved visibility decisions for the Prowlarr tile. Kept as a pure, React-free
// helper so the size-specific rules can be unit-tested without rendering.
export interface ProwlarrLayout {
  showSummary: boolean;
  showGrabs: boolean;
  // Whether the top stat row (summary and/or grabs) renders at all.
  showStats: boolean;
  // The per-indexer list is reserved for larger tiles: a small tile shows
  // summary counts only, while md/lg tiles show the full per-indexer list.
  showIndexerList: boolean;
  showHealth: boolean;
}

export function resolveProwlarrLayout(
  level: DensityLevel,
  enabled: Set<string>,
): ProwlarrLayout {
  const showSummary = enabled.has("indexerSummary");
  const showGrabs = enabled.has("grabCount");
  const showHealth = enabled.has("healthWarnings");
  const showIndexerList = enabled.has("indexerList") && level !== "sm";

  return {
    showSummary,
    showGrabs,
    showStats: showSummary || showGrabs,
    showIndexerList,
    showHealth,
  };
}
