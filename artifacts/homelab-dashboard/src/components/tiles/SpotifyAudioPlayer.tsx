import { useCallback, useEffect, useRef, useState } from "react";
import {
  useGetAudioPlayerNowPlaying,
  getGetAudioPlayerNowPlayingQueryKey,
  useSendSpotifyCommand,
  getSpotifyToken,
  type AudioTrack,
  type SpotifyCommandInputAction,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Music, Play, Pause, SkipBack, SkipForward, Radio, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "wouter";
import type { WidgetProps } from "./IntegrationTile";
import { useAudioPlayer } from "@/lib/audioPlayer";
import { useToast } from "@/hooks/use-toast";
import { tileBudget, SECTION_PX, MEDIA_ROW_PX } from "./metrics";
import { Artwork, fmtTime } from "./audioShared";

// ── Spotify Web Playback SDK loader + hook ───────────────────────────────────
// Spotify never gives a direct stream URL, so playback is either remote (control
// an external device) or, for Premium accounts, in-browser via the Web Playback
// SDK. The SDK is a global script that registers a player and exposes a device id
// we can hand playback to via the backend "transfer" command.

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";

// Minimal typings for the bits of the SDK we touch.
interface SpotifyPlayer {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, cb: (payload: unknown) => void) => boolean;
  // Browsers block audio until a user gesture; the SDK exposes this to satisfy
  // the autoplay policy. Must be called from within a click handler.
  activateElement?: () => Promise<void>;
}
interface SpotifyNamespace {
  Player: new (opts: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }) => SpotifyPlayer;
}
declare global {
  interface Window {
    Spotify?: SpotifyNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let sdkLoadPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Spotify) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    // The SDK invokes this global once it has finished initialising.
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const existing = document.querySelector(`script[src="${SDK_SRC}"]`);
    if (!existing) {
      const script = document.createElement("script");
      script.src = SDK_SRC;
      script.async = true;
      script.onerror = () => reject(new Error("Failed to load Spotify SDK"));
      document.body.appendChild(script);
    }
  });
  return sdkLoadPromise;
}

interface SdkState {
  ready: boolean;
  deviceId: string | null;
  // Whether the SDK device currently holds playback, and if it's playing.
  isActive: boolean;
  isPlaying: boolean;
  error: string | null;
}

// Boot the Web Playback SDK and surface its device id + live state. Only runs
// when `enabled` (Premium account); a no-op otherwise so non-Premium users never
// pay the script cost.
function useSpotifyPlayback(enabled: boolean): SdkState & {
  activate: () => Promise<void>;
} {
  const [state, setState] = useState<SdkState>({
    ready: false,
    deviceId: null,
    isActive: false,
    isPlaying: false,
    error: null,
  });
  const playerRef = useRef<SpotifyPlayer | null>(null);

  // Called from a click handler so the browser lets the SDK device emit audio.
  // Without this, transferring playback to the in-browser device silently fails
  // (Spotify reports the device as not found / not playable).
  const activate = useCallback(async () => {
    try {
      await playerRef.current?.activateElement?.();
    } catch {
      /* not fatal — transfer may still work on permissive browsers */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let player: SpotifyPlayer | null = null;

    loadSdk()
      .then(() => {
        if (cancelled || !window.Spotify) return;
        player = new window.Spotify.Player({
          name: "Homelab Dashboard",
          getOAuthToken: (cb) => {
            // Mint a fresh token on demand; the backend refreshes as needed.
            getSpotifyToken()
              .then((t) => {
                if (t.accessToken) cb(t.accessToken);
              })
              .catch(() => {
                /* token fetch failed — SDK will surface an auth error */
              });
          },
          volume: 0.8,
        });
        playerRef.current = player;

        player.addListener("ready", (payload) => {
          const deviceId = (payload as { device_id?: string }).device_id ?? null;
          if (!cancelled) setState((s) => ({ ...s, ready: true, deviceId }));
        });
        player.addListener("not_ready", () => {
          if (!cancelled) setState((s) => ({ ...s, ready: false }));
        });
        player.addListener("player_state_changed", (payload) => {
          if (cancelled) return;
          if (!payload) {
            setState((s) => ({ ...s, isActive: false, isPlaying: false }));
            return;
          }
          const st = payload as { paused?: boolean };
          setState((s) => ({ ...s, isActive: true, isPlaying: !st.paused }));
        });
        const onError = (payload: unknown) => {
          const message = (payload as { message?: string }).message ?? "Spotify player error";
          if (!cancelled) setState((s) => ({ ...s, error: message }));
        };
        player.addListener("initialization_error", onError);
        player.addListener("authentication_error", onError);
        player.addListener("account_error", onError);
        void player.connect();
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState((s) => ({ ...s, error: e instanceof Error ? e.message : "Spotify SDK failed" }));
        }
      });

    return () => {
      cancelled = true;
      if (player) {
        try {
          player.disconnect();
        } catch {
          /* ignore */
        }
      }
      playerRef.current = null;
    };
  }, [enabled]);

  return { ...state, activate };
}

// Spotify only reports a progress *snapshot* each time we poll (every 15s), so
// the bar would otherwise sit frozen between refetches. This advances the
// displayed position locally once a second while playing, and re-syncs to the
// authoritative server value whenever a fresh snapshot arrives (new track, seek,
// or play/pause).
function useTickingProgress(
  progressMs: number,
  durationMs: number,
  isPlaying: boolean,
  trackKey: string,
): number {
  const base = useRef({ progressMs, at: Date.now() });
  const [, force] = useState(0);

  // Reset the baseline whenever the server snapshot meaningfully changes.
  useEffect(() => {
    base.current = { progressMs, at: Date.now() };
    force((n) => n + 1);
  }, [progressMs, trackKey, isPlaying]);

  // Tick once a second, but only while playing.
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isPlaying]);

  const elapsed = isPlaying ? Date.now() - base.current.at : 0;
  const currentMs = base.current.progressMs + elapsed;
  if (durationMs > 0) return Math.max(0, Math.min(durationMs, currentMs));
  return Math.max(0, currentMs);
}

// Centered status message used for the connect / nothing-playing / no-device
// states so they share one look.
function StatusMessage({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground">
      {icon}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export default function SpotifyAudioPlayer({ enabled, density }: WidgetProps) {
  const params = { source: "spotify" as const };
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useGetAudioPlayerNowPlaying(params, {
    query: {
      queryKey: getGetAudioPlayerNowPlayingQueryKey(params),
      refetchInterval: 15_000,
    },
  });

  const premium = data?.premium ?? false;
  const sdk = useSpotifyPlayback(Boolean(premium));
  const player = useAudioPlayer();
  const { toast } = useToast();

  // Honour the single-stream contract: when the Spotify SDK starts playing in
  // this browser, stop the shared <audio> engine (Plex stream) if it's running.
  useEffect(() => {
    if (sdk.isPlaying) player.pause();
  }, [sdk.isPlaying, player]);

  const commandMutation = useSendSpotifyCommand();
  const runCommand = (action: SpotifyCommandInputAction, deviceId?: string) => {
    commandMutation.mutate(
      { data: { action, ...(deviceId ? { deviceId } : {}) } },
      {
        onError: () => {
          // The command route answers 404 when Spotify has no device to act on;
          // "transfer" is the in-browser handoff, so give it a tailored message.
          toast({
            title:
              action === "transfer"
                ? "Couldn’t start in-browser playback"
                : "No active Spotify device",
            description:
              action === "transfer"
                ? "Open Spotify, start a track, then try “Play in browser” again."
                : "Open Spotify on a device and start playing, then try again.",
            variant: "destructive",
          });
        },
        // Give Spotify a moment to apply, then re-pull now-playing.
        onSettled: () => {
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: getGetAudioPlayerNowPlayingQueryKey(params) });
          }, 400);
        },
      },
    );
  };

  // Hand playback to the in-browser SDK device. activateElement() must run inside
  // the click gesture or the browser blocks the device and Spotify 404s.
  const playInBrowser = async () => {
    if (!sdk.deviceId) return;
    await sdk.activate();
    runCommand("transfer", sdk.deviceId);
  };

  // Local ticking progress. Computed from the latest snapshot but advanced every
  // second so the bar moves between polls. Must run before any early return to
  // keep hook order stable.
  const tickNp = data?.nowPlaying ?? null;
  const currentMs = useTickingProgress(
    tickNp?.progressMs ?? 0,
    tickNp?.durationMs ?? 0,
    tickNp?.state === "playing",
    tickNp?.id ?? "",
  );

  if (isLoading && !data) {
    return (
      <div className="flex h-full items-center justify-center p-3 text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className="flex h-full items-center justify-center p-3 text-xs text-destructive">
        Couldn’t reach Spotify.
      </div>
    );
  }

  // Not linked → prompt the user to connect in Settings.
  if (data?.auth === "needed") {
    return (
      <StatusMessage icon={<Radio size={20} aria-hidden="true" />}>
        <div className="font-medium text-foreground">Connect Spotify</div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          Link your account in Settings
          <ExternalLink size={11} aria-hidden="true" />
        </Link>
      </StatusMessage>
    );
  }

  const nowPlaying: AudioTrack | null = data?.nowPlaying ?? null;
  const device = data?.device ?? null;
  const canControl = data?.canControl ?? false;
  const queue = data?.queue ?? [];

  // Connected but nothing playing anywhere. Offer "Play here" when the SDK is a
  // ready Premium device the user can hand playback to.
  if (!nowPlaying) {
    return (
      <StatusMessage icon={<Music size={20} aria-hidden="true" />}>
        <div>Nothing playing</div>
        {premium && sdk.ready && sdk.deviceId ? (
          <button
            type="button"
            onClick={() => { void playInBrowser(); }}
            disabled={commandMutation.isPending}
            className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
          >
            <Play size={11} aria-hidden="true" />
            Play here
          </button>
        ) : (
          <div className="text-[11px] text-muted-foreground/80">
            Start playback on a Spotify device.
          </div>
        )}
        {sdk.error && (
          <div className="text-[10px] text-destructive/80">{sdk.error}</div>
        )}
      </StatusMessage>
    );
  }

  const isPlaying = nowPlaying.state === "playing";
  const durationSec = (nowPlaying.durationMs ?? 0) / 1000;
  const currentSec = currentMs / 1000;
  const pct = durationSec > 0 ? Math.min(100, (currentSec / durationSec) * 100) : 0;

  // Vertical reveal budget — mirrors the Plex tile so small tiles show just
  // artwork + title and taller ones reveal progress, controls and the queue.
  const budget = tileBudget(density);
  const showArtwork = enabled.has("artwork");
  const artSize = density.level === "sm" ? 40 : density.level === "md" ? 56 : 72;
  budget.block(Math.max(artSize, 44));
  const showProgress = enabled.has("progress") && budget.block(18);
  const showControls = enabled.has("controls") && budget.block(40);
  const restQueue = queue.filter((t) => t.id !== nowPlaying.id);
  const queueRows = enabled.has("queue")
    ? budget.list(SECTION_PX, MEDIA_ROW_PX, restQueue.length)
    : 0;

  const controlsDisabled = !canControl || commandMutation.isPending;

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      {/* Now playing: artwork + title/artist/album */}
      <div className="flex items-center gap-3">
        {showArtwork && <Artwork track={nowPlaying} size={artSize} />}
        <div className="min-w-0 flex-1">
          {enabled.has("trackInfo") ? (
            <>
              <div className="truncate text-sm font-medium" title={nowPlaying.title}>
                {nowPlaying.title}
              </div>
              {nowPlaying.artist && (
                <div className="truncate text-xs text-muted-foreground" title={nowPlaying.artist}>
                  {nowPlaying.artist}
                </div>
              )}
              {nowPlaying.album && density.level !== "sm" && (
                <div className="truncate text-[11px] text-muted-foreground/80" title={nowPlaying.album}>
                  {nowPlaying.album}
                </div>
              )}
            </>
          ) : (
            <div className="truncate text-sm font-medium" title={nowPlaying.title}>
              {nowPlaying.title}
            </div>
          )}
          {device && (
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <Radio size={10} aria-hidden="true" />
              <span className="truncate">{device.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar (read-only — Spotify drives the timeline remotely) */}
      {showProgress && (
        <div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
            <span>{fmtTime(currentSec, "s")}</span>
            <span>{fmtTime(durationSec, "s")}</span>
          </div>
        </div>
      )}

      {/* Remote playback controls */}
      {showControls && (
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => runCommand("previous")}
              disabled={controlsDisabled}
              className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              aria-label="Previous track"
            >
              <SkipBack size={18} />
            </button>
            <button
              type="button"
              onClick={() => runCommand(isPlaying ? "pause" : "play")}
              disabled={controlsDisabled}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {commandMutation.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : isPlaying ? (
                <Pause size={16} />
              ) : (
                <Play size={16} className="ml-0.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => runCommand("next")}
              disabled={controlsDisabled}
              className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              aria-label="Next track"
            >
              <SkipForward size={18} />
            </button>
          </div>
          {/* Premium in-browser handoff: move playback into this tab. */}
          {premium && sdk.ready && sdk.deviceId && !sdk.isActive && (
            <button
              type="button"
              onClick={() => { void playInBrowser(); }}
              disabled={commandMutation.isPending}
              className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline disabled:opacity-50"
            >
              <Play size={10} aria-hidden="true" />
              Play in browser
            </button>
          )}
          {!canControl && (
            <div className="text-[10px] text-muted-foreground/70">
              No active device — open Spotify to control
            </div>
          )}
        </div>
      )}

      {/* Up next queue */}
      {queueRows > 0 && (
        <div className="min-h-0 flex-1">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Up Next
          </div>
          <div className="space-y-1">
            {restQueue.slice(0, queueRows).map((t, i) => (
              <div
                key={`${t.id}-${i}`}
                className="flex w-full items-center gap-2 rounded text-left"
              >
                <Artwork track={t} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs" title={t.title}>
                    {t.title}
                  </div>
                  {t.artist && (
                    <div className="truncate text-[11px] text-muted-foreground" title={t.artist}>
                      {t.artist}
                    </div>
                  )}
                </div>
                {t.durationMs != null && (
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {fmtTime(t.durationMs, "ms")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
