import { describe, it, expect } from "vitest";
import { resolveProwlarrLayout } from "./prowlarrLayout";

const ALL = new Set(["indexerSummary", "indexerList", "grabCount", "healthWarnings"]);

describe("resolveProwlarrLayout", () => {
  it("hides the per-indexer list on small tiles (summary counts only)", () => {
    const layout = resolveProwlarrLayout("sm", ALL);
    expect(layout.showIndexerList).toBe(false);
    expect(layout.showStats).toBe(true);
    expect(layout.showSummary).toBe(true);
    expect(layout.showGrabs).toBe(true);
    expect(layout.showHealth).toBe(true);
  });

  it("shows the full per-indexer list on medium and large tiles", () => {
    expect(resolveProwlarrLayout("md", ALL).showIndexerList).toBe(true);
    expect(resolveProwlarrLayout("lg", ALL).showIndexerList).toBe(true);
  });

  it("keeps the list hidden when its metric is toggled off, even on large tiles", () => {
    const noList = new Set(["indexerSummary", "grabCount", "healthWarnings"]);
    expect(resolveProwlarrLayout("lg", noList).showIndexerList).toBe(false);
  });

  it("hides the stat row when both summary and grab metrics are off", () => {
    const noStats = new Set(["indexerList", "healthWarnings"]);
    const layout = resolveProwlarrLayout("lg", noStats);
    expect(layout.showStats).toBe(false);
    expect(layout.showSummary).toBe(false);
    expect(layout.showGrabs).toBe(false);
  });

  it("respects individual metric toggles", () => {
    const onlySummary = new Set(["indexerSummary"]);
    const layout = resolveProwlarrLayout("lg", onlySummary);
    expect(layout.showSummary).toBe(true);
    expect(layout.showGrabs).toBe(false);
    expect(layout.showHealth).toBe(false);
    expect(layout.showIndexerList).toBe(false);
  });
});
