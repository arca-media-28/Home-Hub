import { useGetErsatzTvWidget, getGetErsatzTvWidgetQueryKey } from "@workspace/api-client-react";
import { Tv2, Radio } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";
import { tileBudget, STAT_ROW_PX, ROW_PX, SECTION_PX, TWO_LINE_ROW_PX } from "./metrics";

export default function ErsatztvTile({ enabled, density }: WidgetProps) {
  const { data, isLoading, isError } = useGetErsatzTvWidget({
    query: { queryKey: getGetErsatzTvWidgetQueryKey(), refetchInterval: 30_000 },
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
        <Tv2 className="w-5 h-5 opacity-50" />
        <span>ErsatzTV unavailable</span>
      </div>
    );
  }

  // Reveal in catalog priority — health first, then active streams (only when
  // ErsatzTV actually exposes the count), then the per-channel now-playing list
  // which greedily fills whatever space remains.
  const budget = tileBudget(density);
  const showHealth = enabled.has("health") && budget.block(STAT_ROW_PX);
  const showStreams =
    enabled.has("activeStreams") && data.activeStreams != null && budget.block(ROW_PX);
  const channelRows = enabled.has("nowPlaying")
    ? budget.list(SECTION_PX, TWO_LINE_ROW_PX, data.channels.length)
    : 0;

  // Channels currently airing something float to the top so the most useful
  // rows survive truncation on smaller tiles.
  const sortedChannels = [...data.channels].sort(
    (a, b) => Number(Boolean(b.nowPlaying)) - Number(Boolean(a.nowPlaying)),
  );
  const visibleChannels = sortedChannels.slice(0, channelRows);

  const nothingToShow = !showHealth && !showStreams && channelRows === 0;

  return (
    <div className="w-full h-full p-3 flex flex-col gap-3">
      {showHealth && (
        <div className="flex items-center justify-around text-center">
          <div>
            <div className="flex items-center justify-center gap-1.5 leading-none">
              <span
                className={`h-2 w-2 rounded-full ${data.reachable ? "bg-green-500" : "bg-red-500"}`}
              />
              <span className="text-lg font-bold text-foreground leading-none">
                {data.reachable ? "Up" : "Down"}
              </span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
              Status
            </div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums text-foreground leading-none">
              {data.channels.length}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
              Channels
            </div>
          </div>
        </div>
      )}

      {showStreams && (
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <Radio className="w-3.5 h-3.5" />
            Active streams
          </span>
          <span className="font-semibold tabular-nums text-foreground">
            {data.activeStreams}
          </span>
        </div>
      )}

      {channelRows > 0 && (
        <div className="flex-1 min-h-0 flex flex-col gap-1.5 overflow-hidden">
          {visibleChannels.map((c) => (
            <div key={`${c.number}-${c.name}`} className="flex items-start gap-2">
              <span className="flex-shrink-0 text-[10px] font-semibold tabular-nums text-muted-foreground mt-0.5 min-w-[1.5rem] text-right">
                {c.number}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-foreground truncate">{c.name}</div>
                <div
                  className={`text-[10px] truncate ${
                    c.nowPlaying ? "text-muted-foreground" : "text-muted-foreground/50 italic"
                  }`}
                >
                  {c.nowPlaying ?? "Off air"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {nothingToShow && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
          No metrics selected
        </div>
      )}
    </div>
  );
}
