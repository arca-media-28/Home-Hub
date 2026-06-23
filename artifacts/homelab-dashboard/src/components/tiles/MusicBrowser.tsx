import { useCallback, useEffect, useMemo, useState } from "react";
import {
  searchAudioLibrary,
  browseAudioLibrary,
} from "@workspace/api-client-react";
import type {
  AudioBrowseResult,
  AudioContainer,
  AudioTrack,
  BrowseAudioLibraryKind,
  BrowseAudioLibrarySource,
} from "@workspace/api-client-react";
import { ChevronRight, ListPlus, Music, Play, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAudioPlayer } from "@/lib/audioPlayer";
import { fmtTime } from "./audioShared";

// Which library-navigation tabs a tile's music browser offers. All default on;
// the edit modal lets the user hide any of them per tile.
export interface MusicBrowserTabs {
  search: boolean;
  browse: boolean;
  playlists: boolean;
}

type Tab = "search" | "browse" | "playlists";
type BrowseRoot = "recent" | "albums" | "artists";

// A single fetch the browser can run, kept on a navigation stack so drilling
// in (artist → albums → tracks) and stepping back via breadcrumbs is trivial.
type Loader =
  | { type: "search"; query: string; title: string }
  | { type: "browse"; kind: BrowseAudioLibraryKind; id?: string; title: string };

const ROOT_LABELS: Record<BrowseRoot, string> = {
  recent: "Recently added",
  albums: "Albums",
  artists: "Artists",
};

// Cover art for a container (album / artist / playlist). Falls back to a glyph.
function ContainerArt({ container, size }: { container: AudioContainer; size: number }) {
  const style = { width: size, height: size };
  if (container.artwork) {
    return (
      <img
        src={container.artwork}
        alt=""
        style={style}
        className={`flex-shrink-0 bg-muted object-cover ${container.kind === "artist" ? "rounded-full" : "rounded"}`}
      />
    );
  }
  return (
    <div
      style={style}
      className={`flex flex-shrink-0 items-center justify-center bg-muted text-muted-foreground ${container.kind === "artist" ? "rounded-full" : "rounded"}`}
    >
      <Music size={Math.round(size * 0.4)} aria-hidden="true" />
    </div>
  );
}

export default function MusicBrowser({
  source,
  ownerId,
  tabs,
  open,
  onOpenChange,
}: {
  source: "plex" | "subsonic";
  ownerId: string;
  tabs: MusicBrowserTabs;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const player = useAudioPlayer();
  const available = useMemo(
    () => (["search", "browse", "playlists"] as Tab[]).filter((t) => tabs[t]),
    [tabs.search, tabs.browse, tabs.playlists],
  );
  const [tab, setTab] = useState<Tab>(available[0] ?? "search");

  // Keep the active tab in sync with the enabled set: if a tile edit disables the
  // current tab, fall back to the first still-enabled one so users never strand
  // on a hidden/disabled mode.
  useEffect(() => {
    if (available.length > 0 && !available.includes(tab)) {
      setTab(available[0]!);
    }
  }, [available, tab]);
  const [browseRoot, setBrowseRoot] = useState<BrowseRoot>("recent");
  const [searchInput, setSearchInput] = useState("");

  const [stack, setStack] = useState<Loader[]>([]);
  const [result, setResult] = useState<AudioBrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchLoader = useCallback(
    async (loader: Loader): Promise<AudioBrowseResult> => {
      const src = source as BrowseAudioLibrarySource;
      if (loader.type === "search") {
        return searchAudioLibrary({ source: src, query: loader.query });
      }
      return browseAudioLibrary({
        source: src,
        kind: loader.kind,
        ...(loader.id ? { id: loader.id } : {}),
      });
    },
    [source],
  );

  // Replace the navigation stack and load whatever is now on top.
  const loadStack = useCallback(
    async (next: Loader[]) => {
      setStack(next);
      const top = next[next.length - 1];
      if (!top) {
        setResult(null);
        setError(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(false);
      try {
        setResult(await fetchLoader(top));
      } catch {
        setError(true);
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [fetchLoader],
  );

  // Reset to a sensible root whenever the dialog opens or the tab changes.
  useEffect(() => {
    if (!open) return;
    if (tab === "search") {
      void loadStack([]);
    } else if (tab === "playlists") {
      void loadStack([{ type: "browse", kind: "playlists", title: "Playlists" }]);
    } else {
      void loadStack([
        { type: "browse", kind: browseRoot, title: ROOT_LABELS[browseRoot] },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, browseRoot]);

  const push = (loader: Loader) => void loadStack([...stack, loader]);
  const popTo = (index: number) => void loadStack(stack.slice(0, index + 1));

  // Drill into a container (artist → albums, album/playlist → tracks).
  const openContainer = (c: AudioContainer) => {
    if (c.kind === "artist") push({ type: "browse", kind: "artist", id: c.id, title: c.title });
    else if (c.kind === "album") push({ type: "browse", kind: "album", id: c.id, title: c.title });
    else push({ type: "browse", kind: "playlist", id: c.id, title: c.title });
  };

  // Resolve a container to a flat, ordered list of tracks. Albums and playlists
  // map directly to tracks; an artist has no direct tracks, so we fetch its
  // albums and concatenate each album's tracks (bounded fan-out, order kept).
  const resolveContainerTracks = useCallback(
    async (c: AudioContainer): Promise<AudioTrack[]> => {
      const src = source as BrowseAudioLibrarySource;
      if (c.kind === "album" || c.kind === "playlist") {
        const res = await browseAudioLibrary({ source: src, kind: c.kind, id: c.id });
        return res.tracks ?? [];
      }
      // artist → albums → tracks
      const artistRes = await browseAudioLibrary({ source: src, kind: "artist", id: c.id });
      const albums = (artistRes.albums ?? []).slice(0, 50);
      const perAlbum: AudioTrack[][] = new Array(albums.length).fill(null).map(() => []);
      const concurrency = 4;
      let cursor = 0;
      const worker = async () => {
        while (cursor < albums.length) {
          const i = cursor++;
          const album = albums[i]!;
          try {
            const res = await browseAudioLibrary({ source: src, kind: "album", id: album.id });
            perAlbum[i] = res.tracks ?? [];
          } catch {
            perAlbum[i] = [];
          }
        }
      };
      await Promise.all(
        new Array(Math.min(concurrency, albums.length)).fill(null).map(() => worker()),
      );
      return perAlbum.flat();
    },
    [source],
  );

  // Selecting a container loads it as the queue and starts playing. If nothing
  // playable comes back (e.g. demo / unconfigured), fall back to drilling in.
  // When `append` is set, the container's tracks are added to the end of the
  // current queue instead of replacing it, and the dialog stays open so users
  // can keep building up a listening session.
  const selectContainer = async (c: AudioContainer, append = false) => {
    setBusyId(c.id);
    setError(false);
    try {
      const fetched = await resolveContainerTracks(c);
      if (fetched.some((t) => Boolean(t.streamUrl))) {
        if (append) {
          player.enqueue(fetched, ownerId);
        } else {
          player.playQueue(fetched, 0, ownerId);
          onOpenChange(false);
        }
      } else {
        openContainer(c);
      }
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  };

  const playTracks = (tracks: AudioTrack[], startIndex: number) => {
    const playable = tracks.some((t) => Boolean(t.streamUrl));
    if (!playable) return;
    player.playQueue(tracks, startIndex < 0 ? 0 : startIndex, ownerId);
    onOpenChange(false);
  };

  // Append tracks to the end of the queue, keeping the dialog open so the user
  // can continue adding more.
  const enqueueTracks = (tracks: AudioTrack[]) => {
    const playable = tracks.some((t) => Boolean(t.streamUrl));
    if (!playable) return;
    player.enqueue(tracks, ownerId);
  };

  const submitSearch = () => {
    const q = searchInput.trim();
    if (!q) return;
    void loadStack([{ type: "search", query: q, title: `“${q}”` }]);
  };

  const tracks = result?.tracks ?? [];
  const artists = result?.artists ?? [];
  const albums = result?.albums ?? [];
  const playlists = result?.playlists ?? [];
  const sample = result?.sample ?? false;
  const canPlay = tracks.some((t) => Boolean(t.streamUrl));
  const isEmpty =
    !loading &&
    !error &&
    tracks.length === 0 &&
    artists.length === 0 &&
    albums.length === 0 &&
    playlists.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Find music</DialogTitle>
          <DialogDescription>
            Search and browse your {source === "plex" ? "Plex" : "Navidrome / Subsonic"}{" "}
            library, then load anything as the queue.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        {available.length > 1 && (
          <div className="flex gap-1 rounded-md bg-muted p-1">
            {available.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 rounded px-3 py-1.5 text-sm capitalize transition-colors ${
                  tab === t
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Search input */}
        {tab === "search" && (
          <div className="flex items-center gap-2 rounded-md border border-border px-2">
            <Search size={16} className="text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              autoFocus
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitSearch()}
              placeholder="Search artists, albums, tracks…"
              className="flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={submitSearch}
              className="rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:opacity-90"
            >
              Go
            </button>
          </div>
        )}

        {/* Browse root selector */}
        {tab === "browse" && (
          <div className="flex gap-1">
            {(Object.keys(ROOT_LABELS) as BrowseRoot[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setBrowseRoot(r)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  browseRoot === r
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {ROOT_LABELS[r]}
              </button>
            ))}
          </div>
        )}

        {/* Breadcrumbs (drill-down) */}
        {stack.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {stack.map((loader, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} aria-hidden="true" />}
                <button
                  type="button"
                  onClick={() => popTo(i)}
                  disabled={i === stack.length - 1}
                  className="max-w-[12rem] truncate hover:text-foreground disabled:font-medium disabled:text-foreground"
                >
                  {loader.title}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Results */}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {loading && (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          )}
          {error && (
            <div className="py-8 text-center text-sm text-destructive">
              Couldn’t reach the music source.
            </div>
          )}
          {!loading && !error && sample && (
            <div className="mb-2 rounded bg-muted/60 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Demo — connect {source === "plex" ? "Plex" : "Navidrome / Subsonic"} in Settings to browse your library
            </div>
          )}
          {isEmpty && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {tab === "search" && stack.length === 0
                ? "Type to search your library."
                : "Nothing here."}
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-4">
              {/* Tracks (with Play all) */}
              {tracks.length > 0 && (
                <div>
                  {tracks.length > 1 && (
                    <div className="mb-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => playTracks(tracks, 0)}
                        disabled={!canPlay}
                        className="flex items-center gap-1.5 rounded bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-40"
                      >
                        <Play size={12} /> Play all
                      </button>
                      <button
                        type="button"
                        onClick={() => enqueueTracks(tracks)}
                        disabled={!canPlay}
                        className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/60 disabled:opacity-40"
                      >
                        <ListPlus size={12} /> Add all to queue
                      </button>
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {tracks.map((t, i) => (
                      <div
                        key={t.id || i}
                        className="group flex w-full items-center gap-1 rounded pr-1 hover:bg-muted/60"
                      >
                        <button
                          type="button"
                          onClick={() => playTracks(tracks, i)}
                          disabled={!t.streamUrl}
                          title={`Play ${t.title}`}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left disabled:cursor-default"
                        >
                          <span className="w-5 flex-shrink-0 text-right text-xs tabular-nums text-muted-foreground group-hover:hidden">
                            {i + 1}
                          </span>
                          <Play size={12} className="hidden w-5 flex-shrink-0 text-primary group-hover:block" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm" title={t.title}>
                              {t.title}
                            </span>
                            {t.artist && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {t.artist}
                              </span>
                            )}
                          </span>
                          {t.durationMs != null && (
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {fmtTime(t.durationMs, "ms")}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => enqueueTracks([t])}
                          disabled={!t.streamUrl}
                          aria-label={`Add ${t.title} to queue`}
                          title={`Add ${t.title} to queue`}
                          className="flex-shrink-0 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-default disabled:opacity-0"
                        >
                          <ListPlus size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Containers */}
              {[
                { label: "Artists", items: artists },
                { label: "Albums", items: albums },
                { label: "Playlists", items: playlists },
              ]
                .filter((g) => g.items.length > 0)
                .map((g) => (
                  <div key={g.label}>
                    {(artists.length > 0 ? 1 : 0) +
                      (albums.length > 0 ? 1 : 0) +
                      (playlists.length > 0 ? 1 : 0) >
                      1 && (
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {g.label}
                      </div>
                    )}
                    <div className="space-y-0.5">
                      {g.items.map((c) => (
                        <div
                          key={c.id}
                          className="group flex items-center gap-1 rounded pr-1 hover:bg-muted/60"
                        >
                          <button
                            type="button"
                            onClick={() => selectContainer(c)}
                            disabled={busyId === c.id}
                            title={`Play ${c.title}`}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left disabled:opacity-60"
                          >
                            <ContainerArt container={c} size={36} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm" title={c.title}>
                                {c.title}
                              </span>
                              {c.subtitle && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {c.subtitle}
                                </span>
                              )}
                            </span>
                            {busyId !== c.id && (
                              <Play
                                size={14}
                                className="flex-shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => selectContainer(c, true)}
                            disabled={busyId === c.id}
                            aria-label={`Add ${c.title} to queue`}
                            title={`Add ${c.title} to queue`}
                            className="flex-shrink-0 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                          >
                            <ListPlus size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openContainer(c)}
                            aria-label={`Browse ${c.title}`}
                            title={`Browse ${c.title}`}
                            className="flex-shrink-0 rounded p-1.5 text-muted-foreground hover:text-foreground"
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
