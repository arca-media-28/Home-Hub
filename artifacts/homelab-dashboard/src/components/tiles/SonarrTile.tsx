import { useGetSonarrQueue, getGetSonarrQueueQueryKey } from "@workspace/api-client-react";
import { Radio } from "lucide-react";

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

export default function SonarrTile() {
  const { data, isLoading, isError } = useGetSonarrQueue({
    query: { queryKey: getGetSonarrQueueQueryKey(), refetchInterval: 30_000 },
  });

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-1">
        <Radio className="w-5 h-5 opacity-50" />
        <span>Sonarr unavailable</span>
      </div>
    );
  }

  const hasQueue = data.queue && data.queue.length > 0;
  const hasUpcoming = data.upcoming && data.upcoming.length > 0;

  return (
    <div className="w-full h-full p-3 flex flex-col gap-2 overflow-hidden">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <Radio className="w-3.5 h-3.5" />
        Sonarr
      </div>

      {hasQueue && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Downloading</p>
          {data.queue.slice(0, 3).map((item) => (
            <div key={item.id} className="min-w-0">
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium truncate max-w-[70%]">{item.title}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(item.size)}</span>
              </div>
              {item.progress != null && (
                <div className="h-1 bg-muted overflow-hidden mt-0.5">
                  <div
                    className="h-full bg-primary transition-all duration-700"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {hasUpcoming && (
        <div className="space-y-1 border-t border-border pt-2 mt-auto">
          <p className="text-xs text-muted-foreground">Upcoming</p>
          {data.upcoming.slice(0, 3).map((item) => (
            <div key={item.id} className="flex justify-between text-xs">
              <span className="truncate max-w-[70%] font-medium">
                {item.seriesTitle || item.title}
                {item.seasonNumber != null && item.episodeNumber != null
                  ? ` S${item.seasonNumber}E${item.episodeNumber}`
                  : ""}
              </span>
              <span className="text-muted-foreground flex-shrink-0 ml-1">{item.airDate}</span>
            </div>
          ))}
        </div>
      )}

      {!hasQueue && !hasUpcoming && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
          Nothing in queue
        </div>
      )}
    </div>
  );
}
