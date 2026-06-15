import {
  useGetMediaRecent,
  getGetMediaRecentQueryKey,
  useGetMediaContinue,
  getGetMediaContinueQueryKey,
  type MediaItem,
  type ContinueWatchingItem,
} from "@workspace/api-client-react";
import { Tv, PlayCircle } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";

// A media cover. When the item carries a Plex deep link, it becomes a link that
// opens the item directly in Plex in a new tab; otherwise it renders inert.
function Cover({ thumb, title, url }: { thumb: string | null | undefined; title: string; url: string | null | undefined }) {
  const inner = thumb ? (
    <img
      src={thumb}
      alt={title}
      className="w-8 h-8 object-cover flex-shrink-0 bg-muted border border-border"
    />
  ) : (
    <div className="w-8 h-8 bg-muted border border-border flex-shrink-0 flex items-center justify-center">
      <Tv className="w-4 h-4 text-muted-foreground" />
    </div>
  );

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open "${title}" in Plex`}
        className="flex-shrink-0 hover:opacity-80 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {inner}
      </a>
    );
  }
  return inner;
}

// Primary/secondary line for a Recently Added entry. For TV (series name present)
// the show name leads with the season/episode label beneath; movies keep title +
// year as before.
function recentLines(item: MediaItem): { primary: string; secondary: string } {
  if (item.seriesName) {
    const season = item.seasonLabel ? item.seasonLabel : "";
    return { primary: item.seriesName, secondary: season || item.title };
  }
  return {
    primary: item.title,
    secondary: `${item.type}${item.year ? ` · ${item.year}` : ""}`,
  };
}

export default function MediaTile({ enabled, density }: WidgetProps) {
  const showRecent = enabled.has("recent");
  const showContinue = enabled.has("continue");

  const recent = useGetMediaRecent({
    query: { queryKey: getGetMediaRecentQueryKey(), refetchInterval: 30_000, enabled: showRecent },
  });
  const cont = useGetMediaContinue({
    query: { queryKey: getGetMediaContinueQueryKey(), refetchInterval: 30_000, enabled: showContinue },
  });

  if (!showRecent && !showContinue) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
        No metrics selected
      </div>
    );
  }

  const loading = (showRecent && recent.isLoading) || (showContinue && cont.isLoading);
  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  const recentItems: MediaItem[] = showRecent && recent.data ? recent.data : [];
  const continueItems: ContinueWatchingItem[] = showContinue && cont.data ? cont.data : [];

  const hasRecent = showRecent && recentItems.length > 0;
  const hasContinue = showContinue && continueItems.length > 0;

  // Everything we asked for failed / is empty → single unavailable state.
  if (!hasRecent && !hasContinue) {
    const recentFailed = showRecent && (recent.isError || !recent.data?.length);
    const continueFailed = showContinue && (cont.isError || !cont.data?.length);
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-1">
        <Tv className="w-5 h-5 opacity-50" />
        <span>{recentFailed || continueFailed ? "Media server unavailable" : "Nothing to show"}</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full p-3 flex flex-col gap-2">
      {hasContinue && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <PlayCircle className="w-3.5 h-3.5" />
            Continue Watching
          </div>
          {continueItems.slice(0, density.listLimit).map((item) => (
            <div key={item.id} className="flex items-center gap-2 min-w-0">
              <Cover thumb={item.thumb} title={item.title} url={item.url} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{item.seriesName || item.title}</p>
                {item.seriesName && <p className="text-xs text-muted-foreground truncate">{item.title}</p>}
                {item.progress != null && (
                  <div className="h-1 bg-muted overflow-hidden mt-0.5">
                    <div
                      className="h-full bg-primary transition-all duration-700"
                      style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasRecent && (
        <div className={`space-y-1.5 ${hasContinue ? "border-t border-border pt-2" : ""}`}>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <Tv className="w-3.5 h-3.5" />
            Recently Added
          </div>
          {recentItems.slice(0, density.listLimit).map((item) => {
            const { primary, secondary } = recentLines(item);
            return (
              <div key={item.id} className="flex items-center gap-2 min-w-0">
                <Cover thumb={item.thumb} title={item.title} url={item.url} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{primary}</p>
                  <p className="text-xs text-muted-foreground capitalize truncate">{secondary}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
