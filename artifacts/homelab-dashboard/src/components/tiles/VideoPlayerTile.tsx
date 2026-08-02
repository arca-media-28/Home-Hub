import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { Tile, TileSettings } from "@workspace/api-client-react";
import {
  useGetVideoPlaylist,
  getGetVideoPlaylistQueryKey,
  useGetErsatzChannels,
  getGetErsatzChannelsQueryKey,
  useUpdateTile,
  getGetTilesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ListVideo,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  RotateCw,
  Square,
  SkipForward,
  Tv,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";

// The drill-down browser is Plex-only and dialog-heavy; load it lazily so
// tiles with other sources never pay for it.
const VideoBrowser = lazy(() => import("./VideoBrowser"));

// The cable-guide grid is ErsatzTV-only; also lazy for the same reason.
const ErsatzGuideGrid = lazy(() => import("./ErsatzGuideGrid"));

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

// Format an ISO timestamp as a short local wall-clock time (e.g. "8:30 PM")
// for the "Up next" line. Returns null when the value is missing/unparseable.
export function formatGuideTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// Progress info for the current live-TV programme: how far through it we are
// (0..1) plus a human "Ends in Xm" hint. Returns null when either bound is
// missing/unparseable or the window is nonsensical (stop ≤ start, or now
// outside the window — the guide data is stale in that case).
export function guideProgress(
  startIso: string | null | undefined,
  stopIso: string | null | undefined,
  nowMs: number,
): { fraction: number; endsIn: string } | null {
  if (!startIso || !stopIso) return null;
  const start = Date.parse(startIso);
  const stop = Date.parse(stopIso);
  if (Number.isNaN(start) || Number.isNaN(stop) || stop <= start) return null;
  if (nowMs < start || nowMs >= stop) return null;
  const fraction = (nowMs - start) / (stop - start);
  const minsLeft = Math.max(1, Math.ceil((stop - nowMs) / 60_000));
  const endsIn =
    minsLeft >= 60
      ? `Ends in ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`
      : `Ends in ${minsLeft} min`;
  return { fraction: Math.min(1, Math.max(0, fraction)), endsIn };
}

// mm:ss (or h:mm:ss) for the seek bar's time labels.
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function fileTitle(url: string): string {
  try {
    const path = decodeURIComponent(
      new URL(url, window.location.origin).pathname,
    );
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

// ---------------------------------------------------------------------------
// Playback memory: the tile unmounts whenever the user switches dashboard
// pages (each page renders its own tile tree), which used to restart the
// video from the beginning. A localStorage-backed store keyed by tile id
// remembers the shuffled play order, playlist position, current video URL
// and the timestamp within it, plus mute/volume — so returning to the page
// (or reloading the browser entirely) resumes where playback left off.
// The saved playlist URL fingerprint guards against stale entries: if the
// resolved video list has changed, the memory is discarded. Entries expire
// after MAX_AGE (so long-finished videos don't resurrect weeks later) and
// the store is capped so deleted tiles' entries eventually age out.
// ---------------------------------------------------------------------------
interface PlaybackMemory {
  // Fingerprint of the playlist the saved state belongs to; ignore the
  // memory when the resolved video list has since changed.
  urls: string[];
  order: number[];
  pos: number;
  currentUrl: string;
  time: number;
  playing: boolean;
  muted: boolean;
  volume: number;
  // When the user picked a queue via the Plex drill-down browser, the queue
  // itself is remembered so a page switch/reload resumes the picked episodes
  // instead of falling back to the flat library playlist.
  queue?: VideoEntry[];
}

interface StoredPlaybackMemory extends PlaybackMemory {
  savedAt: number;
}

const PLAYBACK_STORAGE_KEY = "homehub:videoPlayback";
const PLAYBACK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks
const PLAYBACK_MAX_ENTRIES = 40;

function readPlaybackStore(): Record<string, StoredPlaybackMemory> {
  try {
    const raw = localStorage.getItem(PLAYBACK_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const now = Date.now();
    const store: Record<string, StoredPlaybackMemory> = {};
    for (const [tileId, entry] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      const e = entry as Partial<StoredPlaybackMemory> | null;
      if (
        !e ||
        typeof e !== "object" ||
        typeof e.savedAt !== "number" ||
        now - e.savedAt > PLAYBACK_MAX_AGE_MS ||
        !Array.isArray(e.urls) ||
        !Array.isArray(e.order) ||
        typeof e.pos !== "number" ||
        typeof e.currentUrl !== "string" ||
        typeof e.time !== "number"
      ) {
        continue; // drop expired / malformed entries
      }
      store[tileId] = e as StoredPlaybackMemory;
    }
    return store;
  } catch {
    return {};
  }
}

function writePlaybackStore(store: Record<string, StoredPlaybackMemory>) {
  try {
    localStorage.setItem(PLAYBACK_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full/unavailable — playback memory is best-effort.
  }
}

function loadPlaybackMemory(tileId: Tile["id"]): PlaybackMemory | null {
  return readPlaybackStore()[String(tileId)] ?? null;
}

function savePlaybackMemory(tileId: Tile["id"], memory: PlaybackMemory) {
  const store = readPlaybackStore();
  store[String(tileId)] = { ...memory, savedAt: Date.now() };
  // Cap the store so entries for deleted tiles can't accumulate forever:
  // evict the oldest-saved entries beyond the cap.
  const keys = Object.keys(store);
  if (keys.length > PLAYBACK_MAX_ENTRIES) {
    keys
      .sort((a, b) => store[a]!.savedAt - store[b]!.savedAt)
      .slice(0, keys.length - PLAYBACK_MAX_ENTRIES)
      .forEach((k) => delete store[k]);
  }
  writePlaybackStore(store);
}

export function clearPlaybackMemory(tileId: Tile["id"]) {
  const store = readPlaybackStore();
  if (String(tileId) in store) {
    delete store[String(tileId)];
    writePlaybackStore(store);
  }
}

function sameUrls(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((url, i) => url === b[i]);
}

// ErsatzTV stream URLs point at the api-server's same-origin HLS proxy, which
// authenticates via a ?token= query parameter — media element / hls.js
// requests can't reliably carry an Authorization header.
function withAuthToken(url: string): string {
  const token = localStorage.getItem("token") ?? "";
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

export default function VideoPlayerTile({
  tile,
  editMode,
}: VideoPlayerTileProps) {
  const s = tile.tileSettings ?? {};
  const source = s.videoSource ?? null;
  const playMode = s.videoPlayMode === "single" ? "single" : "playlist";
  const playlistLoop = s.videoPlaylistLoop ?? true;
  const shuffle = s.videoShuffle ?? false;
  const startMuted = s.videoMuted ?? true;
  // Auto-mute when the user navigates away (dashboard page switch unmounts
  // the tile; browser tab switch hides the document). Default on; the tile
  // settings modal exposes a toggle.
  const pageSwitchMute = s.videoPageSwitchMute ?? true;
  const fit = s.videoFit === "contain" ? "contain" : "cover";

  const isServerSource = source === "plex" || source === "jellyfin";
  const libraryId = s.videoLibraryId ?? null;
  const serverParams = {
    server: (source === "jellyfin" ? "jellyfin" : "plex") as
      | "plex"
      | "jellyfin",
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

  // ErsatzTV: live channel lineup with now-airing info. Refetched every
  // minute so the guide line stays current while the stream keeps playing.
  const isErsatz = source === "ersatztv";
  const ersatzQuery = useGetErsatzChannels({
    query: {
      queryKey: getGetErsatzChannelsQueryKey(),
      enabled: isErsatz,
      refetchInterval: 60_000,
      staleTime: 30_000,
    },
  });
  const ersatzChannels = useMemo(
    () =>
      (ersatzQuery.data?.channels ?? []).filter(
        (c): c is typeof c & { streamUrl: string } => !!c.streamUrl,
      ),
    [ersatzQuery.data],
  );
  const tunedChannel = s.videoErsatzChannel ?? null;
  // The full channel record for whatever is currently tuned (falling back to
  // the first channel, mirroring the playlist resolution below) so the
  // overlay can show its up-next info.
  const tunedErsatz = isErsatz
    ? (ersatzChannels.find((c) => c.number === tunedChannel) ??
      ersatzChannels[0] ??
      null)
    : null;

  // A slow clock so the "ends in" hint and progress bar advance while the
  // channel plays; ticks when a live channel with guide bounds is tuned OR
  // any listed channel has guide bounds (the pop-out shows per-channel
  // progress too).
  const [guideNow, setGuideNow] = useState(() => Date.now());
  const hasGuideWindow =
    (!!tunedErsatz?.nowPlayingStart && !!tunedErsatz?.nowPlayingStop) ||
    ersatzChannels.some((c) => c.nowPlayingStart && c.nowPlayingStop);
  useEffect(() => {
    if (!hasGuideWindow) return;
    const timer = setInterval(() => setGuideNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [hasGuideWindow]);
  const tunedProgress = tunedErsatz
    ? guideProgress(
        tunedErsatz.nowPlayingStart,
        tunedErsatz.nowPlayingStop,
        guideNow,
      )
    : null;

  // Persist a channel change through the normal tile-update flow so the
  // tuned channel survives page switches and reloads (same reconcile
  // pattern as the Note tile).
  const queryClient = useQueryClient();
  const updateTile = useUpdateTile({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData<Tile[]>(getGetTilesQueryKey(), (old) =>
          old?.map((t) => (t.id === updated.id ? updated : t)),
        );
        void queryClient.invalidateQueries({ queryKey: getGetTilesQueryKey() });
      },
    },
  });
  // Refresh the guide right when the tuned programme ends: a single timeout
  // keyed to nowPlayingStop invalidates the channel lineup so the new title,
  // up-next, and progress land promptly instead of waiting for the next poll.
  const tunedStop = tunedErsatz?.nowPlayingStop ?? null;
  useEffect(() => {
    if (!tunedStop) return;
    const stopMs = new Date(tunedStop).getTime();
    if (!Number.isFinite(stopMs)) return;
    // Small grace so ErsatzTV has rolled over to the next programme by the
    // time we refetch; fire immediately (clamped) if the stop already passed.
    const delay = Math.max(0, stopMs - Date.now() + 2_000);
    const timer = setTimeout(() => {
      setGuideNow(Date.now());
      void queryClient.invalidateQueries({
        queryKey: getGetErsatzChannelsQueryKey(),
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [tunedStop, queryClient]);

  function tuneChannel(number: string) {
    const settings: TileSettings = {
      ...(tile.tileSettings ?? {}),
      videoErsatzChannel: number,
    };
    updateTile.mutate({ id: tile.id, data: { tileSettings: settings } });
  }

  // Saved playback state from a previous mount of this tile (page switch or
  // re-render). Read once; consumed as the playlist resolves and the video
  // element loads its metadata.
  const savedRef = useRef<PlaybackMemory | null>(loadPlaybackMemory(tile.id));

  // A queue picked via the Plex drill-down browser. While set, it replaces
  // the flat library playlist as the tile's video list. Restored from the
  // playback memory so a page switch/reload resumes the picked episodes.
  const [overrideQueue, setOverrideQueue] = useState<VideoEntry[] | null>(
    () => {
      const saved = savedRef.current;
      return source === "plex" && saved?.queue && saved.queue.length > 0
        ? saved.queue
        : null;
    },
  );
  // Drop the picked queue when the tile is re-pointed at another source or
  // library (skip the initial mount so the restored queue survives).
  const sourceKeyRef = useRef(`${source}|${libraryId}`);
  useEffect(() => {
    const key = `${source}|${libraryId}`;
    if (sourceKeyRef.current !== key) {
      sourceKeyRef.current = key;
      setOverrideQueue(null);
    }
  }, [source, libraryId]);

  // Resolve the playlist for the chosen source. `demo` = built-in yule log;
  // `failed` = configured source errored (explicit error state, no fallback).
  const {
    videos: resolvedVideos,
    demo,
    failed,
  } = useMemo((): {
    videos: VideoEntry[];
    demo: boolean;
    failed: boolean;
  } => {
    const yule: VideoEntry[] = [
      { id: "yule-log", title: "Yule log", url: YULE_LOG_URL },
    ];
    if (source === "uploads" || source === "urls") {
      const list = (
        (source === "uploads" ? s.videoUploadUrls : s.videoUrls) ?? []
      ).filter(Boolean);
      return list.length > 0
        ? {
            videos: list.map((url, i) => ({
              id: `${source}-${i}`,
              title: fileTitle(url),
              url,
            })),
            demo: false,
            failed: false,
          }
        : { videos: yule, demo: true, failed: false };
    }
    if (isErsatz) {
      // Live TV: the tile plays exactly one channel at a time (the tuned
      // one); switching channels goes through the channel pop-out.
      if (ersatzQuery.isError) return { videos: [], demo: false, failed: true };
      const data = ersatzQuery.data;
      if (!data) return { videos: [], demo: false, failed: false };
      if (data.sample || ersatzChannels.length === 0) {
        return { videos: yule, demo: true, failed: false };
      }
      const tuned =
        ersatzChannels.find((c) => c.number === tunedChannel) ??
        ersatzChannels[0]!;
      return {
        videos: [
          {
            id: `ersatztv-${tuned.number}`,
            title: `${tuned.number} · ${tuned.name}${
              tuned.nowPlaying ? ` — ${tuned.nowPlaying}` : ""
            }`,
            url: withAuthToken(tuned.streamUrl),
          },
        ],
        demo: false,
        failed: false,
      };
    }
    if (isServerSource) {
      // A queue picked in the drill-down browser wins over the flat playlist.
      if (source === "plex" && overrideQueue && overrideQueue.length > 0) {
        return { videos: overrideQueue, demo: false, failed: false };
      }
      if (!libraryId) return { videos: yule, demo: true, failed: false };
      if (playlistQuery.isError)
        return { videos: [], demo: false, failed: true };
      const data = playlistQuery.data;
      if (!data) return { videos: [], demo: false, failed: false };
      if (data.sample || data.videos.length === 0) {
        return { videos: yule, demo: true, failed: false };
      }
      return {
        videos: data.videos.map((v) => ({
          id: v.id,
          title: v.title,
          url: v.streamUrl,
        })),
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
    overrideQueue,
    playlistQuery.data,
    playlistQuery.isError,
    isErsatz,
    ersatzQuery.data,
    ersatzQuery.isError,
    ersatzChannels,
    tunedChannel,
  ]);

  // Keep the videos array reference stable across background refetches that
  // return the same content. Downstream effects (play-order reset, media
  // error reset) key off this identity, so a refetch that changes nothing
  // must not disturb playback or any open pop-out.
  const stableVideosRef = useRef(resolvedVideos);
  if (
    stableVideosRef.current !== resolvedVideos &&
    !(
      resolvedVideos.length === stableVideosRef.current.length &&
      resolvedVideos.every((v, i) => {
        const prev = stableVideosRef.current[i]!;
        return v.id === prev.id && v.title === prev.title && v.url === prev.url;
      })
    )
  ) {
    stableVideosRef.current = resolvedVideos;
  }
  const videos = stableVideosRef.current;

  // Play order: identity for ordered playback, a shuffled copy otherwise.
  // When a saved memory matches the resolved playlist, restore its order and
  // position instead of starting over (also preserves the shuffle order).
  const [order, setOrder] = useState<number[]>([]);
  // Start index requested by the drill-down browser for the queue it just
  // handed over; consumed once when the play order is rebuilt for it.
  const pendingStartRef = useRef<number | null>(null);
  useEffect(() => {
    const urls = videos.map((v) => v.url);
    const saved = savedRef.current;
    if (
      saved &&
      sameUrls(saved.urls, urls) &&
      saved.order.length === videos.length
    ) {
      setOrder(saved.order);
      setPos(saved.pos);
      return;
    }
    const base = videos.map((_, i) => i);
    const nextOrder =
      shuffle && playMode === "playlist" ? shuffled(base) : base;
    setOrder(nextOrder);
    const want = pendingStartRef.current;
    pendingStartRef.current = null;
    setPos(want != null ? Math.max(0, nextOrder.indexOf(want)) : 0);
  }, [videos, shuffle, playMode]);

  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(savedRef.current?.playing ?? true);
  // Set when a configured (non-demo) media file fails to load/decode — 404,
  // auth, CORS or codec errors on the <video> element itself. Shows the same
  // explicit error state as a failed playlist fetch (never the yule log).
  const [mediaFailed, setMediaFailed] = useState(false);
  useEffect(() => setMediaFailed(false), [videos]);
  // Bumped by the error-state "Retry" button; re-runs the HLS attach effect
  // so a stalled/dead live stream gets a fresh hls.js instance re-tuned to
  // the same channel without the user having to reopen the channel picker.
  const [hlsRetryNonce, setHlsRetryNonce] = useState(0);
  // True while the hls.js error handler is mid-recovery (between a fatal but
  // recoverable error and the next buffered fragment). Drives a small
  // non-blocking "Reconnecting…" badge so a stalled live stream doesn't look
  // like a silently frozen frame.
  const [hlsReconnecting, setHlsReconnecting] = useState(false);
  // True when a live HLS stream is playing sound but the video track never
  // materialized (videoWidth stays 0). Almost always means the ErsatzTV
  // channel's FFmpeg profile outputs a codec the browser can't decode
  // (MPEG-2, or HEVC without hardware support) — surfaced as a hint badge
  // rather than an error since audio is still playing.
  const [audioOnly, setAudioOnly] = useState(false);
  // Buffering hint for live HLS streams: the video element fired `waiting`
  // (playback stalled to buffer) and hasn't resumed yet. A spinner overlay
  // lets the stream catch up without alarming the user.
  const [buffering, setBuffering] = useState(false);
  // Live-TV "Stop" state: the stream is fully torn down (hls.js destroyed,
  // no segment fetches) so the ErsatzTV transcoder session can wind down.
  // Resuming re-attaches a fresh instance to the same channel.
  const [stopped, setStopped] = useState(false);
  const [muted, setMuted] = useState(savedRef.current?.muted ?? startMuted);
  // Playlist pop-out: a scrollable list of all entries (in play order) with
  // the current one highlighted; clicking an entry jumps straight to it.
  // Note: intentionally NOT closed when `videos` changes — background
  // playlist refetches must never yank the pop-out shut (or reset its
  // scroll) while the user is browsing it.
  const [playlistOpen, setPlaylistOpen] = useState(false);
  // Plex drill-down browser dialog (replaces the flat pop-out for Plex).
  const [browserOpen, setBrowserOpen] = useState(false);
  // ErsatzTV channel pop-out (number, name, now airing; tap to tune).
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [volume, setVolume] = useState(savedRef.current?.volume ?? 0.7);
  const startMutedRef = useRef(startMuted);
  useEffect(() => {
    // Only react to actual setting changes; don't clobber a restored value.
    if (startMutedRef.current !== startMuted) {
      startMutedRef.current = startMuted;
      setMuted(startMuted);
    }
  }, [startMuted]);

  const count = videos.length;
  const currentIndex = order.length > 0 ? order[pos % order.length]! : 0;
  const current = count > 0 ? videos[currentIndex % count] : null;

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Seek bar state: current playback position and total duration of the
  // active video. Kept in React state (throttled naturally by timeupdate's
  // ~4Hz cadence) so the progress bar and time labels re-render as the
  // video plays. Reset whenever the video URL changes (the <video> element
  // remounts via its key).
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
  }, [current?.url]);

  function seekTo(seconds: number) {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    const t = Math.min(Math.max(0, seconds), Math.max(0, el.duration - 0.1));
    el.currentTime = t;
    setCurrentTime(t);
    lastTimeRef.current = t;
  }

  // Keep a snapshot of the latest playback state so the unmount cleanup can
  // persist it without stale-closure issues. The timestamp is read straight
  // off the <video> element at save time.
  const snapshotRef = useRef<Omit<PlaybackMemory, "time">>({
    urls: [],
    order: [],
    pos: 0,
    currentUrl: "",
    playing: true,
    muted: startMuted,
    volume: 0.7,
  });
  snapshotRef.current = {
    urls: videos.map((v) => v.url),
    order,
    pos,
    currentUrl: current?.url ?? "",
    playing,
    muted,
    volume,
    ...(overrideQueue && overrideQueue.length > 0
      ? { queue: overrideQueue }
      : {}),
  };

  // Latest known playback timestamp. Tracked separately because by the time
  // the unmount cleanup runs, React has already detached videoRef.
  const lastTimeRef = useRef(0);

  // Kept in a ref so the save/visibility handlers below never go stale
  // without having to re-register listeners when the setting changes.
  const pageSwitchMuteRef = useRef(pageSwitchMute);
  pageSwitchMuteRef.current = pageSwitchMute;

  useEffect(() => {
    const tileId = tile.id;
    const save = () => {
      const snap = snapshotRef.current;
      if (!snap.currentUrl) return;
      savePlaybackMemory(tileId, {
        ...snap,
        // Auto-mute on page switch: the memory written when leaving forces
        // muted so the player resumes silently when the user comes back.
        muted: pageSwitchMuteRef.current ? true : snap.muted,
        time: videoRef.current?.currentTime ?? lastTimeRef.current,
      });
    };
    // Save when the tab is hidden or the page is being unloaded (reload,
    // navigation away, browser close) so the position survives a full
    // refresh — plus on unmount for in-app page switches.
    document.addEventListener("visibilitychange", save);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", save);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [tile.id]);

  // Live half of auto-mute: switching browser tabs doesn't unmount the tile,
  // so audio would keep playing — mute as soon as the document hides.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && pageSwitchMuteRef.current) setMuted(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () =>
      document.removeEventListener("visibilitychange", onVisibility);
  }, []);

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

  // ── HLS playback (ErsatzTV live channels) ─────────────────────────────────
  // .m3u8 playlists don't play via a bare src attribute in most browsers.
  // Where the browser supports HLS natively (Safari) the src attribute is
  // kept; everywhere else hls.js is loaded lazily and attached to the
  // element. Fatal HLS errors surface the same explicit error state as a
  // broken direct-play video.
  const currentUrl = current?.url ?? null;
  const isHlsUrl = !!currentUrl && currentUrl.includes(".m3u8");
  const nativeHls =
    typeof document !== "undefined" &&
    document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "";
  // Full re-attach retries that happen automatically (no user click) after
  // one hls.js instance exhausts its in-instance recovery budget. Persisted
  // across attach-effect runs; reset by healthy playback or a manual Retry.
  const autoReattachRef = useRef(0);
  // ── Tune-in grace window ──────────────────────────────────────────────────
  // ErsatzTV takes several seconds to spin up its transcoder when a channel
  // is first tuned, and hls.js reports those early failed playlist/segment
  // fetches as fatal errors. Until the first fragment buffers (tunedRef),
  // fatal errors within TUNE_GRACE_MS of tuning keep re-attaching quietly
  // behind a "Tuning…" hint instead of consuming the auto-reattach budget or
  // surfacing the error screen. Mid-playback recovery (after tunedRef flips
  // true) is unchanged.
  const TUNE_GRACE_MS = 45_000;
  const TUNE_RETRY_DELAY_MS = 2_000;
  const tuneStartRef = useRef(Date.now());
  const tunedRef = useRef(false);
  // Drives the badge label ("Tuning…" vs "Reconnecting…"). State, not a ref,
  // because the badge must re-render when the first fragment buffers.
  const [tuning, setTuning] = useState(true);
  // Render-phase reset on channel change: clearing mediaFailed here (rather
  // than in an effect) guarantees the <video> element is back in the tree
  // before the attach effect runs, so tuning away from a dead channel
  // immediately drops the error screen and re-attaches.
  const prevTuneUrlRef = useRef(currentUrl);
  if (prevTuneUrlRef.current !== currentUrl) {
    prevTuneUrlRef.current = currentUrl;
    tuneStartRef.current = Date.now();
    tunedRef.current = false;
    autoReattachRef.current = 0;
    setTuning(true);
    if (mediaFailed) setMediaFailed(false);
  }
  // Tuning banner: while the tune-in grace window is active on a live
  // channel (no fragment buffered yet), the frame is just black — show a
  // TV-style banner with the channel number, name, and current programme
  // instead of only the tiny "Tuning…" badge. Purely presentational; the
  // retry/error handling above is untouched.
  const showTuningBanner =
    isErsatz &&
    !demo &&
    isHlsUrl &&
    tuning &&
    !stopped &&
    !mediaFailed &&
    !!tunedErsatz;
  // Banner linger: like a real TV, keep the banner on screen a few seconds
  // after the picture appears so the viewer can confirm what they tuned to,
  // then fade it out. Linger starts only on the tuning→playing transition
  // (not when the banner disappears because of stop/error/channel change),
  // and a new channel change cancels any in-flight linger immediately.
  const BANNER_LINGER_MS = 4_000;
  const BANNER_FADE_MS = 700;
  const [bannerLinger, setBannerLinger] = useState(false);
  const [bannerFading, setBannerFading] = useState(false);
  const prevShowBannerRef = useRef(showTuningBanner);
  useEffect(() => {
    const wasShowing = prevShowBannerRef.current;
    prevShowBannerRef.current = showTuningBanner;
    if (showTuningBanner) {
      // Banner is back (new tune-in): drop any leftover linger state.
      setBannerLinger(false);
      setBannerFading(false);
      return;
    }
    // Only linger when the banner left because playback actually started.
    if (!wasShowing || tuning || stopped || mediaFailed) return;
    setBannerLinger(true);
    setBannerFading(false);
    const fadeTimer = window.setTimeout(
      () => setBannerFading(true),
      BANNER_LINGER_MS - BANNER_FADE_MS,
    );
    const hideTimer = window.setTimeout(() => {
      setBannerLinger(false);
      setBannerFading(false);
    }, BANNER_LINGER_MS);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(hideTimer);
    };
  }, [showTuningBanner, tuning, stopped, mediaFailed]);
  // Stop/error/channel switch mid-linger: hide instantly, no stale banner.
  useEffect(() => {
    if ((stopped || mediaFailed) && bannerLinger) {
      setBannerLinger(false);
      setBannerFading(false);
    }
  }, [stopped, mediaFailed, bannerLinger]);
  useEffect(() => {
    if (!currentUrl || !isHlsUrl || nativeHls || stopped) return;
    const el = videoRef.current;
    if (!el) return;
    let cancelled = false;
    let reattachTimer: number | null = null;
    let hls: import("hls.js").default | null = null;
    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        if (!demo) setMediaFailed(true);
        return;
      }
      hls = new Hls({ liveDurationInfinity: true });
      // Recoverable-error handling: hls.js flags errors as fatal when it has
      // given up retrying internally, but many of those are still salvageable
      // — a network blip or server restart can be resumed with startLoad(),
      // and a decode hiccup with recoverMediaError(). Attempt a bounded
      // number of recoveries per error type; when that budget is exhausted,
      // tear the instance down and automatically re-attach a fresh one after
      // a short pause (up to 3 times) before ever surfacing the explicit
      // error state — a lagging live stream should self-heal, not demand a
      // manual Retry click. Healthy buffered fragments reset every budget so
      // a long-running stream survives repeated (spaced-out) stalls.
      let networkRecoveries = 0;
      let mediaRecoveries = 0;
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        networkRecoveries = 0;
        mediaRecoveries = 0;
        autoReattachRef.current = 0;
        // The channel is really playing now — tune-in is over; later errors
        // follow the normal mid-playback recovery path.
        tunedRef.current = true;
        setTuning(false);
        // Playback is flowing again — clear the "Reconnecting…" hint.
        setHlsReconnecting(false);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || !hls) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveries < 3) {
          networkRecoveries += 1;
          setHlsReconnecting(true);
          hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 3) {
          mediaRecoveries += 1;
          setHlsReconnecting(true);
          hls.recoverMediaError();
          return;
        }
        // In-instance budget exhausted: destroy and re-attach fresh, with a
        // short pause so a struggling server isn't hammered.
        hls.destroy();
        hls = null;
        // While still inside the tune-in grace window (channel never
        // buffered a fragment yet), keep retrying without consuming the
        // auto-reattach budget — the transcoder just needs time to start.
        const inTuneGrace =
          !tunedRef.current &&
          Date.now() - tuneStartRef.current < TUNE_GRACE_MS;
        if (inTuneGrace || autoReattachRef.current < 3) {
          if (!inTuneGrace) autoReattachRef.current += 1;
          setHlsReconnecting(true);
          reattachTimer = window.setTimeout(
            () => {
              reattachTimer = null;
              setHlsRetryNonce((n) => n + 1);
            },
            inTuneGrace ? TUNE_RETRY_DELAY_MS : 4000,
          );
          return;
        }
        setHlsReconnecting(false);
        if (!demo) setMediaFailed(true);
      });
      hls.loadSource(currentUrl);
      hls.attachMedia(el);
    });
    return () => {
      cancelled = true;
      if (reattachTimer != null) window.clearTimeout(reattachTimer);
      hls?.destroy();
      hls = null;
      // A stale hint must not survive a channel change or a fresh attach.
      setHlsReconnecting(false);
    };
  }, [currentUrl, isHlsUrl, nativeHls, demo, hlsRetryNonce, stopped]);

  // A channel change starts over with a clean slate for auto-reattaches and
  // any leftover Stop state from the previous channel.
  useEffect(() => {
    autoReattachRef.current = 0;
    setStopped(false);
    setBuffering(false);
  }, [currentUrl]);

  // Audio-without-video detection for live HLS streams. If the stream has
  // been playing for a few seconds and the element still reports
  // videoWidth === 0, the audio track decoded but the video track didn't —
  // in practice the channel's FFmpeg profile emits a codec the browser
  // can't decode. The element fires `resize` when the video track appears,
  // which clears the hint immediately.
  useEffect(() => {
    setAudioOnly(false);
    if (!currentUrl || !isHlsUrl) return;
    const el = videoRef.current;
    if (!el) return;
    const update = () => {
      setAudioOnly(el.videoWidth === 0 && !el.paused && el.currentTime > 3);
    };
    const timer = window.setInterval(update, 4000);
    el.addEventListener("resize", update);
    return () => {
      window.clearInterval(timer);
      el.removeEventListener("resize", update);
    };
  }, [currentUrl, isHlsUrl, hlsRetryNonce]);

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

  // Jump straight to a specific spot in the play order (playlist pop-out).
  // Discards any pending saved-resume memory so the picked entry starts at
  // its remembered-free position rather than resurrecting an old timestamp.
  function jumpTo(orderIdx: number) {
    if (orderIdx < 0 || orderIdx >= order.length) return;
    savedRef.current = null;
    if (orderIdx === pos) {
      // Re-picking the current entry restarts it from the top.
      const el = videoRef.current;
      if (el) el.currentTime = 0;
      lastTimeRef.current = 0;
      setCurrentTime(0);
    } else {
      setPos(orderIdx);
    }
    setPlaying(true);
  }

  // "Restart from beginning": intentionally forget the saved spot. Clears
  // the persisted playback memory for this tile, resets the play order
  // (fresh shuffle when enabled) back to the first entry, and rewinds the
  // current element to 0:00 in case the first video is already showing
  // (a position reset alone wouldn't remount the <video>).
  function restartFromBeginning() {
    savedRef.current = null;
    clearPlaybackMemory(tile.id);
    const base = videos.map((_, i) => i);
    setOrder(shuffle && playMode === "playlist" ? shuffled(base) : base);
    setPos(0);
    const el = videoRef.current;
    if (el) {
      el.currentTime = 0;
    }
    lastTimeRef.current = 0;
    setCurrentTime(0);
    setPlaying(true);
  }

  // Queue handed over by the Plex drill-down browser. If it matches the
  // current list, just jump; otherwise swap the tile's video list for the
  // picked queue (the play-order effect consumes the pending start index).
  function playFromBrowser(entries: VideoEntry[], startIndex: number) {
    if (entries.length === 0) return;
    const urls = entries.map((e) => e.url);
    if (
      sameUrls(
        urls,
        videos.map((v) => v.url),
      )
    ) {
      const orderIdx = order.indexOf(startIndex);
      jumpTo(orderIdx >= 0 ? orderIdx : 0);
    } else {
      savedRef.current = null;
      pendingStartRef.current = startIndex;
      setOverrideQueue(entries);
      setPlaying(true);
    }
    setBrowserOpen(false);
  }

  // Whether this tile uses the drill-down browser instead of the flat
  // pop-out: Plex and Jellyfin (other sources keep their flat playlist).
  const usesBrowser = (source === "plex" || source === "jellyfin") && !!libraryId;

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
        <span>
          {mediaFailed ? "Video failed to load" : "Videos unavailable"}
        </span>
        {mediaFailed && (
          <button
            type="button"
            data-testid="videoplayer-retry"
            onClick={() => {
              setMediaFailed(false);
              setBuffering(false);
              autoReattachRef.current = 0;
              setHlsRetryNonce((n) => n + 1);
              setPlaying(true);
            }}
            className="mt-1 flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent"
          >
            <RotateCw className="w-3 h-3" />
            Retry
          </button>
        )}
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
  } else if (
    (isServerSource &&
      libraryId &&
      !playlistQuery.data &&
      playlistQuery.isLoading) ||
    (isErsatz && !ersatzQuery.data && ersatzQuery.isLoading)
  ) {
    body = (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm bg-black/80">
        Loading videos…
      </div>
    );
  } else {
    body = (
      <div className="relative w-full h-full overflow-hidden bg-black group">
        {current && !(stopped && isHlsUrl) && (
          <video
            key={current.url}
            ref={videoRef}
            // hls.js (non-native HLS) attaches its own MediaSource; setting a
            // src attribute alongside it would race the attach.
            src={isHlsUrl && !nativeHls ? undefined : current.url}
            data-testid="videoplayer-video"
            data-video-id={current.id}
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: fit }}
            autoPlay
            playsInline
            muted={muted}
            loop={loopSingle}
            onTimeUpdate={(e) => {
              lastTimeRef.current = e.currentTarget.currentTime;
              setCurrentTime(e.currentTarget.currentTime);
            }}
            onSeeked={(e) => {
              lastTimeRef.current = e.currentTarget.currentTime;
              setCurrentTime(e.currentTarget.currentTime);
            }}
            onDurationChange={(e) => {
              const d = e.currentTarget.duration;
              setDuration(Number.isFinite(d) ? d : 0);
            }}
            onLoadedMetadata={(e) => {
              // Resume from the remembered timestamp (consumed once) when the
              // restored video is the same one that was playing before the
              // tile unmounted.
              // A new element just loaded — don't let a stale timestamp from
              // the previous video leak into a save for this one.
              lastTimeRef.current = e.currentTarget.currentTime;
              const saved = savedRef.current;
              if (!saved) return;
              if (saved.currentUrl === current.url) {
                const el = e.currentTarget;
                if (saved.time > 0) {
                  // Clamp just shy of the end so resuming never instantly
                  // fires `ended` (which would skip to the next video).
                  el.currentTime = Number.isFinite(el.duration)
                    ? Math.min(saved.time, Math.max(0, el.duration - 0.1))
                    : saved.time;
                }
                savedRef.current = null;
              } else if (
                !sameUrls(
                  saved.urls,
                  videos.map((v) => v.url),
                )
              ) {
                // Playlist changed since the memory was written — stale.
                // Drop it from the persistent store too so it can't linger.
                savedRef.current = null;
                clearPlaybackMemory(tile.id);
              }
            }}
            onEnded={() => {
              if (!loopSingle) advance(1);
            }}
            onError={() => {
              // Only configured sources surface the error state; if the
              // built-in yule log itself can't load (offline box) there is
              // nothing better to fall back to, so stay quiet.
              if (demo) return;
              // Element-level errors during the tune-in grace window of a
              // live HLS channel are retried quietly (fresh attach) instead
              // of flashing the error screen — same policy as fatal hls.js
              // errors while the transcoder spins up.
              if (
                isHlsUrl &&
                !tunedRef.current &&
                Date.now() - tuneStartRef.current < TUNE_GRACE_MS
              ) {
                setHlsReconnecting(true);
                setHlsRetryNonce((n) => n + 1);
                return;
              }
              setMediaFailed(true);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onWaiting={() => {
              if (isHlsUrl) setBuffering(true);
            }}
            onPlaying={() => {
              setBuffering(false);
              // Native-HLS browsers (Safari) never fire hls.js events, so
              // the banner is also cleared as soon as playback starts.
              setTuning(false);
            }}
          />
        )}
        {stopped && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/80 text-white/80"
            data-testid="videoplayer-stopped"
          >
            <VideoOff className="w-5 h-5 opacity-60" />
            <span className="text-xs">Stream stopped</span>
            <button
              type="button"
              data-testid="videoplayer-resume"
              onClick={() => {
                autoReattachRef.current = 0;
                setStopped(false);
                setPlaying(true);
              }}
              className="mt-1 flex items-center gap-1.5 rounded-md border border-white/25 px-2.5 py-1 text-xs text-white hover:bg-white/10"
            >
              <Play className="w-3 h-3" />
              Resume
            </button>
          </div>
        )}
        {buffering && !stopped && !hlsReconnecting && !mediaFailed && (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
            data-testid="videoplayer-buffering"
          >
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/70 border-t-transparent" />
          </div>
        )}
        {(showTuningBanner || bannerLinger) && tunedErsatz && (
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/85 via-black/55 to-transparent px-3 pb-8 pt-2.5 transition-opacity duration-700 ${bannerFading ? "opacity-0" : "opacity-100"}`}
            data-testid="videoplayer-tuning-banner"
          >
            <div className="flex items-center gap-2">
              <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-sm font-bold tabular-nums text-white">
                {tunedErsatz.number}
              </span>
              <span className="min-w-0 truncate text-sm font-semibold text-white">
                {tunedErsatz.name}
              </span>
              {showTuningBanner && (
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-white/80">
                  <span className="h-2 w-2 animate-spin rounded-full border border-white/70 border-t-transparent" />
                  Tuning…
                </span>
              )}
            </div>
            {tunedErsatz.nowPlaying && (
              <p className="mt-1 truncate text-xs text-white/70">
                Now: {tunedErsatz.nowPlaying}
              </p>
            )}
            {tunedErsatz.upNextTitle && (
              <p
                className="truncate text-xs text-white/50"
                data-testid="videoplayer-banner-upnext"
              >
                Up next: {tunedErsatz.upNextTitle}
                {formatGuideTime(tunedErsatz.upNextStart) &&
                  ` · ${formatGuideTime(tunedErsatz.upNextStart)}`}
              </p>
            )}
          </div>
        )}
        {hlsReconnecting && !showTuningBanner && !bannerLinger && (
          <span
            className="pointer-events-none absolute top-1.5 left-1.5 z-10 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-[10px] font-medium text-white/90 backdrop-blur-sm"
            data-testid="videoplayer-reconnecting-badge"
          >
            <span className="h-2 w-2 animate-spin rounded-full border border-white/70 border-t-transparent" />
            {tuning ? "Tuning…" : "Reconnecting…"}
          </span>
        )}
        {audioOnly && !hlsReconnecting && (
          <span
            className="pointer-events-none absolute top-1.5 left-1.5 z-10 max-w-[85%] rounded bg-black/60 px-2 py-1 text-[10px] font-medium leading-snug text-white/90 backdrop-blur-sm"
            data-testid="videoplayer-audioonly-badge"
          >
            Audio only — this browser can't decode the channel's video codec.
            In ErsatzTV, use an FFmpeg profile with H.264 video.
          </span>
        )}
        {demo && (
          <span
            className="absolute top-1.5 right-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/80"
            data-testid="videoplayer-demo-badge"
          >
            Yule log
          </span>
        )}
        {!editMode && usesBrowser && (
          <Suspense fallback={null}>
            <VideoBrowser
              open={browserOpen}
              onOpenChange={setBrowserOpen}
              onPlay={playFromBrowser}
              server={source === "jellyfin" ? "jellyfin" : "plex"}
            />
          </Suspense>
        )}
        {!editMode && isErsatz && channelsOpen && ersatzChannels.length > 0 && (
          <Suspense fallback={null}>
            <ErsatzGuideGrid
              channels={ersatzChannels}
              currentNumber={
                ersatzChannels.find(
                  (c) => current?.id === `ersatztv-${c.number}`,
                )?.number ?? null
              }
              nowMs={guideNow}
              onTune={tuneChannel}
              onClose={() => setChannelsOpen(false)}
            />
          </Suspense>
        )}
        {!editMode && !usesBrowser && playlistOpen && count > 1 && (
          <div
            className="absolute inset-x-2 bottom-[60px] top-2 z-10 flex flex-col overflow-hidden rounded-md border border-white/10 bg-black/90 backdrop-blur-sm"
            data-testid="videoplayer-playlist"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-2.5 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
                Playlist ({count})
              </span>
              <button
                type="button"
                aria-label="Close playlist"
                data-testid="videoplayer-playlist-close"
                onClick={() => setPlaylistOpen(false)}
                className="rounded px-1.5 text-[13px] leading-none text-white/60 hover:text-white"
              >
                ✕
              </button>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto py-1">
              {order.map((videoIdx, orderIdx) => {
                const entry = videos[videoIdx];
                if (!entry) return null;
                const isCurrent = orderIdx === pos % order.length;
                return (
                  <li key={`${entry.id}-${orderIdx}`}>
                    <button
                      type="button"
                      data-testid="videoplayer-playlist-entry"
                      data-current={isCurrent ? "true" : undefined}
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={() => {
                        jumpTo(orderIdx);
                        setPlaylistOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 border-l-2 px-2.5 py-1.5 text-left text-[11px] leading-tight transition-colors ${
                        isCurrent
                          ? "border-white/70 bg-white/15 text-white"
                          : "border-transparent text-white/70 hover:bg-white/10 hover:text-white"
                      }`}
                      ref={
                        isCurrent
                          ? (el) => el?.scrollIntoView({ block: "nearest" })
                          : undefined
                      }
                    >
                      <span className="w-5 shrink-0 text-right tabular-nums text-white/40">
                        {orderIdx + 1}
                      </span>
                      {isCurrent ? (
                        <Play className="h-3 w-3 shrink-0 fill-current" />
                      ) : (
                        <span className="w-3 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {entry.title}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {!editMode && (
          <div
            className={`absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 transition-opacity ${
              playlistOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="min-w-[30px] text-right text-[10px] tabular-nums text-white/80"
                data-testid="videoplayer-time-current"
              >
                {formatClock(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration > 0 ? duration : 0}
                step={0.1}
                value={Math.min(currentTime, duration > 0 ? duration : 0)}
                disabled={duration <= 0}
                aria-label="Seek"
                data-testid="videoplayer-seek"
                onChange={(e) => seekTo(Number(e.target.value))}
                className="h-1 min-w-0 flex-1 accent-white/90 disabled:opacity-40"
              />
              <span
                className="min-w-[30px] text-[10px] tabular-nums text-white/60"
                data-testid="videoplayer-time-duration"
              >
                {formatClock(duration)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {count > 1 && (
                <button
                  type="button"
                  aria-label="Previous video"
                  data-testid="videoplayer-prev"
                  onClick={() =>
                    setPos(
                      (((pos - 1) % order.length) + order.length) %
                        order.length,
                    )
                  }
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
                {playing ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
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
                {muted ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>
              {isErsatz && !demo && (
                <button
                  type="button"
                  aria-label={stopped ? "Resume stream" : "Stop stream"}
                  title={
                    stopped
                      ? "Resume the live stream"
                      : "Stop the stream (frees the ErsatzTV transcoder)"
                  }
                  data-testid="videoplayer-stop"
                  onClick={() => {
                    if (stopped) {
                      autoReattachRef.current = 0;
                      setStopped(false);
                      setPlaying(true);
                    } else {
                      setStopped(true);
                      setPlaying(false);
                      setBuffering(false);
                    }
                  }}
                  className={`rounded-full p-1 text-white hover:bg-black/60 ${
                    stopped ? "bg-white/25" : "bg-black/40"
                  }`}
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              )}
              {isErsatz && ersatzChannels.length > 1 && (
                <button
                  type="button"
                  aria-label={channelsOpen ? "Hide channels" : "Show channels"}
                  title={channelsOpen ? "Hide channels" : "Show channels"}
                  data-testid="videoplayer-channels-toggle"
                  onClick={() => setChannelsOpen((o) => !o)}
                  className={`rounded-full p-1 text-white hover:bg-black/60 ${
                    channelsOpen ? "bg-white/25" : "bg-black/40"
                  }`}
                >
                  <Tv className="w-3.5 h-3.5" />
                </button>
              )}
              {usesBrowser ? (
                <button
                  type="button"
                  aria-label="Browse videos"
                  title="Browse videos"
                  data-testid="videoplayer-playlist-toggle"
                  onClick={() => setBrowserOpen(true)}
                  className={`rounded-full p-1 text-white hover:bg-black/60 ${
                    browserOpen ? "bg-white/25" : "bg-black/40"
                  }`}
                >
                  <ListVideo className="w-3.5 h-3.5" />
                </button>
              ) : (
                count > 1 && (
                  <button
                    type="button"
                    aria-label={
                      playlistOpen ? "Hide playlist" : "Show playlist"
                    }
                    title={playlistOpen ? "Hide playlist" : "Show playlist"}
                    data-testid="videoplayer-playlist-toggle"
                    onClick={() => setPlaylistOpen((o) => !o)}
                    className={`rounded-full p-1 text-white hover:bg-black/60 ${
                      playlistOpen ? "bg-white/25" : "bg-black/40"
                    }`}
                  >
                    <ListVideo className="w-3.5 h-3.5" />
                  </button>
                )
              )}
              <button
                type="button"
                aria-label="Restart from beginning"
                title="Restart from beginning"
                data-testid="videoplayer-restart"
                onClick={restartFromBeginning}
                className="rounded-full bg-black/40 p-1 text-white hover:bg-black/60"
              >
                <RotateCcw className="w-3.5 h-3.5" />
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
                <span className="ml-auto flex max-w-[45%] min-w-0 flex-col items-end">
                  <span className="max-w-full truncate text-[10px] text-white/80">
                    {current.title}
                  </span>
                  {isErsatz && tunedProgress && (
                    <span
                      className="flex w-full max-w-full items-center justify-end gap-1.5"
                      data-testid="videoplayer-progress"
                    >
                      <span className="h-0.5 w-12 shrink-0 overflow-hidden rounded-full bg-white/20">
                        <span
                          className="block h-full rounded-full bg-white/70"
                          style={{ width: `${Math.round(tunedProgress.fraction * 100)}%` }}
                        />
                      </span>
                      <span className="truncate text-[9px] text-white/55">
                        {tunedProgress.endsIn}
                      </span>
                    </span>
                  )}
                  {isErsatz && tunedErsatz?.upNextTitle && (
                    <span
                      className="max-w-full truncate text-[9px] text-white/55"
                      data-testid="videoplayer-upnext"
                    >
                      Up next: {tunedErsatz.upNextTitle}
                      {formatGuideTime(tunedErsatz.upNextStart) &&
                        ` · ${formatGuideTime(tunedErsatz.upNextStart)}`}
                    </span>
                  )}
                </span>
              )}
            </div>
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
