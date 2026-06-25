// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { Tile } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Regression coverage for: tiles collapsing to the top-left on a hard refresh.
//
// The grid used to render with a hard-coded guess for its column count before
// the container's real width was measured. A tile saved at a large gridX (e.g.
// 18) then exceeded the guessed column count, so the grid clamped/compacted it
// back toward x=0 on the first paint. The fix gates the grid render on a
// measured width and derives the column count from that width, so the very
// first paint already uses enough columns to honor every saved position.
//
// These tests render the real Dashboard and capture exactly what it hands the
// grid: they assert the grid is never rendered before the width is measured,
// that a wide viewport yields enough columns to fit a far-right tile at its
// saved x, and that a narrow viewport reflows the column count without ever
// mutating (or persisting) the saved positions. Asserting the grid's inputs —
// rather than react-grid-layout's pixel output — keeps the test faithful to the
// Dashboard's own responsibility and stable across grid-library versions.
// ---------------------------------------------------------------------------

const saveLayoutMutate = vi.fn();

// Mutable container width returned by the mocked clientWidth getter. Each test
// sets this to a wide / narrow / unmeasured (0) value before rendering.
let mockClientWidth = 0;

// Tiles the mocked useGetTiles hook returns. Set per test.
let mockTiles: Tile[] = [];

// Latest props the Dashboard passed to the (mocked) grid, or null if the grid
// was never rendered (i.e. the width gate kept it off).
type GridLayoutItem = { i: string; x: number; y: number; w: number; h: number };
type CapturedGridProps = {
  cols: number;
  width: number;
  layout: GridLayoutItem[];
};
let capturedGridProps: CapturedGridProps | null = null;

vi.mock("react-grid-layout", () => ({
  // react-grid-layout v2 takes the column count via `gridConfig.cols` (the
  // top-level `cols` prop is ignored in that version), so read it from there —
  // falling back to a top-level `cols` keeps the test robust across versions.
  default: (props: {
    cols?: number;
    gridConfig?: { cols?: number };
    width: number;
    layout: GridLayoutItem[];
    children?: React.ReactNode;
  }) => {
    const cols = props.gridConfig?.cols ?? props.cols ?? 0;
    capturedGridProps = { cols, width: props.width, layout: props.layout };
    return <div data-testid="grid">{props.children}</div>;
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  // The dashboard (via integrationMeta) reads TileIntegration values at module
  // load, so the mock must expose the enum. Values equal their keys.
  TileIntegration: {
    truenas: "truenas",
    media: "media",
    jellyfin: "jellyfin",
    sonarr: "sonarr",
    radarr: "radarr",
    lidarr: "lidarr",
    qbittorrent: "qbittorrent",
    pihole: "pihole",
    "nginx-proxy-manager": "nginx-proxy-manager",
    prowlarr: "prowlarr",
    tailscale: "tailscale",
    ersatztv: "ersatztv",
    audioplayer: "audioplayer",
    clock: "clock",
    timer: "timer",
    weather: "weather",
    sports: "sports",
    news: "news",
    stocks: "stocks",
    sleeper: "sleeper",
    note: "note",
    spacer: "spacer",
    divider: "divider",
    eightball: "eightball",
    dice: "dice",
    coinflip: "coinflip",
    fortune: "fortune",
    tamagotchi: "tamagotchi",
    bonsai: "bonsai",
  },
  TileType: { app: "app", integration: "integration" },
  useGetMe: () => ({ data: { id: 1, username: "tester" }, isError: false }),
  useGetTiles: () => ({ data: mockTiles, isLoading: false }),
  useGetConnectionsStatus: () => ({ data: [] }),
  useGetPages: () => ({ data: [] }),
  useCreatePage: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useUpdatePage: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useDeletePage: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useReorderPages: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useImportPages: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  exportPage: vi.fn(),
  exportAllPages: vi.fn(),
  useSaveLayout: () => ({
    mutate: saveLayoutMutate,
    isPending: false,
    isError: false,
  }),
  useCreateTile: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  getGetMeQueryKey: () => ["/api/me"],
  getGetTilesQueryKey: () => ["/api/tiles"],
  getGetPagesQueryKey: () => ["/api/pages"],
  getGetConnectionsStatusQueryKey: () => ["/api/connections/status"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
    removeQueries: vi.fn(),
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-health-alerts", () => ({
  useHealthAlerts: () => undefined,
}));

// Stub the tile content + edit modal so the test stays focused on grid
// positioning and avoids pulling in their data-fetching dependencies.
vi.mock("@/components/tiles/AppTile", () => ({
  default: ({ tile }: { tile: Tile }) => (
    <div data-testid={`apptile-${tile.id}`}>{tile.name}</div>
  ),
}));
vi.mock("@/components/tiles/IntegrationTile", () => ({
  default: ({ tile }: { tile: Tile }) => (
    <div data-testid={`integrationtile-${tile.id}`}>{tile.name}</div>
  ),
}));
vi.mock("@/components/TileEditModal", () => ({
  default: () => null,
}));

import Dashboard from "./dashboard";

function makeTile(overrides: Partial<Tile>): Tile {
  return {
    id: 1,
    userId: 1,
    type: "app",
    gridX: 0,
    gridY: 0,
    gridW: 4,
    gridH: 4,
    name: "Tile",
    ...overrides,
  } as Tile;
}

function layoutItem(id: number): GridLayoutItem {
  const item = capturedGridProps?.layout.find((l) => l.i === String(id));
  expect(item, `no layout entry for tile ${id}`).toBeTruthy();
  return item!;
}

let widthSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  saveLayoutMutate.mockClear();
  capturedGridProps = null;
  mockTiles = [];
  mockClientWidth = 0;

  // jsdom never lays out, so clientWidth is always 0. Make it report our
  // simulated container width so the Dashboard's useLayoutEffect measurement
  // produces a real value (mirroring a wide / narrow browser window).
  widthSpy = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockImplementation(() => mockClientWidth);

  // The measurement effect observes the container with a ResizeObserver.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  widthSpy?.mockRestore();
  vi.unstubAllGlobals();
});

describe("Dashboard saved-position rendering", () => {
  it("does not render the grid until the container width is measured", () => {
    // Width unmeasured (0) -> gridWidth stays null -> the grid is gated off, so
    // no tile is ever positioned against a guessed (too-small) column count.
    mockClientWidth = 0;
    mockTiles = [makeTile({ id: 1, gridX: 18, gridW: 4 })];

    render(<Dashboard />);

    expect(screen.queryByTestId("grid")).toBeNull();
    expect(capturedGridProps).toBeNull();
  });

  it("gives the grid enough columns to honor a far-right tile on a wide viewport", () => {
    // ~1536px is wide enough for ~25 columns. The grid must receive that real
    // width and a column count large enough to fit a tile at gridX=18 (+gridW),
    // and the tile's saved x must be handed through unchanged (not collapsed).
    mockClientWidth = 1536;
    mockTiles = [makeTile({ id: 1, gridX: 18, gridY: 0, gridW: 4, gridH: 4 })];

    render(<Dashboard />);

    expect(screen.getByTestId("grid")).toBeTruthy();
    expect(capturedGridProps).not.toBeNull();
    expect(capturedGridProps!.width).toBe(1536);

    // Enough columns that gridX(18) + gridW(4) fits -> no clamp toward x=0.
    expect(capturedGridProps!.cols).toBeGreaterThanOrEqual(22);

    // The saved horizontal position survives to the grid untouched.
    expect(layoutItem(1).x).toBe(18);

    // The saved layout appears with no Settings/layout round-trip.
    expect(saveLayoutMutate).not.toHaveBeenCalled();
  });

  it("passes every saved tile position through unchanged on a wide viewport", () => {
    mockClientWidth = 1536;
    mockTiles = [
      makeTile({ id: 1, gridX: 0, gridY: 0, gridW: 4, gridH: 4 }),
      makeTile({ id: 2, gridX: 10, gridY: 0, gridW: 4, gridH: 4 }),
      makeTile({ id: 3, gridX: 18, gridY: 0, gridW: 4, gridH: 4 }),
    ];

    render(<Dashboard />);

    expect(capturedGridProps).not.toBeNull();
    // Saved horizontal positions are preserved and ordered left-to-right.
    expect(layoutItem(1).x).toBe(0);
    expect(layoutItem(2).x).toBe(10);
    expect(layoutItem(3).x).toBe(18);
    expect(saveLayoutMutate).not.toHaveBeenCalled();
  });

  it("reflows the column count on a narrow viewport without losing saved positions", () => {
    // A narrow viewport falls back to the minimum column count. The grid's
    // column count shrinks, but the saved gridX=18 must remain intact in the
    // data (so it returns to its spot when the window is wide again) and the
    // reflow must NOT be persisted back to the server.
    mockClientWidth = 480;
    mockTiles = [makeTile({ id: 1, gridX: 18, gridY: 0, gridW: 4, gridH: 4 })];

    render(<Dashboard />);

    expect(capturedGridProps).not.toBeNull();
    // Fewer columns on a narrow screen than the ~25 a wide screen exposes.
    expect(capturedGridProps!.cols).toBeLessThan(22);

    // The saved position is untouched in the data handed to the grid...
    expect(layoutItem(1).x).toBe(18);
    // ...the tile is still rendered (not dropped)...
    expect(screen.getByTestId("apptile-1")).toBeTruthy();
    // ...and the reflow never triggers a layout save.
    expect(saveLayoutMutate).not.toHaveBeenCalled();
  });
});
