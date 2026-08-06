import { useCallback, useEffect, useState } from "react";
import {
  getVideoLibraries,
  browseVideoLibrary,
} from "@workspace/api-client-react";
import type {
  VideoItem,
  VideoContainer,
  VideoLibrary,
} from "@workspace/api-client-react";
import { ArrowLeft, Clapperboard, Film, Play, Search, Tv, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { VideoEntry } from "./VideoPlayerTile";
import { formatClock } from "./VideoPlayerTile";

// ---------------------------------------------------------------------------
// VideoBrowser: a wide, Plex-web-style two-pane browser for the Video Player
// tile's Plex/Jellyfin sources. The left sidebar lists the server's video
// libraries; the right pane shows a large poster grid for the selection.
// TV libraries drill show → seasons → episodes (with back navigation);
// movie libraries show a playable poster grid directly. Hovering a show or
// season poster reveals a Play button that queues the whole container;
// clicking the poster itself drills in. Clicking a movie/episode plays it.
// ---------------------------------------------------------------------------

// What the right pane is currently showing, as a small navigation stack so
// "back" is a single pop. The bottom entry is always the library root.
type Level =
  | { type: "shows"; libraryId: string; title: string }
  | { type: "movies"; libraryId: string; title: string }
  | { type: "seasons"; id: string; title: string }
  | { type: "episodes"; id: string; title: string };

interface PaneState {
  sample: boolean;
  containers?: VideoContainer[];
  videos?: VideoItem[];
  // Offset of the next page when the level has more items than are loaded;
  // null when everything is loaded. `total` is the server-reported level size.
  nextOffset?: number | null;
  total?: number | null;
}

// Poster card art with a glyph fallback when no thumb exists.
function PosterArt({
  thumb,
  title,
  wide,
}: {
  thumb?: string | null;
  title: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`relative w-full overflow-hidden rounded-md bg-muted ${
        wide ? "aspect-video" : "aspect-[2/3]"
      }`}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          title={title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Clapperboard size={28} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

export default function VideoBrowser({
  open,
  onOpenChange,
  onPlay,
  server,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Hand a resolved playable queue back to the tile, starting at startIndex.
  onPlay: (entries: VideoEntry[], startIndex: number) => void;
  // Which media server backs this tile's browser.
  server: "plex" | "jellyfin";
}) {
  const serverName = server === "jellyfin" ? "Jellyfin" : "Plex";

  // Sidebar: the library list, loaded once per open.
  const [libraries, setLibraries] = useState<VideoLibrary[]>([]);
  const [librariesSample, setLibrariesSample] = useState(false);
  const [librariesLoading, setLibrariesLoading] = useState(false);
  const [librariesError, setLibrariesError] = useState(false);
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null);

  // Right pane: navigation stack within the active library + its contents.
  const [stack, setStack] = useState<Level[]>([]);
  const [pane, setPane] = useState<PaneState | null>(null);
  const [paneLoading, setPaneLoading] = useState(false);
  const [paneError, setPaneError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Search: a client-side filter of whatever the pane has loaded. Cleared
  // whenever navigation changes what the pane is showing.
  const [search, setSearch] = useState("");

  const fetchLevel = useCallback(
    async (level: Level, offset = 0): Promise<PaneState> => {
      const r = await browseVideoLibrary(
        level.type === "shows" || level.type === "movies"
          ? { server, kind: level.type, libraryId: level.libraryId, offset }
          : { server, kind: level.type, id: level.id, offset },
      );
      return {
        sample: r.sample,
        containers: r.containers,
        videos: r.videos,
        nextOffset: r.nextOffset ?? null,
        total: r.total ?? null,
      };
    },
    [server],
  );

  // Replace the pane's navigation stack and load whatever is now on top.
  const loadStack = useCallback(
    async (next: Level[]) => {
      setStack(next);
      setSearch("");
      const top = next[next.length - 1];
      if (!top) {
        setPane(null);
        setPaneError(false);
        setPaneLoading(false);
        return;
      }
      setPaneLoading(true);
      setPaneError(false);
      try {
        setPane(await fetchLevel(top));
      } catch {
        setPaneError(true);
        setPane(null);
      } finally {
        setPaneLoading(false);
      }
    },
    [fetchLevel],
  );

  const openLibrary = useCallback(
    (lib: VideoLibrary) => {
      setActiveLibraryId(lib.id);
      const root: Level =
        lib.kind === "shows"
          ? { type: "shows", libraryId: lib.id, title: lib.title }
          : { type: "movies", libraryId: lib.id, title: lib.title };
      void loadStack([root]);
    },
    [loadStack],
  );

  // Load the libraries (and auto-select the first) every time the dialog
  // opens, so the right pane is never an empty shell.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLibrariesLoading(true);
    setLibrariesError(false);
    setLibraries([]);
    setActiveLibraryId(null);
    setStack([]);
    setPane(null);
    (async () => {
      try {
        const r = await getVideoLibraries({ server });
        if (cancelled) return;
        const libs = r.libraries ?? [];
        setLibraries(libs);
        setLibrariesSample(r.sample ?? false);
        if (libs[0]) openLibrary(libs[0]);
      } catch {
        if (!cancelled) setLibrariesError(true);
      } finally {
        if (!cancelled) setLibrariesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, server]);

  // Append the next page of the current level to what's already loaded.
  const [moreLoading, setMoreLoading] = useState(false);
  const loadMore = useCallback(async () => {
    const level = stack[stack.length - 1];
    const from = pane?.nextOffset;
    if (!level || from == null || moreLoading) return;
    setMoreLoading(true);
    try {
      const next = await fetchLevel(level, from);
      setPane((prev) => ({
        sample: (prev?.sample ?? false) || next.sample,
        containers:
          prev?.containers || next.containers
            ? [...(prev?.containers ?? []), ...(next.containers ?? [])]
            : undefined,
        videos:
          prev?.videos || next.videos
            ? [...(prev?.videos ?? []), ...(next.videos ?? [])]
            : undefined,
        nextOffset: next.nextOffset ?? null,
        total: next.total ?? prev?.total ?? null,
      }));
    } catch {
      setPaneError(true);
    } finally {
      setMoreLoading(false);
    }
  }, [stack, pane, moreLoading, fetchLevel]);

  const push = (level: Level) => void loadStack([...stack, level]);
  const goBack = () => void loadStack(stack.slice(0, -1));

  const drillContainer = (c: VideoContainer) => {
    if (c.kind === "show") push({ type: "seasons", id: c.id, title: c.title });
    else push({ type: "episodes", id: c.id, title: c.title });
  };

  const toEntries = (videos: VideoItem[]): VideoEntry[] =>
    videos.map((v) => ({ id: v.id, title: v.title, url: v.streamUrl }));

  const playVideos = (videos: VideoItem[], startIndex: number) => {
    if (videos.length === 0) return;
    onPlay(toEntries(videos), Math.max(0, startIndex));
  };

  // Playing a container queues its episodes and starts at the top. If
  // nothing playable comes back (e.g. demo / unconfigured), drill in instead.
  const playContainer = async (c: VideoContainer) => {
    setBusyId(c.id);
    setPaneError(false);
    try {
      // Queue the whole container, following pagination so long shows aren't
      // cut off at the first page (bounded to avoid runaway loops).
      const kind = c.kind === "show" ? ("show_episodes" as const) : ("episodes" as const);
      let r = await browseVideoLibrary({ server, kind, id: c.id });
      const vids = [...(r.videos ?? [])];
      for (let guard = 0; r.nextOffset != null && guard < 25; guard++) {
        r = await browseVideoLibrary({ server, kind, id: c.id, offset: r.nextOffset });
        vids.push(...(r.videos ?? []));
      }
      if (!r.sample && vids.length > 0) {
        playVideos(vids, 0);
      } else {
        drillContainer(c);
      }
    } catch {
      setPaneError(true);
    } finally {
      setBusyId(null);
    }
  };

  const top = stack[stack.length - 1];
  const allContainers = pane?.containers ?? [];
  const allVideos = pane?.videos ?? [];
  const query = search.trim().toLowerCase();
  const containers = query
    ? allContainers.filter((c) => c.title.toLowerCase().includes(query))
    : allContainers;
  const videos = query
    ? allVideos.filter((v) => v.title.toLowerCase().includes(query))
    : allVideos;
  const sample = (pane?.sample ?? false) || librariesSample;
  const isEpisodeList = top?.type === "episodes";
  const hasContent = allContainers.length > 0 || allVideos.length > 0;
  const paneEmpty = !paneLoading && !paneError && !hasContent;
  const searchEmpty =
    !paneLoading &&
    !paneError &&
    hasContent &&
    containers.length === 0 &&
    videos.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] max-h-[85vh] w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        data-testid="videoplayer-browser"
      >
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle>Find videos</DialogTitle>
          <DialogDescription>
            Browse your {serverName} video libraries and pick something to play.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* ── Sidebar: libraries ─────────────────────────────────────── */}
          <div className="flex w-44 flex-shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/60 bg-muted/30 p-2 sm:w-52">
            <div className="px-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Libraries
            </div>
            {librariesLoading && (
              <div className="px-1.5 py-2 text-xs text-muted-foreground">Loading…</div>
            )}
            {librariesError && (
              <div className="px-1.5 py-2 text-xs text-destructive">
                Couldn’t reach {serverName}.
              </div>
            )}
            {!librariesLoading && !librariesError && libraries.length === 0 && (
              <div className="px-1.5 py-2 text-xs text-muted-foreground">
                No video libraries.
              </div>
            )}
            {libraries.map((lib) => (
              <button
                key={lib.id}
                type="button"
                onClick={() => openLibrary(lib)}
                data-testid="videoplayer-browser-library"
                data-active={activeLibraryId === lib.id || undefined}
                className={`flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors ${
                  activeLibraryId === lib.id
                    ? "bg-primary/15 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                }`}
              >
                {lib.kind === "shows" ? (
                  <Tv size={15} className="flex-shrink-0" aria-hidden="true" />
                ) : (
                  <Film size={15} className="flex-shrink-0" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate">{lib.title}</span>
              </button>
            ))}
          </div>

          {/* ── Right pane ─────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Pane header: back nav + where-am-I title */}
            {top && (
              <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
                {stack.length > 1 && (
                  <button
                    type="button"
                    onClick={goBack}
                    aria-label="Back"
                    data-testid="videoplayer-browser-back"
                    className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  >
                    <ArrowLeft size={14} aria-hidden="true" />
                    Back
                  </button>
                )}
                <div
                  className="flex min-w-0 flex-1 items-center gap-1 text-sm"
                  data-testid="videoplayer-browser-breadcrumbs"
                >
                  {stack.map((level, i) => (
                    <span key={i} className="flex min-w-0 items-center gap-1">
                      {i > 0 && (
                        <span className="text-muted-foreground/60" aria-hidden="true">
                          /
                        </span>
                      )}
                      <span
                        className={`truncate ${
                          i === stack.length - 1
                            ? "font-medium text-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        {level.title}
                      </span>
                    </span>
                  ))}
                </div>
                <div className="relative flex-shrink-0">
                  <Search
                    size={13}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search…"
                    aria-label="Search this view"
                    data-testid="videoplayer-browser-search"
                    className="h-7 w-32 rounded-md border border-border/60 bg-background pl-7 pr-6 text-xs outline-none transition-[width] placeholder:text-muted-foreground focus:w-44 focus:border-primary/50 sm:w-40 sm:focus:w-56"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      aria-label="Clear search"
                      data-testid="videoplayer-browser-search-clear"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {sample && !paneLoading && (
                <div className="mb-3 rounded bg-muted/60 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Demo — connect {serverName} in Settings to browse your libraries
                </div>
              )}
              {paneLoading && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Loading…
                </div>
              )}
              {paneError && (
                <div className="py-12 text-center text-sm text-destructive">
                  Couldn’t reach the video source.
                </div>
              )}
              {top && paneEmpty && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Nothing here.
                </div>
              )}
              {top && searchEmpty && (
                <div
                  className="py-12 text-center text-sm text-muted-foreground"
                  data-testid="videoplayer-browser-search-empty"
                >
                  No matches for “{search.trim()}”.
                </div>
              )}

              {/* Containers (shows / seasons): poster grid. Poster click
                  drills in; the hover Play button queues everything. */}
              {!paneLoading && !paneError && containers.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(136px,1fr))]">
                  {containers.map((c) => (
                    <div
                      key={c.id}
                      className="group relative min-w-0"
                      data-testid={`videoplayer-browser-${c.kind}`}
                    >
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => drillContainer(c)}
                          title={`Browse ${c.title}`}
                          className="block w-full min-w-0 rounded-md text-left outline-offset-2"
                        >
                          <PosterArt thumb={c.thumb} title={c.title} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void playContainer(c)}
                          disabled={busyId === c.id}
                          aria-label={`Play ${c.title}`}
                          title={`Play all of ${c.title}`}
                          data-testid="videoplayer-browser-play-container"
                          className={`absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-opacity hover:scale-105 ${
                            busyId === c.id
                              ? "opacity-100"
                              : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                          }`}
                        >
                          <Play size={16} className="ml-0.5" aria-hidden="true" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => drillContainer(c)}
                        title={`Browse ${c.title}`}
                        className="block w-full min-w-0 text-left"
                      >
                        <span className="mt-1.5 block truncate text-sm" title={c.title}>
                          {c.title}
                        </span>
                        {c.subtitle && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {c.subtitle}
                          </span>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Playable movies: poster grid, click plays. */}
              {!paneLoading && !paneError && videos.length > 0 && !isEpisodeList && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(136px,1fr))]">
                  {videos.map((v, i) => (
                    <button
                      key={v.id || i}
                      type="button"
                      onClick={() => playVideos(videos, i)}
                      title={`Play ${v.title}`}
                      data-testid="videoplayer-browser-video"
                      className="group relative block w-full min-w-0 rounded-md text-left outline-offset-2"
                    >
                      <PosterArt thumb={v.thumb} title={v.title} />
                      <span className="pointer-events-none absolute inset-x-0 top-0 flex aspect-[2/3] items-center justify-center rounded-md bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
                          <Play size={17} className="ml-0.5" aria-hidden="true" />
                        </span>
                      </span>
                      <span className="mt-1.5 block truncate text-sm" title={v.title}>
                        {v.title}
                      </span>
                      {v.durationMs != null && (
                        <span className="block text-xs tabular-nums text-muted-foreground">
                          {formatClock(v.durationMs / 1000)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* A season's episodes: ordered list rows, click plays from
                  that episode onward. */}
              {!paneLoading && !paneError && videos.length > 0 && isEpisodeList && (
                <div className="space-y-0.5">
                  {videos.map((v, i) => (
                    <button
                      key={v.id || i}
                      type="button"
                      onClick={() => playVideos(videos, i)}
                      title={`Play ${v.title}`}
                      data-testid="videoplayer-browser-video"
                      className="group flex w-full min-w-0 items-center gap-2.5 rounded-md border-l-2 border-transparent px-2 py-1.5 text-left transition-colors hover:border-primary/60 hover:bg-muted/60"
                    >
                      {v.thumb ? (
                        <img
                          src={v.thumb}
                          alt=""
                          loading="lazy"
                          className="h-12 w-20 flex-shrink-0 rounded bg-muted object-cover"
                        />
                      ) : (
                        <span className="flex h-12 w-20 flex-shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                          <Clapperboard size={16} aria-hidden="true" />
                        </span>
                      )}
                      <span className="hidden w-5 flex-shrink-0 text-right text-xs tabular-nums text-muted-foreground group-hover:hidden sm:block">
                        {i + 1}
                      </span>
                      <Play
                        size={13}
                        className="hidden w-5 flex-shrink-0 text-primary group-hover:block"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm" title={v.title}>
                        {v.title}
                      </span>
                      {v.durationMs != null && (
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {formatClock(v.durationMs / 1000)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Truncation notice + load-more affordance when the level has
                  more items than are loaded so far. */}
              {!paneLoading && !paneError && pane?.nextOffset != null && (
                <div
                  className="mt-3 flex flex-col items-center gap-1.5 pb-1"
                  data-testid="videoplayer-browser-more"
                >
                  <div className="text-xs text-muted-foreground">
                    Showing {allContainers.length + allVideos.length}
                    {pane.total != null ? ` of ${pane.total}` : ""} items
                    {query ? " — search only covers what’s loaded" : ""}
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={moreLoading}
                    data-testid="videoplayer-browser-load-more"
                    className="rounded-md border border-border/60 bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/70 disabled:opacity-60"
                  >
                    {moreLoading ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
