import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AudioTrack } from "@workspace/api-client-react";

// ── Shared app-level audio playback engine ───────────────────────────────────
// A single <audio> element lives here, above the router, so playback persists as
// the user navigates between pages and only ever one stream plays at a time.
// Audio Player tiles drive it (load a queue, play/pause, skip, seek, volume) and
// read its live state to render now-playing. Keeping the element app-global —
// rather than inside a tile — is what lets sound keep going when a tile unmounts.

export interface AudioPlayerState {
  // The track currently loaded into the audio element (null when idle).
  currentTrack: AudioTrack | null;
  // The queue the current track belongs to, and its index within it, so
  // next/previous can step through it.
  queue: AudioTrack[];
  index: number;
  // True while the element is actually playing (not paused/idle).
  isPlaying: boolean;
  // Live playback position and length, in seconds (0 when unknown).
  currentTime: number;
  duration: number;
  // 0–1 output volume, persisted across reloads.
  volume: number;
  // The opaque owner id of whatever tile last started playback. Tiles compare it
  // to their own id to know whether the global player is "theirs" right now.
  ownerId: string | null;
}

export interface AudioPlayerControls extends AudioPlayerState {
  // Load a queue and start playing at startIndex. `ownerId` records which tile
  // started it. Tracks without a streamUrl (e.g. demo/sample data) cannot be
  // streamed; callers should guard before calling.
  playQueue: (tracks: AudioTrack[], startIndex: number, ownerId: string) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  // Seek to an absolute position in seconds.
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
}

const AudioPlayerContext = createContext<AudioPlayerControls | null>(null);

const VOLUME_KEY = "audioPlayer.volume";

function readStoredVolume(): number {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(VOLUME_KEY) : null;
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 1;
}

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  // The single, persistent audio element. Created lazily on first use so SSR /
  // first paint never touches the DOM API.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const getAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = "metadata";
      el.volume = readStoredVolume();
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  const [queue, setQueue] = useState<AudioTrack[]>([]);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState<number>(readStoredVolume);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  const currentTrack = queue[index] ?? null;

  // Mirror queue/index into refs so the (stable) element event handlers can read
  // the latest values without being re-bound on every change.
  const queueRef = useRef<AudioTrack[]>(queue);
  const indexRef = useRef(index);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Load and play a specific index of the current/given queue. Always points the
  // element at a fresh src so switching tracks restarts cleanly.
  const loadAndPlay = useCallback(
    (tracks: AudioTrack[], i: number) => {
      const track = tracks[i];
      if (!track?.streamUrl) return;
      const el = getAudio();
      el.src = track.streamUrl;
      el.currentTime = 0;
      void el.play().catch(() => {
        // Autoplay or network failure — reflect the not-playing state instead of
        // throwing; the user can retry via the play button.
        setIsPlaying(false);
      });
    },
    [getAudio],
  );

  const playQueue = useCallback(
    (tracks: AudioTrack[], startIndex: number, owner: string) => {
      const playable = tracks.filter((t) => Boolean(t.streamUrl));
      if (playable.length === 0) return;
      // Re-map startIndex onto the playable-only list so non-streamable rows
      // (should not happen for a real source) never strand the player.
      const target = tracks[startIndex]?.streamUrl
        ? playable.findIndex((t) => t.id === tracks[startIndex]?.id)
        : 0;
      const i = target < 0 ? 0 : target;
      setQueue(playable);
      setIndex(i);
      setOwnerId(owner);
      loadAndPlay(playable, i);
    },
    [loadAndPlay],
  );

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || !currentTrack) return;
    if (el.paused) {
      void el.play().catch(() => setIsPlaying(false));
    } else {
      el.pause();
    }
  }, [currentTrack]);

  const next = useCallback(() => {
    if (queue.length === 0) return;
    const i = index + 1;
    if (i >= queue.length) return;
    setIndex(i);
    loadAndPlay(queue, i);
  }, [queue, index, loadAndPlay]);

  const prev = useCallback(() => {
    if (queue.length === 0) return;
    const el = audioRef.current;
    // Standard behavior: if more than ~3s into the track, restart it; otherwise
    // jump to the previous track.
    if (el && el.currentTime > 3) {
      el.currentTime = 0;
      return;
    }
    const i = index - 1;
    if (i < 0) {
      if (el) el.currentTime = 0;
      return;
    }
    setIndex(i);
    loadAndPlay(queue, i);
  }, [queue, index, loadAndPlay]);

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(seconds)) return;
    el.currentTime = Math.max(0, seconds);
    setCurrentTime(el.currentTime);
  }, []);

  const setVolume = useCallback(
    (v: number) => {
      const clamped = Math.max(0, Math.min(1, v));
      getAudio().volume = clamped;
      setVolumeState(clamped);
      try {
        localStorage.setItem(VOLUME_KEY, String(clamped));
      } catch {
        // Ignore storage failures (private mode etc.) — volume still applies.
      }
    },
    [getAudio],
  );

  // Wire element events to React state. Bound once; the element persists for the
  // app's lifetime so listeners never need rebinding.
  useEffect(() => {
    const el = getAudio();
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(el.currentTime);
    const onMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    // Auto-advance to the next track when one finishes.
    const onEnded = () => {
      const q = queueRef.current;
      const nextIndex = indexRef.current + 1;
      if (nextIndex < q.length) {
        setIndex(nextIndex);
        loadAndPlay(q, nextIndex);
      } else {
        setIsPlaying(false);
      }
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("ended", onEnded);
    };
  }, [getAudio, loadAndPlay]);

  const value = useMemo<AudioPlayerControls>(
    () => ({
      currentTrack,
      queue,
      index,
      isPlaying,
      currentTime,
      duration,
      volume,
      ownerId,
      playQueue,
      togglePlay,
      next,
      prev,
      seek,
      setVolume,
    }),
    [
      currentTrack,
      queue,
      index,
      isPlaying,
      currentTime,
      duration,
      volume,
      ownerId,
      playQueue,
      togglePlay,
      next,
      prev,
      seek,
      setVolume,
    ],
  );

  return <AudioPlayerContext.Provider value={value}>{children}</AudioPlayerContext.Provider>;
}

export function useAudioPlayer(): AudioPlayerControls {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) {
    throw new Error("useAudioPlayer must be used within an AudioPlayerProvider");
  }
  return ctx;
}
