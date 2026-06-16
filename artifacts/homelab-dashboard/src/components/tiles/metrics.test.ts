import { describe, it, expect } from "vitest";
import { TileIntegration } from "@workspace/api-client-react";
import {
  allMetricKeys,
  resolveEnabledMetrics,
  tileDensity,
  tileBudget,
  seedBodyHeight,
  METRIC_CATALOG,
  ROW_PX,
  SECTION_PX,
} from "./metrics";

describe("allMetricKeys", () => {
  it("returns every catalog key for a known integration", () => {
    expect(allMetricKeys(TileIntegration.truenas)).toEqual(["cpu", "ram", "pools", "disks"]);
    expect(allMetricKeys(TileIntegration.sonarr)).toEqual(["queue", "upcoming"]);
    expect(allMetricKeys(TileIntegration.qbittorrent)).toEqual(["speeds", "torrents"]);
    expect(allMetricKeys(TileIntegration.media)).toEqual(["recent", "continue"]);
  });

  it("returns an empty list when there is no integration", () => {
    expect(allMetricKeys(null)).toEqual([]);
    expect(allMetricKeys(undefined)).toEqual([]);
    expect(allMetricKeys("not-a-real-integration")).toEqual([]);
  });
});

describe("resolveEnabledMetrics", () => {
  it("shows all metrics when the selection is null (backward-compatible default)", () => {
    const enabled = resolveEnabledMetrics(TileIntegration.truenas, null);
    expect([...enabled].sort()).toEqual(["cpu", "disks", "pools", "ram"]);
  });

  it("shows all metrics when the selection is undefined", () => {
    const enabled = resolveEnabledMetrics(TileIntegration.sonarr, undefined);
    expect([...enabled].sort()).toEqual(["queue", "upcoming"]);
  });

  it("honors an explicit subset (hidden vs shown metrics)", () => {
    const enabled = resolveEnabledMetrics(TileIntegration.truenas, ["cpu"]);
    expect(enabled.has("cpu")).toBe(true);
    expect(enabled.has("ram")).toBe(false);
    expect(enabled.has("pools")).toBe(false);
  });

  it("treats an empty array as 'show nothing', not 'show all'", () => {
    const enabled = resolveEnabledMetrics(TileIntegration.truenas, []);
    expect(enabled.size).toBe(0);
  });

  it("drops stale keys that are not in the integration's catalog", () => {
    const enabled = resolveEnabledMetrics(TileIntegration.sonarr, ["queue", "cpu", "bogus"]);
    expect([...enabled]).toEqual(["queue"]);
  });

  it("returns an empty set for a tile with no integration", () => {
    expect(resolveEnabledMetrics(null, null).size).toBe(0);
    expect(resolveEnabledMetrics(null, ["cpu"]).size).toBe(0);
  });
});

describe("tileDensity", () => {
  it("seeds body height/width from grid units when no measurement is given", () => {
    // gridH=3 with a header → 3*80 + 2*12 - 45 = 219px of body.
    const d = tileDensity(2, 3);
    expect(d.bodyHeight).toBe(seedBodyHeight(3, true));
    expect(d.bodyHeight).toBe(219);
    expect(d.bodyWidth).toBeGreaterThan(0);
  });

  it("drops the header from the seed when the tile has no header", () => {
    const withHeader = tileDensity(2, 3, null, true);
    const noHeader = tileDensity(2, 3, null, false);
    // No header → more body room (the 45px header is reclaimed).
    expect(noHeader.bodyHeight).toBeGreaterThan(withHeader.bodyHeight);
    expect(noHeader.bodyHeight - withHeader.bodyHeight).toBe(45);
  });

  it("prefers the measured size over the grid seed", () => {
    const d = tileDensity(2, 2, { width: 500, height: 400 });
    expect(d.bodyHeight).toBe(400);
    expect(d.bodyWidth).toBe(500);
  });

  it("derives a coarse level from the measured body height", () => {
    expect(tileDensity(1, 1, { width: 100, height: 80 }).level).toBe("sm");
    expect(tileDensity(1, 1, { width: 100, height: 200 }).level).toBe("md");
    expect(tileDensity(1, 1, { width: 100, height: 400 }).level).toBe("lg");
  });
});

describe("tileBudget (progressive reveal by measured space)", () => {
  it("reveals more fixed blocks as the body grows, hiding the rest", () => {
    const big = tileBudget(tileDensity(1, 1, { width: 200, height: 300 }));
    expect(big.block(40)).toBe(true);
    expect(big.block(40)).toBe(true);
    expect(big.block(40)).toBe(true);

    const small = tileBudget(tileDensity(1, 1, { width: 200, height: 60 }));
    expect(small.block(40)).toBe(true); // first always shown
    expect(small.block(40)).toBe(false); // no room for a second
  });

  it("always reveals the first requested item so the body is never empty", () => {
    // Body smaller than a single block, but the first block is still forced.
    const budget = tileBudget(tileDensity(1, 1, { width: 200, height: 10 }));
    expect(budget.block(40)).toBe(true);
    expect(budget.block(40)).toBe(false);
  });

  it("fits more list rows in a taller tile and fewer in a shorter one", () => {
    const tall = tileBudget(tileDensity(1, 1, { width: 200, height: 400 }));
    const tallRows = tall.list(SECTION_PX, ROW_PX, 20);

    const short = tileBudget(tileDensity(1, 1, { width: 200, height: 120 }));
    const shortRows = short.list(SECTION_PX, ROW_PX, 20);

    expect(tallRows).toBeGreaterThan(shortRows);
    expect(tallRows).toBeLessThanOrEqual(20); // capped by available rows
  });

  it("never exceeds the number of available rows", () => {
    const budget = tileBudget(tileDensity(1, 1, { width: 200, height: 1000 }));
    expect(budget.list(SECTION_PX, ROW_PX, 3)).toBe(3);
  });

  it("guarantees at least one row for the first section even on a tiny tile", () => {
    const budget = tileBudget(tileDensity(1, 1, { width: 200, height: 20 }));
    expect(budget.list(SECTION_PX, ROW_PX, 5)).toBe(1);
  });

  it("hides a later section entirely when nothing fits (no partial header)", () => {
    const budget = tileBudget(tileDensity(1, 1, { width: 200, height: 80 }));
    budget.block(70); // consume most of the room as the first/primary block
    expect(budget.list(SECTION_PX, ROW_PX, 5)).toBe(0);
  });

  it("returns 0 rows for a section with no available data", () => {
    const budget = tileBudget(tileDensity(1, 1, { width: 200, height: 400 }));
    expect(budget.list(SECTION_PX, ROW_PX, 0)).toBe(0);
  });
});

describe("METRIC_CATALOG", () => {
  it("has stable, unique keys per integration", () => {
    for (const defs of Object.values(METRIC_CATALOG)) {
      const keys = defs.map((d) => d.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const def of defs) {
        expect(def.key).toBeTruthy();
        expect(def.label).toBeTruthy();
      }
    }
  });
});
