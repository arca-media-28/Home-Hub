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
// - fatal network errors call hls.startLoad() up to 3 times per instance
// - fatal media errors call hls.recoverMediaError() up to 3 times
// - exhausting an instance's budget destroys it and auto-reattaches a fresh
//   instance after a pause (up to 3 times) before showing the error state
// - a buffered fragment (FRAG_BUFFERED) resets every budget
// - clicking Retry re-creates the hls.js instance tuned to the same channel
// - Stop tears the stream down completely; Resume re-attaches
// - hiding the tab mutes the player (videoPageSwitchMute default)
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

const { channelsRef, invalidateQueries } = vi.hoisted(() => ({
  // Mutable ref so individual tests can swap in a channel with guide bounds.
  channelsRef: { current: [] as unknown[] },
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetVideoPlaylist: () => ({
    data: undefined,
    isError: false,
    isLoading: false,
  }),
  getGetVideoPlaylistQueryKey: (p: unknown) => ["video-playlist", p],
  useGetErsatzChannels: () => ({
    data: { sample: false, channels: channelsRef.current },
    isError: false,
    isLoading: false,
  }),
  getGetErsatzChannelsQueryKey: () => ["ersatz-channels"],
  useUpdateTile: () => ({ mutate: vi.fn() }),
  getGetTilesQueryKey: () => ["tiles"],
}));

// A single stable client object (like the real QueryClientProvider) so
// effects keyed on `queryClient` don't re-run every render.
const mockQueryClient = {
  setQueryData: vi.fn(),
  invalidateQueries,
};
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mockQueryClient,
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
  channelsRef.current = [CHANNEL];
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
      // Mid-recovery: no fragment ever buffered yet, so the tune-in banner
      // shows instead of the error state (the badge is hidden behind it).
      expect(screen.getByTestId("videoplayer-tuning-banner")).toBeTruthy();
      expect(screen.queryByTestId("videoplayer-error")).toBeNull();
    }

    // 4th fatal network error exhausts this instance's budget: the instance
    // is destroyed, but instead of an error state the tile keeps showing the
    // tuning banner while it waits to auto-reattach a fresh instance.
    emitFatal(hls, MockHls.ErrorTypes.NETWORK_ERROR);
    expect(hls.startLoad).toHaveBeenCalledTimes(3);
    expect(hls.destroy).toHaveBeenCalled();
    expect(screen.queryByTestId("videoplayer-error")).toBeNull();
    expect(screen.getByTestId("videoplayer-tuning-banner")).toBeTruthy();
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
    // Budget exhaustion no longer errors immediately — auto-reattach kicks in
    // (still tuning, so the banner is the visible hint).
    expect(screen.queryByTestId("videoplayer-error")).toBeNull();
    expect(screen.getByTestId("videoplayer-tuning-banner")).toBeTruthy();
  });

  it("auto-reattaches a fresh instance after budget exhaustion, erroring only after 3 auto retries", async () => {
    vi.useFakeTimers();
    try {
      render(<VideoPlayerTile tile={TILE} editMode={false} />);
      await act(async () => {});
      expect(hlsInstances.length).toBe(1);

      // Buffer a fragment first so the tune-in grace window is over and the
      // normal mid-playback auto-reattach budget applies.
      act(() => {
        hlsInstances[0]!.emit(MockHls.Events.FRAG_BUFFERED);
      });
      // Let the post-tune banner linger window elapse so the reconnecting
      // badge (suppressed while the banner is up) is visible below.
      await act(async () => {
        vi.advanceTimersByTime(4_100);
      });

      // Exhaust instance budgets back-to-back. After each exhaustion the
      // tile waits ~4s then attaches a brand-new instance — 3 times.
      for (let attempt = 0; attempt < 3; attempt++) {
        const hls = hlsInstances[hlsInstances.length - 1]!;
        for (let i = 0; i < 4; i++) {
          emitFatal(hls, MockHls.ErrorTypes.NETWORK_ERROR);
        }
        expect(screen.queryByTestId("videoplayer-error")).toBeNull();
        expect(
          screen.getByTestId("videoplayer-reconnecting-badge"),
        ).toBeTruthy();
        await act(async () => {
          vi.advanceTimersByTime(4_000);
        });
        await act(async () => {});
        expect(hlsInstances.length).toBe(attempt + 2);
      }

      // The 4th instance exhausting its budget finally surfaces the error.
      const last = hlsInstances[hlsInstances.length - 1]!;
      for (let i = 0; i < 4; i++) {
        emitFatal(last, MockHls.ErrorTypes.NETWORK_ERROR);
      }
      expect(screen.getByTestId("videoplayer-error")).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(hlsInstances.length).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a buffered fragment resets the auto-reattach budget too", async () => {
    vi.useFakeTimers();
    try {
      render(<VideoPlayerTile tile={TILE} editMode={false} />);
      await act(async () => {});

      // Burn one auto-reattach…
      const first = hlsInstances[0]!;
      for (let i = 0; i < 4; i++) {
        emitFatal(first, MockHls.ErrorTypes.NETWORK_ERROR);
      }
      await act(async () => {
        vi.advanceTimersByTime(4_000);
      });
      await act(async () => {});
      const second = hlsInstances[1]!;

      // …then healthy playback resets the counter, so a later meltdown gets
      // the full 3 auto retries again instead of erroring early.
      act(() => {
        second.emit(MockHls.Events.FRAG_BUFFERED);
      });
      for (let attempt = 0; attempt < 3; attempt++) {
        const hls = hlsInstances[hlsInstances.length - 1]!;
        for (let i = 0; i < 4; i++) {
          emitFatal(hls, MockHls.ErrorTypes.NETWORK_ERROR);
        }
        expect(screen.queryByTestId("videoplayer-error")).toBeNull();
        await act(async () => {
          vi.advanceTimersByTime(4_000);
        });
        await act(async () => {});
      }
      expect(hlsInstances.length).toBe(5);
    } finally {
      vi.useRealTimers();
    }
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
    vi.useFakeTimers();
    try {
      render(<VideoPlayerTile tile={TILE} editMode={false} />);
      await act(async () => {});

      // End the tune-in grace window (buffered fragment), then exhaust the
      // initial instance plus all 3 auto-reattaches to reach the real error
      // state.
      act(() => {
        hlsInstances[0]!.emit(MockHls.Events.FRAG_BUFFERED);
      });
      for (let attempt = 0; attempt < 4; attempt++) {
        const hls = hlsInstances[hlsInstances.length - 1]!;
        for (let i = 0; i < 4; i++) {
          emitFatal(hls, MockHls.ErrorTypes.MEDIA_ERROR);
        }
        await act(async () => {
          vi.advanceTimersByTime(4_000);
        });
        await act(async () => {});
      }
      expect(screen.getByTestId("videoplayer-error")).toBeTruthy();
      const firstUrl = hlsInstances[0]!.loadedUrl;
      expect(firstUrl).toContain(".m3u8");
      expect(hlsInstances.length).toBe(4);

      // Clicking Retry clears the error state and re-runs the attach effect,
      // creating a brand-new hls.js instance tuned to the same stream.
      fireEvent.click(screen.getByTestId("videoplayer-retry"));
      await act(async () => {});
      expect(hlsInstances.length).toBe(5);
      const next = hlsInstances[4]!;
      expect(next.loadedUrl).toBe(firstUrl);
      expect(next.attachMedia).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("videoplayer-error")).toBeNull();

      // The revived instance's recovery budget is fresh.
      emitFatal(next, MockHls.ErrorTypes.NETWORK_ERROR);
      expect(next.startLoad).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("videoplayer-error")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("VideoPlayerTile tuning banner", () => {
  it("shows channel number, name, and programme while tuning, then lingers a few seconds after a fragment buffers before fading out", async () => {
    channelsRef.current = [
      { ...CHANNEL, nowPlaying: "The Twilight Zone" },
    ];
    const hls = await renderTvTile();
    vi.useFakeTimers();
    try {
      // Before the first buffered fragment the banner identifies the channel.
      const banner = screen.getByTestId("videoplayer-tuning-banner");
      expect(banner.textContent).toContain("1");
      expect(banner.textContent).toContain("Retro TV");
      expect(banner.textContent).toContain("The Twilight Zone");
      expect(banner.textContent).toContain("Tuning");

      // Video starts flowing — like a real TV, the banner lingers so the
      // viewer can confirm the channel; the "Tuning…" spinner is gone.
      act(() => {
        hls.emit(MockHls.Events.FRAG_BUFFERED);
      });
      const lingering = screen.getByTestId("videoplayer-tuning-banner");
      expect(lingering.textContent).toContain("Retro TV");
      expect(lingering.textContent).not.toContain("Tuning");

      // Near the end of the linger window it starts fading out…
      await act(async () => {
        vi.advanceTimersByTime(3_500);
      });
      expect(
        screen.getByTestId("videoplayer-tuning-banner").className,
      ).toContain("opacity-0");

      // …and after the full window it is gone.
      await act(async () => {
        vi.advanceTimersByTime(600);
      });
      expect(screen.queryByTestId("videoplayer-tuning-banner")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lingers then clears the banner when playback starts via the video element (native HLS path)", async () => {
    await renderTvTile();
    vi.useFakeTimers();
    try {
      expect(screen.getByTestId("videoplayer-tuning-banner")).toBeTruthy();
      act(() => {
        document.querySelector("video")!.dispatchEvent(new Event("playing"));
      });
      // Still visible right after playback starts (linger)…
      expect(screen.getByTestId("videoplayer-tuning-banner")).toBeTruthy();
      // …gone after the linger window elapses.
      await act(async () => {
        vi.advanceTimersByTime(4_100);
      });
      expect(screen.queryByTestId("videoplayer-tuning-banner")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides a lingering banner immediately when the stream is stopped", async () => {
    const hls = await renderTvTile();
    vi.useFakeTimers();
    try {
      act(() => {
        hls.emit(MockHls.Events.FRAG_BUFFERED);
      });
      expect(screen.getByTestId("videoplayer-tuning-banner")).toBeTruthy();
      fireEvent.click(screen.getByTestId("videoplayer-stop"));
      expect(screen.queryByTestId("videoplayer-tuning-banner")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("VideoPlayerTile tuning banner up-next line", () => {
  it("shows the next programme and its start time when the guide has it", async () => {
    channelsRef.current = [
      {
        ...CHANNEL,
        nowPlaying: "The Maltese Falcon",
        upNextTitle: "Casablanca",
        upNextStart: new Date(Date.now() + 45 * 60_000).toISOString(),
      },
    ];
    await renderTvTile();
    const upNext = screen.getByTestId("videoplayer-banner-upnext");
    expect(upNext.textContent).toContain("Up next: Casablanca");
    // A formatted clock time follows the title (e.g. "· 3:45 PM").
    expect(upNext.textContent).toContain("·");
  });

  it("omits the up-next line when the guide has no upcoming data", async () => {
    channelsRef.current = [{ ...CHANNEL, nowPlaying: "News Loop" }];
    await renderTvTile();
    expect(screen.getByTestId("videoplayer-tuning-banner")).toBeTruthy();
    expect(screen.queryByTestId("videoplayer-banner-upnext")).toBeNull();
  });
});

describe("VideoPlayerTile tune-in grace window", () => {
  it("keeps retrying quietly during tune-in instead of showing the error screen", async () => {
    vi.useFakeTimers();
    try {
      render(<VideoPlayerTile tile={TILE} editMode={false} />);
      await act(async () => {});
      expect(hlsInstances.length).toBe(1);

      // No fragment ever buffered — the channel is still tuning. Exhaust the
      // in-instance budget 6 times in a row (double the normal 3-reattach
      // budget); within the grace window the tile never shows the error
      // screen, just the tuning banner, and keeps re-attaching.
      for (let attempt = 0; attempt < 6; attempt++) {
        const hls = hlsInstances[hlsInstances.length - 1]!;
        for (let i = 0; i < 4; i++) {
          emitFatal(hls, MockHls.ErrorTypes.NETWORK_ERROR);
        }
        expect(screen.queryByTestId("videoplayer-error")).toBeNull();
        expect(
          screen.getByTestId("videoplayer-tuning-banner").textContent,
        ).toContain("Tuning");
        await act(async () => {
          vi.advanceTimersByTime(2_000);
        });
        await act(async () => {});
        expect(hlsInstances.length).toBe(attempt + 2);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces the error screen once the grace window and retry budget are exhausted", async () => {
    vi.useFakeTimers();
    try {
      render(<VideoPlayerTile tile={TILE} editMode={false} />);
      await act(async () => {});

      // Burn one tune-in retry, then let the whole grace window elapse
      // without the channel ever buffering a fragment.
      const first = hlsInstances[0]!;
      for (let i = 0; i < 4; i++) {
        emitFatal(first, MockHls.ErrorTypes.NETWORK_ERROR);
      }
      await act(async () => {
        vi.advanceTimersByTime(46_000);
      });
      await act(async () => {});
      expect(hlsInstances.length).toBe(2);
      expect(screen.queryByTestId("videoplayer-error")).toBeNull();

      // Past the grace window the normal auto-reattach budget applies: 3
      // more full exhaustions re-attach, the 4th finally errors.
      for (let attempt = 0; attempt < 3; attempt++) {
        const hls = hlsInstances[hlsInstances.length - 1]!;
        for (let i = 0; i < 4; i++) {
          emitFatal(hls, MockHls.ErrorTypes.NETWORK_ERROR);
        }
        expect(screen.queryByTestId("videoplayer-error")).toBeNull();
        await act(async () => {
          vi.advanceTimersByTime(4_000);
        });
        await act(async () => {});
      }
      const last = hlsInstances[hlsInstances.length - 1]!;
      for (let i = 0; i < 4; i++) {
        emitFatal(last, MockHls.ErrorTypes.NETWORK_ERROR);
      }
      expect(screen.getByTestId("videoplayer-error")).toBeTruthy();
      expect(screen.getByTestId("videoplayer-retry")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the error state immediately when tuning to a different channel", async () => {
    vi.useFakeTimers();
    try {
      const CHANNEL2 = {
        ...CHANNEL,
        number: "2",
        name: "Movie TV",
        streamUrl: "/api/widgets/ersatztv/stream/2.m3u8",
      };
      channelsRef.current = [CHANNEL, CHANNEL2];
      const { rerender } = render(
        <VideoPlayerTile tile={TILE} editMode={false} />,
      );
      await act(async () => {});

      // Drive channel 1 all the way to the genuine error state.
      act(() => {
        hlsInstances[0]!.emit(MockHls.Events.FRAG_BUFFERED);
      });
      for (let attempt = 0; attempt < 4; attempt++) {
        const hls = hlsInstances[hlsInstances.length - 1]!;
        for (let i = 0; i < 4; i++) {
          emitFatal(hls, MockHls.ErrorTypes.NETWORK_ERROR);
        }
        await act(async () => {
          vi.advanceTimersByTime(4_000);
        });
        await act(async () => {});
      }
      expect(screen.getByTestId("videoplayer-error")).toBeTruthy();
      const countBefore = hlsInstances.length;

      // Tune to channel 2: the stale error clears immediately and a fresh
      // hls instance attaches to the new channel's stream.
      rerender(
        <VideoPlayerTile
          tile={
            {
              ...TILE,
              tileSettings: {
                ...(TILE.tileSettings as object),
                videoErsatzChannel: "2",
              },
            } as unknown as Tile
          }
          editMode={false}
        />,
      );
      await act(async () => {});
      expect(screen.queryByTestId("videoplayer-error")).toBeNull();
      expect(hlsInstances.length).toBeGreaterThan(countBefore);
      expect(hlsInstances[hlsInstances.length - 1]!.loadedUrl).toContain(
        "/api/widgets/ersatztv/stream/2.m3u8",
      );

      // The new channel gets a full tune-in grace window of its own: a fatal
      // error right away shows the tuning banner (with the new channel's
      // identity), not the error screen.
      const fresh = hlsInstances[hlsInstances.length - 1]!;
      for (let i = 0; i < 4; i++) {
        emitFatal(fresh, MockHls.ErrorTypes.NETWORK_ERROR);
      }
      expect(screen.queryByTestId("videoplayer-error")).toBeNull();
      const banner = screen.getByTestId("videoplayer-tuning-banner");
      expect(banner.textContent).toContain("Tuning");
      expect(banner.textContent).toContain("Movie TV");
      expect(banner.textContent).toContain("2");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("VideoPlayerTile stop / resume", () => {
  it("Stop tears the stream down and Resume re-attaches it", async () => {
    const hls = await renderTvTile();
    expect(document.querySelector("video")).toBeTruthy();

    // Stop: hls destroyed, video element removed, stopped overlay shown.
    fireEvent.click(screen.getByTestId("videoplayer-stop"));
    expect(hls.destroy).toHaveBeenCalled();
    expect(document.querySelector("video")).toBeNull();
    expect(screen.getByTestId("videoplayer-stopped")).toBeTruthy();
    expect(screen.queryByTestId("videoplayer-error")).toBeNull();

    // Resume: a fresh hls instance attaches to the same channel.
    fireEvent.click(screen.getByTestId("videoplayer-resume"));
    await waitFor(() => expect(hlsInstances.length).toBe(2));
    expect(hlsInstances[1]!.loadedUrl).toBe(hls.loadedUrl);
    expect(screen.queryByTestId("videoplayer-stopped")).toBeNull();
  });
});

describe("VideoPlayerTile page-switch mute", () => {
  function setHidden(hidden: boolean) {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  afterEach(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
  });

  it("mutes when the tab hides (default on)", async () => {
    await renderTvTile();
    // Unmute via the control-bar button first.
    fireEvent.click(screen.getByTestId("videoplayer-mute"));
    expect(document.querySelector("video")!.muted).toBe(false);

    setHidden(true);
    expect(document.querySelector("video")!.muted).toBe(true);
  });

  it("does not mute on tab hide when videoPageSwitchMute is false", async () => {
    render(
      <VideoPlayerTile
        tile={
          {
            ...TILE,
            tileSettings: {
              ...(TILE.tileSettings as object),
              videoPageSwitchMute: false,
            },
          } as unknown as Tile
        }
        editMode={false}
      />,
    );
    await waitFor(() => expect(hlsInstances.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("videoplayer-mute"));
    expect(document.querySelector("video")!.muted).toBe(false);

    setHidden(true);
    expect(document.querySelector("video")!.muted).toBe(false);
  });
});

describe("VideoPlayerTile audio-only detection", () => {
  function setMediaState(
    el: HTMLVideoElement,
    state: { videoWidth: number; paused: boolean; currentTime: number },
  ) {
    Object.defineProperty(el, "videoWidth", {
      configurable: true,
      get: () => state.videoWidth,
    });
    Object.defineProperty(el, "paused", {
      configurable: true,
      get: () => state.paused,
    });
    Object.defineProperty(el, "currentTime", {
      configurable: true,
      get: () => state.currentTime,
      set: () => {},
    });
  }

  it("shows the audio-only badge when playback runs with no video track, and clears it when video appears", async () => {
    await renderTvTile();
    const video = document.querySelector("video")!;
    expect(video).toBeTruthy();

    // Stream is playing (audio flowing) but the video track never decoded.
    const state = { videoWidth: 0, paused: false, currentTime: 10 };
    setMediaState(video, state);
    act(() => {
      video.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByTestId("videoplayer-audioonly-badge")).toBeTruthy();
    // It is a hint, not an error state.
    expect(screen.queryByTestId("videoplayer-error")).toBeNull();

    // The video track appears (element fires resize): badge clears.
    state.videoWidth = 640;
    act(() => {
      video.dispatchEvent(new Event("resize"));
    });
    expect(screen.queryByTestId("videoplayer-audioonly-badge")).toBeNull();
  });

  it("does not flag audio-only before playback has really started", async () => {
    await renderTvTile();
    const video = document.querySelector("video")!;
    setMediaState(video, { videoWidth: 0, paused: false, currentTime: 1 });
    act(() => {
      video.dispatchEvent(new Event("resize"));
    });
    expect(screen.queryByTestId("videoplayer-audioonly-badge")).toBeNull();
  });
});

describe("VideoPlayerTile guide refresh at programme end", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("invalidates the channel lineup when the tuned programme's stop time passes", async () => {
    // Fake timers must be on BEFORE render so the effect's setTimeout is
    // captured; the lazy hls.js import is flushed via act (microtasks).
    vi.useFakeTimers();
    const start = new Date();
    const stop = new Date(start.getTime() + 5 * 60_000);
    channelsRef.current = [
      {
        ...CHANNEL,
        nowPlaying: "Old Show",
        nowPlayingStart: start.toISOString(),
        nowPlayingStop: stop.toISOString(),
      },
    ];

    render(<VideoPlayerTile tile={TILE} editMode={false} />);
    await act(async () => {});
    expect(hlsInstances.length).toBeGreaterThan(0);
    invalidateQueries.mockClear();

    // Just before stop (+2s grace): no refetch yet.
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ["ersatz-channels"],
    });

    // Past the stop + grace: exactly one invalidation of the lineup query.
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["ersatz-channels"],
    });
    const lineupCalls = invalidateQueries.mock.calls.filter(
      (c) => c[0]?.queryKey?.[0] === "ersatz-channels",
    ).length;
    expect(lineupCalls).toBe(1);

    // No tight loop: a long time passing with the same stale window does not
    // fire again (the effect re-arms only when the stop time changes).
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(
      invalidateQueries.mock.calls.filter(
        (c) => c[0]?.queryKey?.[0] === "ersatz-channels",
      ).length,
    ).toBe(1);
  });

  it("does not schedule a guide refresh when the channel has no guide window", async () => {
    await renderTvTile();
    invalidateQueries.mockClear();
    vi.useFakeTimers();
    act(() => {
      vi.advanceTimersByTime(60 * 60_000);
    });
    expect(
      invalidateQueries.mock.calls.filter(
        (c) => c[0]?.queryKey?.[0] === "ersatz-channels",
      ).length,
    ).toBe(0);
  });
});
