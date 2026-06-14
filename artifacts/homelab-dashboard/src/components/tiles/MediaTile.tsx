import { useGetMediaRecent, getGetMediaRecentQueryKey } from "@workspace/api-client-react";
import { Tv } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";

export default function MediaTile({ enabled, density }: WidgetProps) {
  const { data, isLoading, isError } = useGetMediaRecent({
    query: { queryKey: getGetMediaRecentQueryKey(), refetchInterval: 30_000 },
  });

  const showRecent = enabled.has("recent");

  if (!showRecent) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
        No metrics selected
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  if (isError || !data?.length) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-1">
        <Tv className="w-5 h-5 opacity-50" />
        <span>Media server unavailable</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <Tv className="w-3.5 h-3.5" />
        Recently Added
      </div>
      <div className="flex-1 space-y-1.5">
        {data.slice(0, density.listLimit).map((item) => (
          <div key={item.id} className="flex items-center gap-2 min-w-0">
            {item.thumb ? (
              <img
                src={item.thumb}
                alt={item.title}
                className="w-8 h-8 object-cover flex-shrink-0 bg-muted border border-border"
              />
            ) : (
              <div className="w-8 h-8 bg-muted border border-border flex-shrink-0 flex items-center justify-center">
                <Tv className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{item.title}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {item.type}{item.year ? ` · ${item.year}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
