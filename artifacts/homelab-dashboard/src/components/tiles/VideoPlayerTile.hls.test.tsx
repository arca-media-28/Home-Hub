// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  cleanup,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";

// ---------------------------------------------------------------------------
// Locks in the TV tile's HLS stall recovery and the error-state Retry button:
// - fatal network errors call hls.startLoad() up to 3 times, then error state
// - fatal media errors call hls.recoverMediaError() up to 3 times, then error
// - a buffered fragment (FRAG_BUFFERED) resets both recovery budgets
// - clicking Retry re-creates the hls.js instance tuned to the same channel
// hls.js is loaded dynamically by the component, so the module mock below
// intercepts the `import("hls.js")` inside the attach effect.
// ---------------------------------------------------------------------------

type Handler = (event: string, data: unknown) => void;

const { hlsInstances, MockHls } = vi.hoisted(() => {
  class MockHls {
    static isSupported = () => true;
    static Events = {
      FRAG_BUFFERED: "hlsFragBuffered",
      ERROR: "hlsError",
    } as const;
    static ErrorTypes = {
      NETWORK_ERROR: "networkError",
      MEDIA_ERROR: "mediaError",
      OTHER_ERROR: "otherError",
    } as const;

    handlers = new Map<string, Handler[]>();
    loadedUrl: string | null = null;
    startLoad = vi.fn();
    recoverMediaError = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();

    constructor() {
      hlsInstances.push(this);
    }
    loadSource(url: string) {
      this.loadedUrl = url;
    }
    on(event: string, cb: Handler) {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
    }
    emit(event: string, data?: unknown) {
      for (const cb of this.handlers.get(event) ?? []) cb(event, data);
    }
  }
  const hlsInstances: InstanceType<typeof MockHls>[] = [];
  return { hlsInstances, MockHls };
});

vi.mock("hls.js", () => ({ default: MockHls }));

// The tile pulls generated hooks from the workspace client; stub just what it
// touches. Tile/TileSettings are type-only imports (erased at runtime).
const CHANNEL = {
  number: "1",
  name: "Retro TV",
  streamUrl: "/api/widgets/ersatztv/stream/1.m3u8",
  nowPlaying: null,
  nowPlayingStart: null,
  nowPlayingStop: null,
};

vi.mock("@workspace/api-client-react", () => ({
  useGetVideoPlaylist: () => ({
    data: undefined,
    isError: false,
    isLoading: false,
  }),
  getGetVideoPlaylistQueryKey: (p: unknown) => ["video-playlist", p],
  useGetErsatzChannels: () => ({
    data: { sample: false, channels: [CHANNEL] },
    isError: false,
    isLoading: false,
  }),
  getGetErsatzChannelsQueryKey: () => ["ersatz-channels"],
  useUpdateTile: () => ({ mutate: vi.fn() }),
  getGetTilesQueryKey: () => ["tiles"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
}));

import VideoPlayerTile from "./VideoPlayerTile";
import type { Tile } from "@workspace/api-client-react";

const TILE = {
  id: 42,
  integration: "videoplayer",
  tileSettings: {
    videoSource: "ersatztv",
    videoErsatzChannel: "1",
  },
} as unknown as Tile;

// Renders the tile and waits for the lazy hls.js import inside the attach
// effect to settle, returning the freshly created mock instance.
async function renderTvTile() {
  render(<VideoPlayerTile tile={TILE} editMode={false} />);
  await waitFor(() => expect(hlsInstances.length).toBeGreaterThan(0));
  return hlsInstances[hlsInstances.length - 1]!;
}

function emitFatal(hls: InstanceType<typeof MockHls>, type: string) {
  act(() => {
    hls.emit(MockHls.Events.ERROR, { fatal: true, type });
  });
}

beforeEach(() => {
  localStorage.clear();
  hlsInstances.length = 0;
  // jsdom's media elements don't implement playback; the tile calls
  // el.play().catch(...) so it must return a promise.
  window.HTMLMediaElement.prototype.play = vi
    .fn()
    .mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VideoPlayerTile HLS stall recovery", () => {
  it("attaches hls.js to the tuned channel's stream URL", async () => {
    const hls = await renderTvTile();
    expect(hls.loadedUrl).toContain("/api/widgets/ersatztv/stream/1.m3u8");
    expect(hls.attachMedia).toHaveBeenCalledTimes(1);
  });

  it("retries fatal network errors with startLoad up to 3 times, then errors", async () => {
    const hls = await renderTvTile();

    for (let i = 1; i <= 3; i++) {
      emitFatal(hls, MockHls.ErrorTypes.NETWORK_ERROR);
      expect(hls.startLoad).toHaveBeenCalledTimes(i);
      // Mid-recovery the non-blocking badge shows instead of the error state.
      expect(
        screen.getByTestId("videoplayer-reconnecting-badge"),
      ).toBeTruthy();
      expect(screen.queryByTestId("videoplayer-error")).toBeNull();
    }

    // 4th fatal network error exhausts the budget: explicit error state,
    // no further startLoad, instance destroyed.
    emitFatal(hls, MockHls.ErrorTypes.NETWORK_ERROR);
    expect(hls.startLoad).toHaveBeenCalledTimes(3);
    expect(hls.destroy).toHaveBeenCalled();
    expect(screen.getByTestId("videoplayer-error")).toBeTruthy();
    expect(screen.queryByTestId("videoplayer-reconnecting-badge")).toBeNull();
  });

  it("retries fatal media errors with recoverMediaError up to 3 times, then errors", async () => {
    const hls = await renderTvTile();

    for (let i = 1; i <= 3; i++) {
      emitFatal(hls, MockHls.ErrorTypes.MEDIA_ERROR);
      expect(hls.recoverMediaError).toHaveBeenCalledTimes(i);
      expect(screen.queryByTestId("videoplayer-error")).toBeNull();
    }

    emitFatal(hls, MockHls.ErrorTypes.MEDIA_ERROR);
    expect(hls.recoverMediaError).toHaveBeenCalledTimes(3);
    expect(hls.destroy).toHaveBeenCalled();
    expect(screen.getByTestId("videoplayer-error")).toBeTruthy();
  });

  it("ignores non-fatal errors entirely", async () => {
    const hls = await renderTvTile();
    act(() => {
      hls.emit(MockHls.Events.ERROR, {
        fatal: false,
        type: MockHls.ErrorTypes.NETWORK_ERROR,
      });
    });
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(screen.queryByTestId("videoplayer-reconnecting-badge")).toBeNull();
    expect(screen.queryByTestId("videoplayer-error")).toBeNull();
  });

  it("resets the recovery budget after a buffered fragment", async () => {
    const hls = await renderTvTile();

    // Burn the whole network budget…
    for (let i = 0; i < 3; i++) {
      emitFatal(hls, MockHls.ErrorTypes.NETWORK_ERROR);
    }
    expect(hls.startLoad).toHaveBeenCalledTimes(3);

    // …then playback recovers: a buffered fragment resets the counters and
    // clears the reconnecting badge.
    act(() => {
      hls.emit(MockHls.Events.FRAG_BUFFERED);
    });
    expect(screen.queryByTestId("videoplayer-reconnecting-badge")).toBeNull();

    // A later stall gets a fresh set of retries instead of failing outright.
    emitFatal(hls, MockHls.ErrorTypes.NETWORK_ERROR);
    expect(hls.startLoad).toHaveBeenCalledTimes(4);
    expect(screen.queryByTestId("videoplayer-error")).toBeNull();
  });

  it("Retry button re-creates the hls instance for the same channel URL", async () => {
    const hls = await renderTvTile();

    // Exhaust the media-error budget to reach the error state.
    for (let i = 0; i < 4; i++) {
      emitFatal(hls, MockHls.ErrorTypes.MEDIA_ERROR);
    }
    expect(screen.getByTestId("videoplayer-error")).toBeTruthy();
    const firstUrl = hls.loadedUrl;
    expect(firstUrl).toContain(".m3u8");
    expect(hlsInstances.length).toBe(1);

    // Clicking Retry clears the error state and re-runs the attach effect,
    // creating a brand-new hls.js instance tuned to the same stream.
    fireEvent.click(screen.getByTestId("videoplayer-retry"));
    await waitFor(() => expect(hlsInstances.length).toBe(2));
    const next = hlsInstances[1]!;
    expect(next).not.toBe(hls);
    expect(next.loadedUrl).toBe(firstUrl);
    expect(next.attachMedia).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("videoplayer-error")).toBeNull();

    // The revived instance's recovery budget is fresh.
    emitFatal(next, MockHls.ErrorTypes.NETWORK_ERROR);
    expect(next.startLoad).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("videoplayer-error")).toBeNull();
  });
});
