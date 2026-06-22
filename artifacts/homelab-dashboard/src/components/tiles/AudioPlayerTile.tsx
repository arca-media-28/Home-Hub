import {
  useGetAudioPlayerNowPlaying,
  getGetAudioPlayerNowPlayingQueryKey,
} from "@workspace/api-client-react";
import type { AudioTrack } from "@workspace/api-client-react";
import { Music, Play, Pause, SkipBack, SkipForward, Volume2 } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";
import { useAudioPlayer } from "@/lib/audioPlayer";
import { tileBudget, SECTION_PX, MEDIA_ROW_PX } from "./metrics";
import { Artwork, fmtTime } from "./audioShared";
import SpotifyAudioPlayer from "./SpotifyAudioPlayer";

// Audio Player tile. Branches on the configured source: Spotify (OAuth + remote
// control / Web Playback SDK) renders a dedicated component, while Plex (and the
// default) uses the shared in-browser <audio> stream engine below.
export default function AudioPlayerTile(props: WidgetProps) {
  const source = (props.tileSettings?.audioSource as string | undefined) ?? "plex";
  if (source === "spotify") {
    return <SpotifyAudioPlayer {...props} />;
  }
  return <StreamAudioPlayer {...props} />;
}

function StreamAudioPlayer({ enabled, density, tileSettings }: WidgetProps) {
  const source = (tileSettings?.audioSource as "plex" | undefined) ?? "plex";
  const params = { source };
  const {
    data,
    isLoading,
    isError,
  } = useGetAudioPlayerNowPlaying(params, {
    query: {
      queryKey: getGetAudioPlayerNowPlayingQueryKey(params),
      refetchInterval: 15_000,
    },
  });

  // Each tile owns playback under a stable id derived from its source so the tile
  // can tell whether the global player is currently "its" stream.
  const ownerId = `audioplayer:${source}`;
  const player = useAudioPlayer();
  const isOurs = player.ownerId === ownerId && player.currentTrack != null;

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
        Couldn’t reach the music source.
      </div>
    );
  }

  const backendNowPlaying = data?.nowPlaying ?? null;
  const backendQueue = data?.queue ?? [];
  const sample = data?.sample ?? false;

  // The displayed track: prefer the global player's live track when this tile
  // owns it (so play/seek reflect immediately), else the backend's now-playing.
  const displayTrack: AudioTrack | null = isOurs ? player.currentTrack : backendNowPlaying;

  if (!displayTrack) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center text-xs text-muted-foreground">
        <Music size={20} aria-hidden="true" />
        <span>Nothing playing</span>
      </div>
    );
  }

  // Tracks are streamable only when they carry a streamUrl (real source, not the
  // demo payload). Demo/sample data shows now-playing but disables controls.
  const canStream = backendQueue.some((t) => Boolean(t.streamUrl));

  // Progress + duration: from the live player when we own playback, else from the
  // backend's reported session (remote Plex session) when present.
  const liveDuration = isOurs ? player.duration : (displayTrack.durationMs ?? 0) / 1000;
  const liveCurrent = isOurs
    ? player.currentTime
    : (displayTrack.progressMs ?? 0) / 1000;
  const pct = liveDuration > 0 ? Math.min(100, (liveCurrent / liveDuration) * 100) : 0;

  const isPlaying = isOurs ? player.isPlaying : displayTrack.state === "playing";

  // Build the vertical reveal budget so a small tile shows just artwork + title,
  // and a taller tile reveals progress, controls and the up-next queue in order.
  const budget = tileBudget(density);
  const showArtwork = enabled.has("artwork");
  const artSize = density.level === "sm" ? 40 : density.level === "md" ? 56 : 72;

  // The header block (artwork + track info) is always shown — it is the point of
  // the tile. Remaining metrics compete for the leftover budget in priority order.
  budget.block(Math.max(artSize, 44));
  const showProgress = enabled.has("progress") && budget.block(18);
  const showControls = enabled.has("controls") && budget.block(40);

  const restQueue = backendQueue.filter((t) => t.id !== displayTrack.id);
  const queueRows = enabled.has("queue")
    ? budget.list(SECTION_PX, MEDIA_ROW_PX, restQueue.length)
    : 0;

  const startPlayback = (startId: string) => {
    if (!canStream) return;
    const startIndex = backendQueue.findIndex((t) => t.id === startId);
    player.playQueue(backendQueue, startIndex < 0 ? 0 : startIndex, ownerId);
  };

  const onTogglePlay = () => {
    if (!canStream) return;
    if (isOurs) {
      player.togglePlay();
    } else {
      startPlayback(displayTrack.id);
    }
  };

  const seekFromClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isOurs || liveDuration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    player.seek(ratio * liveDuration);
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      {/* Now playing: artwork + title/artist */}
      <div className="flex items-center gap-3">
        {showArtwork && <Artwork track={displayTrack} size={artSize} />}
        <div className="min-w-0 flex-1">
          {enabled.has("trackInfo") ? (
            <>
              <div className="truncate text-sm font-medium" title={displayTrack.title}>
                {displayTrack.title}
              </div>
              {displayTrack.artist && (
                <div className="truncate text-xs text-muted-foreground" title={displayTrack.artist}>
                  {displayTrack.artist}
                </div>
              )}
              {displayTrack.album && density.level !== "sm" && (
                <div className="truncate text-[11px] text-muted-foreground/80" title={displayTrack.album}>
                  {displayTrack.album}
                </div>
              )}
            </>
          ) : (
            <div className="truncate text-sm font-medium" title={displayTrack.title}>
              {displayTrack.title}
            </div>
          )}
          {sample && (
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Demo
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {showProgress && (
        <div>
          <div
            className={`h-1.5 w-full overflow-hidden rounded-full bg-muted ${isOurs ? "cursor-pointer" : ""}`}
            onClick={seekFromClick}
            role="presentation"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
            <span>{fmtTime(liveCurrent, "s")}</span>
            <span>{fmtTime(liveDuration, "s")}</span>
          </div>
        </div>
      )}

      {/* Playback controls */}
      {showControls && (
        <div className="relative flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => isOurs && player.prev()}
            disabled={!canStream || !isOurs}
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            aria-label="Previous track"
          >
            <SkipBack size={18} />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={!canStream}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          </button>
          <button
            type="button"
            onClick={() => isOurs && player.next()}
            disabled={!canStream || !isOurs}
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            aria-label="Next track"
          >
            <SkipForward size={18} />
          </button>
          {isOurs && density.level !== "sm" && (
            <div className="absolute right-0 flex items-center gap-1.5">
              <Volume2 size={14} className="text-muted-foreground" aria-hidden="true" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={player.volume}
                onChange={(e) => player.setVolume(Number(e.target.value))}
                className="h-1 w-16 cursor-pointer accent-primary"
                aria-label="Volume"
              />
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
            {restQueue.slice(0, queueRows).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => startPlayback(t.id)}
                disabled={!canStream}
                className="flex w-full items-center gap-2 rounded text-left transition-colors hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
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
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
