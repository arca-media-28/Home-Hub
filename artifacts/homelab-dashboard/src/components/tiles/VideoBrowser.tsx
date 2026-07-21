import { useCallback, useEffect, useState } from "react";
import {
  getVideoLibraries,
  getVideoPlaylist,
  browseVideoLibrary,
} from "@workspace/api-client-react";
import type {
  VideoItem,
  VideoContainer,
  VideoLibrary,
} from "@workspace/api-client-react";
import { ChevronRight, Clapperboard, Play } from "lucide-react";
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
// VideoBrowser: gradual drill-down browser for the Video Player tile's Plex
// source, modeled on the Audio Player's MusicBrowser. Levels: libraries →
// shows (with poster) → seasons → episodes; movie libraries skip straight to
// the movie list. A navigation stack of loaders backs breadcrumbs, so
// stepping back to any earlier level is a single pop. Selecting a playable
// leaf (movie/episode) plays it; selecting a container (show/season) queues
// its episodes, mirroring how the music browser treats containers.
// ---------------------------------------------------------------------------

// A single fetch the browser can run, kept on a navigation stack so drilling
// in and stepping back via breadcrumbs is trivial.
type Loader =
  | { type: "libraries"; title: string }
  | { type: "movies"; libraryId: string; title: string }
  | { type: "shows"; libraryId: string; title: string }
  | { type: "seasons"; id: string; title: string }
  | { type: "episodes"; id: string; title: string };

interface BrowseState {
  sample: boolean;
  libraries?: VideoLibrary[];
  containers?: VideoContainer[];
  videos?: VideoItem[];
}

// Poster/thumbnail for a container. Falls back to a glyph when missing.
function ContainerArt({ thumb, title }: { thumb?: string | null; title: string }) {
  if (thumb) {
    return (
      <img
        src={thumb}
        alt=""
        title={title}
        className="h-12 w-9 flex-shrink-0 rounded bg-muted object-cover"
      />
    );
  }
  return (
    <div className="flex h-12 w-9 flex-shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
      <Clapperboard size={16} aria-hidden="true" />
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
  const [stack, setStack] = useState<Loader[]>([]);
  const [result, setResult] = useState<BrowseState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchLoader = useCallback(
    async (loader: Loader): Promise<BrowseState> => {
      if (loader.type === "libraries") {
        const r = await getVideoLibraries({ server });
        return { sample: r.sample ?? false, libraries: r.libraries };
      }
      if (loader.type === "movies") {
        const r = await getVideoPlaylist({ server, libraryId: loader.libraryId });
        return { sample: r.sample ?? false, videos: r.videos };
      }
      if (loader.type === "shows") {
        const r = await browseVideoLibrary({
          server,
          kind: "shows",
          libraryId: loader.libraryId,
        });
        return { sample: r.sample, containers: r.containers, videos: r.videos };
      }
      const r = await browseVideoLibrary({
        server,
        kind: loader.type,
        id: loader.id,
      });
      return { sample: r.sample, containers: r.containers, videos: r.videos };
    },
    [server],
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

  // Reset to the library list every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    void loadStack([{ type: "libraries", title: "Libraries" }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const push = (loader: Loader) => void loadStack([...stack, loader]);
  const popTo = (index: number) => void loadStack(stack.slice(0, index + 1));

  const openLibrary = (lib: VideoLibrary) => {
    if (lib.kind === "shows") {
      push({ type: "shows", libraryId: lib.id, title: lib.title });
    } else {
      // Movie (and any non-show) libraries go straight to the flat list —
      // no artificial empty levels.
      push({ type: "movies", libraryId: lib.id, title: lib.title });
    }
  };

  const openContainer = (c: VideoContainer) => {
    if (c.kind === "show") push({ type: "seasons", id: c.id, title: c.title });
    else push({ type: "episodes", id: c.id, title: c.title });
  };

  const toEntries = (videos: VideoItem[]): VideoEntry[] =>
    videos.map((v) => ({ id: v.id, title: v.title, url: v.streamUrl }));

  const playVideos = (videos: VideoItem[], startIndex: number) => {
    if (videos.length === 0) return;
    onPlay(toEntries(videos), Math.max(0, startIndex));
  };

  // Selecting a container queues its episodes and starts playing. If nothing
  // playable comes back (e.g. demo / unconfigured), fall back to drilling in.
  const selectContainer = async (c: VideoContainer) => {
    setBusyId(c.id);
    setError(false);
    try {
      const r = await browseVideoLibrary({
        server,
        kind: c.kind === "show" ? "show_episodes" : "episodes",
        id: c.id,
      });
      const videos = r.videos ?? [];
      if (!r.sample && videos.length > 0) {
        playVideos(videos, 0);
      } else {
        openContainer(c);
      }
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  };

  const libraries = result?.libraries ?? [];
  const containers = result?.containers ?? [];
  const videos = result?.videos ?? [];
  const sample = result?.sample ?? false;
  const isEmpty =
    !loading &&
    !error &&
    libraries.length === 0 &&
    containers.length === 0 &&
    videos.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[80vh] flex-col gap-3 sm:max-w-lg"
        data-testid="videoplayer-browser"
      >
        <DialogHeader>
          <DialogTitle>Find videos</DialogTitle>
          <DialogDescription>
            Browse your {server === "jellyfin" ? "Jellyfin" : "Plex"} video
            libraries and pick something to play.
          </DialogDescription>
        </DialogHeader>

        {/* Breadcrumbs (drill-down) */}
        {stack.length > 1 && (
          <div
            className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
            data-testid="videoplayer-browser-breadcrumbs"
          >
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
              Couldn’t reach the video source.
            </div>
          )}
          {!loading && !error && sample && (
            <div className="mb-2 rounded bg-muted/60 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Demo — connect {server === "jellyfin" ? "Jellyfin" : "Plex"} in
              Settings to browse your libraries
            </div>
          )}
          {isEmpty && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nothing here.
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-4">
              {/* Libraries: drill on click (playing a whole library from the
                  top level would queue everything blindly). */}
              {libraries.length > 0 && (
                <div className="space-y-0.5">
                  {libraries.map((lib) => (
                    <button
                      key={lib.id}
                      type="button"
                      onClick={() => openLibrary(lib)}
                      data-testid="videoplayer-browser-library"
                      className="flex w-full min-w-0 items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-muted/60"
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                        <Clapperboard size={16} aria-hidden="true" />
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{lib.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {lib.kind === "shows" ? "TV library" : "Movie library"}
                        </span>
                      </span>
                      <ChevronRight
                        size={14}
                        className="flex-shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                  ))}
                </div>
              )}

              {/* Containers (shows / seasons): click plays contents, chevron drills. */}
              {containers.length > 0 && (
                <div className="space-y-0.5">
                  {containers.map((c) => (
                    <div
                      key={c.id}
                      className="group flex items-center gap-1 rounded pr-1 hover:bg-muted/60"
                    >
                      <button
                        type="button"
                        onClick={() => void selectContainer(c)}
                        disabled={busyId === c.id}
                        title={`Play ${c.title}`}
                        data-testid={`videoplayer-browser-${c.kind}`}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left disabled:opacity-60"
                      >
                        <ContainerArt thumb={c.thumb} title={c.title} />
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
              )}

              {/* Playable videos (movies or a season's episodes). */}
              {videos.length > 0 && (
                <div className="space-y-0.5">
                  {videos.map((v, i) => (
                    <button
                      key={v.id || i}
                      type="button"
                      onClick={() => playVideos(videos, i)}
                      title={`Play ${v.title}`}
                      data-testid="videoplayer-browser-video"
                      className="group flex w-full min-w-0 items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted/60"
                    >
                      <span className="w-5 flex-shrink-0 text-right text-xs tabular-nums text-muted-foreground group-hover:hidden">
                        {i + 1}
                      </span>
                      <Play
                        size={12}
                        className="hidden w-5 flex-shrink-0 text-primary group-hover:block"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm" title={v.title}>
                        {v.title}
                      </span>
                      {v.durationMs != null && (
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {formatClock(v.durationMs / 1000)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
