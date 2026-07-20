import { useEffect, useMemo, useRef, useState } from "react";
import type { Tile } from "@workspace/api-client-react";
import {
  useGetVideoPlaylist,
  getGetVideoPlaylistQueryKey,
} from "@workspace/api-client-react";
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Video Player tile: a full-surface video player. Sources chosen in the tile
// editor: uploaded video files, pasted direct video URLs, a YouTube video or
// playlist (iframe embed), or a Plex/Jellyfin library (direct-play stream
// URLs from the api-server). When nothing is configured the tile plays a
// built-in royalty-free yule log stream, muted and looped — a cozy default.
// A configured source that fails shows an explicit error state instead
// (never silently falling back to the yule log).
// Playback modes: loop a single video, or play through the playlist with
// optional playlist-loop and shuffle. Muted by default (autoplay-safe) with
// a hover overlay for play/pause, prev/next, mute + volume, and fit.
// ---------------------------------------------------------------------------

// Royalty-free fireplace loop ("free video library" upload on Wikimedia
// Commons) — the tile's unconfigured default.
export const YULE_LOG_URL =
  "https://upload.wikimedia.org/wikipedia/commons/b/bb/Fantastic-fireplace-fire-chimney-hearth-_background_-_texture_-_motion_graphics_-_free_video_library.webm";

export interface VideoEntry {
  id: string;
  title: string;
  url: string;
}

// Parse a YouTube video/playlist URL into an embeddable iframe src. Supports
// watch?v=, youtu.be/, shorts/, playlist?list= and raw ids. Returns null when
// nothing recognizable is found.
export function youtubeEmbedSrc(
  raw: string,
  opts: { muted: boolean; loop: boolean; shuffle: boolean },
): string | null {
  const input = raw.trim();
  if (!input) return null;
  let videoId: string | null = null;
  let listId: string | null = null;
  try {
    const url = new URL(input.includes("://") ? input : `https://${input}`);
    listId = url.searchParams.get("list");
    if (url.hostname.includes("youtu.be")) {
      videoId = url.pathname.slice(1).split("/")[0] || null;
    } else {
      videoId = url.searchParams.get("v");
      const shorts = url.pathname.match(/\/(?:shorts|embed)\/([\w-]{6,})/);
      if (!videoId && shorts) videoId = shorts[1] ?? null;
    }
  } catch {
    // Not a URL — treat a bare token as a video id, PL… as a playlist id.
    if (/^PL[\w-]+$/.test(input)) listId = input;
    else if (/^[\w-]{6,}$/.test(input)) videoId = input;
  }
  if (!videoId && !listId) return null;
  const params = new URLSearchParams({
    autoplay: "1",
    mute: opts.muted ? "1" : "0",
    controls: "1",
    rel: "0",
    playsinline: "1",
  });
  if (listId) {
    params.set("list", listId);
    params.set("listType", "playlist");
    if (opts.loop) params.set("loop", "1");
    // YouTube has no shuffle param for embeds; loop is the best we can do.
    return videoId
      ? `https://www.youtube.com/embed/${videoId}?${params.toString()}`
      : `https://www.youtube.com/embed/videoseries?${params.toString()}`;
  }
  if (opts.loop) {
    // Single-video looping requires playlist=<same id>.
    params.set("loop", "1");
    params.set("playlist", videoId!);
  }
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

// Fisher–Yates on a copy, seeded by nothing (fresh order per mount/shuffle).
function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function fileTitle(url: string): string {
  try {
    const path = decodeURIComponent(new URL(url, window.location.origin).pathname);
    const base = path.split("/").pop() ?? url;
    return base.replace(/\.[a-z0-9]+$/i, "") || url;
  } catch {
    return url;
  }
}

interface VideoPlayerTileProps {
  tile: Tile;
  editMode: boolean;
}

export default function VideoPlayerTile({ tile, editMode }: VideoPlayerTileProps) {
  const s = tile.tileSettings ?? {};
  const source = s.videoSource ?? null;
  const playMode = s.videoPlayMode === "single" ? "single" : "playlist";
  const playlistLoop = s.videoPlaylistLoop ?? true;
  const shuffle = s.videoShuffle ?? false;
  const startMuted = s.videoMuted ?? true;
  const fit = s.videoFit === "contain" ? "contain" : "cover";

  const isServerSource = source === "plex" || source === "jellyfin";
  const libraryId = s.videoLibraryId ?? null;
  const serverParams = {
    server: (source === "jellyfin" ? "jellyfin" : "plex") as "plex" | "jellyfin",
    libraryId: libraryId ?? undefined,
  };
  const playlistQuery = useGetVideoPlaylist(serverParams, {
    query: {
      queryKey: getGetVideoPlaylistQueryKey(serverParams),
      enabled: isServerSource && !!libraryId,
      refetchInterval: 10 * 60_000,
      staleTime: 5 * 60_000,
    },
  });

  // Resolve the playlist for the chosen source. `demo` = built-in yule log;
  // `failed` = configured source errored (explicit error state, no fallback).
  const { videos, demo, failed } = useMemo((): {
    videos: VideoEntry[];
    demo: boolean;
    failed: boolean;
  } => {
    const yule: VideoEntry[] = [{ id: "yule-log", title: "Yule log", url: YULE_LOG_URL }];
    if (source === "uploads" || source === "urls") {
      const list = ((source === "uploads" ? s.videoUploadUrls : s.videoUrls) ?? []).filter(
        Boolean,
      );
      return list.length > 0
        ? {
            videos: list.map((url, i) => ({ id: `${source}-${i}`, title: fileTitle(url), url })),
            demo: false,
            failed: false,
          }
        : { videos: yule, demo: true, failed: false };
    }
    if (isServerSource) {
      if (!libraryId) return { videos: yule, demo: true, failed: false };
      if (playlistQuery.isError) return { videos: [], demo: false, failed: true };
      const data = playlistQuery.data;
      if (!data) return { videos: [], demo: false, failed: false };
      if (data.sample || data.videos.length === 0) {
        return { videos: yule, demo: true, failed: false };
      }
      return {
        videos: data.videos.map((v) => ({ id: v.id, title: v.title, url: v.streamUrl })),
        demo: false,
        failed: false,
      };
    }
    return { videos: yule, demo: true, failed: false };
  }, [
    source,
    s.videoUploadUrls,
    s.videoUrls,
    isServerSource,
    libraryId,
    playlistQuery.data,
    playlistQuery.isError,
  ]);

  // Play order: identity for ordered playback, a shuffled copy otherwise.
  const [order, setOrder] = useState<number[]>([]);
  useEffect(() => {
    const base = videos.map((_, i) => i);
    setOrder(shuffle && playMode === "playlist" ? shuffled(base) : base);
    setPos(0);
  }, [videos, shuffle, playMode]);

  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(true);
  // Set when a configured (non-demo) media file fails to load/decode — 404,
  // auth, CORS or codec errors on the <video> element itself. Shows the same
  // explicit error state as a failed playlist fetch (never the yule log).
  const [mediaFailed, setMediaFailed] = useState(false);
  useEffect(() => setMediaFailed(false), [videos]);
  const [muted, setMuted] = useState(startMuted);
  const [volume, setVolume] = useState(0.7);
  useEffect(() => setMuted(startMuted), [startMuted]);

  const count = videos.length;
  const currentIndex = order.length > 0 ? order[pos % order.length]! : 0;
  const current = count > 0 ? videos[currentIndex % count] : null;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = muted;
    el.volume = volume;
  }, [muted, volume, current?.url]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (playing) void el.play().catch(() => {});
    else el.pause();
  }, [playing, current?.url]);

  const loopSingle = playMode === "single" || demo || count === 1;

  function advance(delta: number) {
    if (count < 2) {
      videoRef.current?.play().catch(() => {});
      return;
    }
    const next = pos + delta;
    if (next >= order.length) {
      if (playlistLoop) {
        if (shuffle) setOrder(shuffled(videos.map((_, i) => i)));
        setPos(0);
      } else {
        setPlaying(false);
      }
      return;
    }
    setPos(((next % order.length) + order.length) % order.length);
  }

  // ── YouTube: hand playback to the iframe (its own controls). ──────────────
  const youtubeSrc =
    source === "youtube"
      ? youtubeEmbedSrc(s.videoYoutubeUrl ?? "", {
          muted: startMuted,
          loop: playMode === "single" ? true : playlistLoop,
          shuffle,
        })
      : null;

  let body: React.ReactElement;
  if (failed || mediaFailed) {
    body = (
      <div
        className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground text-sm bg-card"
        data-testid="videoplayer-error"
      >
        <VideoOff className="w-5 h-5 opacity-50" />
        <span>{mediaFailed ? "Video failed to load" : "Videos unavailable"}</span>
      </div>
    );
  } else if (source === "youtube") {
    body = youtubeSrc ? (
      <iframe
        src={youtubeSrc}
        title="YouTube player"
        data-testid="videoplayer-youtube"
        className="absolute inset-0 w-full h-full"
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        style={editMode ? { pointerEvents: "none" } : undefined}
      />
    ) : (
      <div
        className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground text-sm bg-card"
        data-testid="videoplayer-error"
      >
        <VideoOff className="w-5 h-5 opacity-50" />
        <span>Invalid YouTube link</span>
      </div>
    );
  } else if (isServerSource && libraryId && !playlistQuery.data && playlistQuery.isLoading) {
    body = (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm bg-black/80">
        Loading videos…
      </div>
    );
  } else {
    body = (
      <div className="relative w-full h-full overflow-hidden bg-black group">
        {current && (
          <video
            key={current.url}
            ref={videoRef}
            src={current.url}
            data-testid="videoplayer-video"
            data-video-id={current.id}
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: fit }}
            autoPlay
            playsInline
            muted={muted}
            loop={loopSingle}
            onEnded={() => {
              if (!loopSingle) advance(1);
            }}
            onError={() => {
              // Only configured sources surface the error state; if the
              // built-in yule log itself can't load (offline box) there is
              // nothing better to fall back to, so stay quiet.
              if (!demo) setMediaFailed(true);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        )}
        {demo && (
          <span
            className="absolute top-1.5 right-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/80"
            data-testid="videoplayer-demo-badge"
          >
            Yule log
          </span>
        )}
        {!editMode && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5 opacity-0 transition-opacity group-hover:opacity-100">
            {count > 1 && (
              <button
                type="button"
                aria-label="Previous video"
                data-testid="videoplayer-prev"
                onClick={() => setPos(((pos - 1) % order.length + order.length) % order.length)}
                className="rounded-full bg-black/40 p-1 text-white hover:bg-black/60"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              aria-label={playing ? "Pause" : "Play"}
              data-testid="videoplayer-playpause"
              onClick={() => setPlaying((p) => !p)}
              className="rounded-full bg-black/40 p-1.5 text-white hover:bg-black/60"
            >
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            {count > 1 && (
              <button
                type="button"
                aria-label="Next video"
                data-testid="videoplayer-next"
                onClick={() => advance(1)}
                className="rounded-full bg-black/40 p-1 text-white hover:bg-black/60"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              aria-label={muted ? "Unmute" : "Mute"}
              data-testid="videoplayer-mute"
              onClick={() => setMuted((m) => !m)}
              className="rounded-full bg-black/40 p-1 text-white hover:bg-black/60"
            >
              {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Volume"
              data-testid="videoplayer-volume"
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                if (v > 0 && muted) setMuted(false);
                if (v === 0) setMuted(true);
              }}
              className="h-1 w-16 accent-white/90"
            />
            {current && !demo && (
              <span className="ml-auto max-w-[45%] truncate text-[10px] text-white/80">
                {current.title}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-[inherit] bg-black"
      data-testid="videoplayer-tile"
    >
      {body}
    </div>
  );
}
