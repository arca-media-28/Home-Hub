import { describe, it, expect } from "vitest";
import { TileIntegration } from "@workspace/api-client-react";
import {
  allMetricKeys,
  resolveEnabledMetrics,
  tileDensity,
  METRIC_CATALOG,
} from "./metrics";

describe("allMetricKeys", () => {
  it("returns every catalog key for a known integration", () => {
    expect(allMetricKeys(TileIntegration.truenas)).toEqual(["cpu", "ram", "pools"]);
    expect(allMetricKeys(TileIntegration.sonarr)).toEqual(["queue", "upcoming"]);
    expect(allMetricKeys(TileIntegration.qbittorrent)).toEqual(["speeds", "torrents"]);
    expect(allMetricKeys(TileIntegration.media)).toEqual(["recent"]);
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
    expect([...enabled].sort()).toEqual(["cpu", "pools", "ram"]);
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

describe("tileDensity (small vs large branches)", () => {
  it("is compact (sm) for short tiles and not expanded", () => {
    const d = tileDensity(2, 2);
    expect(d.level).toBe("sm");
    expect(d.expanded).toBe(false);
    expect(d.listLimit).toBe(2);
  });

  it("is medium (md) for mid-height tiles and expanded", () => {
    const d = tileDensity(2, 3);
    expect(d.level).toBe("md");
    expect(d.expanded).toBe(true);
    expect(d.listLimit).toBe(5);
  });

  it("is large (lg) for tall tiles with the most list rows", () => {
    const d = tileDensity(2, 5);
    expect(d.level).toBe("lg");
    expect(d.expanded).toBe(true);
    expect(d.listLimit).toBe(8);
  });

  it("grants extra list rows to wide tiles", () => {
    expect(tileDensity(4, 2).listLimit).toBe(4);
    expect(tileDensity(4, 3).listLimit).toBe(7);
    expect(tileDensity(4, 5).listLimit).toBe(10);
  });

  it("scales list rows monotonically as the tile grows taller", () => {
    const sm = tileDensity(2, 2).listLimit;
    const md = tileDensity(2, 3).listLimit;
    const lg = tileDensity(2, 5).listLimit;
    expect(sm).toBeLessThan(md);
    expect(md).toBeLessThan(lg);
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
