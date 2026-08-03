import { lazy, Suspense, useEffect, useState } from "react";
import {
  useGetErsatzTvWidget,
  getGetErsatzTvWidgetQueryKey,
  useGetErsatzChannels,
  getGetErsatzChannelsQueryKey,
  useUpdateTile,
  getGetTilesQueryKey,
  type Tile,
  type TileSettings,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Tv2, Radio } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";
import { tileBudget, STAT_ROW_PX, ROW_PX, SECTION_PX, TWO_LINE_ROW_PX, listColumnClass, listColumnStyle } from "./metrics";
import { CenteredTileBody } from "./TileBody";
import { usePageTiles, findErsatzPlayerTile } from "./pageTiles";

const ErsatzGuideGrid = lazy(() => import("./ErsatzGuideGrid"));

// Minimum height the embedded TV guide needs to be worth rendering (title bar
// + slot header + a couple of channel rows). Charged against the tile budget
// so the guide only appears when the tile is tall enough to host it.
const GUIDE_MIN_PX = 150;

// Format an up-next ISO start time as a short local clock time (e.g. "8:45 PM").
function formatStartTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function ErsatztvTile({ enabled, density, editMode }: WidgetProps) {
  const { data, isLoading, isError } = useGetErsatzTvWidget({
    query: { queryKey: getGetErsatzTvWidgetQueryKey(), refetchInterval: 30_000 },
  });

  // Channel remote: the first Video Player tile on this page tuned to
  // ErsatzTV. When present, guide/now-playing channels become click targets
  // that re-tune that player through the normal tile-update flow (the player
  // reacts to the settings change with its usual tuning banner). When absent,
  // nothing is clickable — the guide is purely informational.
  const pageTiles = usePageTiles();
  const playerTile = findErsatzPlayerTile(pageTiles);
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
  const canTune = playerTile != null && !editMode;
  const tuneChannel = canTune
    ? (number: string) => {
        const settings: TileSettings = {
          ...(playerTile.tileSettings ?? {}),
          videoErsatzChannel: number,
        };
        updateTile.mutate({ id: playerTile.id, data: { tileSettings: settings } });
      }
    : undefined;
  // The channel the target player is currently tuned to (guide row highlight).
  const tunedNumber = playerTile
    ? ((playerTile.tileSettings as { videoErsatzChannel?: string | null } | null)
        ?.videoErsatzChannel ?? null)
    : null;

  // The full guide lineup (programme schedules) only exists on the channels
  // endpoint, so it's fetched only while the guide metric is enabled. Sample
  // lineups (unconfigured ErsatzTV) have no schedules — skip the guide then.
  const guideEnabled = enabled.has("guide");
  const channelsQuery = useGetErsatzChannels({
    query: {
      queryKey: getGetErsatzChannelsQueryKey(),
      enabled: guideEnabled,
      refetchInterval: 60_000,
    },
  });
  const guideChannels =
    guideEnabled && channelsQuery.data && !channelsQuery.data.sample
      ? channelsQuery.data.channels
      : [];

  // Tick the guide's "now" once a minute so the red now-line and airing
  // highlight track wall-clock time while the tile stays mounted.
  const [guideNow, setGuideNow] = useState(() => Date.now());
  useEffect(() => {
    if (!guideEnabled) return;
    const timer = setInterval(() => setGuideNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [guideEnabled]);

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
  // which greedily fills whatever space remains after the guide (when enabled)
  // reserves its minimum height.
  const budget = tileBudget(density);
  const showHealth = enabled.has("health") && budget.block(STAT_ROW_PX);
  const showStreams =
    enabled.has("activeStreams") && data.activeStreams != null && budget.block(ROW_PX);
  // The guide reserves its block before the channel list so a mid-size tile
  // prefers the richer guide over a longer text list.
  const showGuide = guideChannels.length > 0 && budget.block(GUIDE_MIN_PX);
  // With the up-next metric on, each channel row gains a third line, so the
  // budget charges a taller row and reveals fewer channels in the same space.
  const showUpNext = enabled.has("upNext");
  const channelRowPx = showUpNext ? TWO_LINE_ROW_PX + 14 : TWO_LINE_ROW_PX;
  const channelRows = enabled.has("nowPlaying")
    ? budget.list(SECTION_PX, channelRowPx, data.channels.length)
    : 0;

  // Channels currently airing something float to the top so the most useful
  // rows survive truncation on smaller tiles.
  const sortedChannels = [...data.channels].sort(
    (a, b) => Number(Boolean(b.nowPlaying)) - Number(Boolean(a.nowPlaying)),
  );
  const visibleChannels = sortedChannels.slice(0, channelRows);

  const nothingToShow = !showHealth && !showStreams && !showGuide && channelRows === 0;

  return (
    <CenteredTileBody>
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

      {showGuide && (
        <div
          className="min-h-0 flex-1"
          style={{ minHeight: GUIDE_MIN_PX }}
          data-testid="ersatztv-tile-guide"
        >
          <Suspense fallback={null}>
            <ErsatzGuideGrid
              embedded
              testIdPrefix="ersatztv-tile"
              channels={guideChannels}
              currentNumber={tunedNumber}
              nowMs={guideNow}
              onTune={tuneChannel}
            />
          </Suspense>
        </div>
      )}

      {channelRows > 0 && (
        <div
          className={`${showGuide ? "" : "flex-1 "}min-h-0 overflow-hidden ${listColumnClass(budget.columns, "flex flex-col gap-1.5")}`}
          style={listColumnStyle(budget.columns)}
        >
          {visibleChannels.map((c) => {
            const row = (
              <>
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
                  {showUpNext && c.upNextTitle && (
                    <div className="text-[10px] truncate text-muted-foreground/70">
                      Next: {c.upNextTitle}
                      {c.upNextStart ? ` · ${formatStartTime(c.upNextStart)}` : ""}
                    </div>
                  )}
                </div>
              </>
            );
            // With an eligible player on the page, each row doubles as a
            // remote button; otherwise it stays a plain, unclickable row.
            return tuneChannel ? (
              <button
                key={`${c.number}-${c.name}`}
                type="button"
                data-testid="ersatztv-tile-nowplaying-entry"
                onClick={() => tuneChannel(c.number)}
                className="flex items-start gap-2 rounded-sm text-left transition-colors hover:bg-accent/60"
              >
                {row}
              </button>
            ) : (
              <div key={`${c.number}-${c.name}`} className="flex items-start gap-2">
                {row}
              </div>
            );
          })}
        </div>
      )}

      {nothingToShow && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
          No metrics selected
        </div>
      )}
    </CenteredTileBody>
  );
}
