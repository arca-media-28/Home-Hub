import {
  useGetPterodactylWidget,
  getGetPterodactylWidgetQueryKey,
} from "@workspace/api-client-react";
import { Gamepad2, AlertTriangle } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";
import {
  tileBudget,
  STAT_ROW_PX,
  SECTION_PX,
  ROW_PX,
  TWO_LINE_ROW_PX,
  listColumnClass,
  listColumnStyle,
} from "./metrics";
import { CenteredTileBody } from "./TileBody";

// Dot + label styling per power state. "stopping" renders like "starting"
// (amber, in transition); "unknown" is grey since we couldn't read the state.
const STATE_STYLE: Record<string, { dot: string; label: string; text: string }> = {
  running: { dot: "bg-green-500", label: "Running", text: "text-muted-foreground" },
  starting: { dot: "bg-amber-500", label: "Starting", text: "text-amber-500" },
  stopping: { dot: "bg-amber-500", label: "Stopping", text: "text-amber-500" },
  offline: { dot: "bg-red-500", label: "Offline", text: "text-red-500" },
  unknown: { dot: "bg-muted-foreground", label: "Unknown", text: "text-muted-foreground" },
};

function formatMem(usedMb: number | null, limitMb: number | null): string | null {
  if (usedMb == null) return null;
  const used = usedMb >= 1024 ? `${(usedMb / 1024).toFixed(1)}G` : `${Math.round(usedMb)}M`;
  if (limitMb == null) return used;
  const limit = limitMb >= 1024 ? `${(limitMb / 1024).toFixed(1)}G` : `${Math.round(limitMb)}M`;
  return `${used} / ${limit}`;
}

export default function PterodactylTile({ enabled, density, tileSettings }: WidgetProps) {
  const { data, isLoading, isError } = useGetPterodactylWidget({
    query: { queryKey: getGetPterodactylWidgetQueryKey(), refetchInterval: 30_000 },
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
        <Gamepad2 className="w-5 h-5 opacity-50" />
        <span>Pterodactyl unavailable</span>
      </div>
    );
  }

  // Per-tile allow-list of server identifiers. Null/empty = show all servers.
  const allowed = tileSettings?.pterodactylServers;
  const servers =
    allowed == null || allowed.length === 0
      ? data.servers
      : data.servers.filter((s) => allowed.includes(s.id));

  // The overall health summary always reflects EVERY server on the panel, not
  // just the tile's filtered selection — the filter narrows the list rows, but
  // "2 / 4 online" should describe the whole deployment.
  const total = data.servers.length;
  const online = data.servers.filter((s) => s.state === "running").length;
  const transitioning = data.servers.filter(
    (s) => s.state === "starting" || s.state === "stopping",
  ).length;
  const down = data.servers.filter((s) => s.state === "offline").length;

  const showResources = enabled.has("resources");
  const rowPx = showResources ? TWO_LINE_ROW_PX : ROW_PX;

  // Wide, short tiles waste the whole right side when content stacks
  // vertically — the health block alone eats the budget and the list hides.
  // When the body is clearly wider than it is tall, switch to a side-by-side
  // layout: health summary on the left, server rows filling the right.
  const rowLayout =
    enabled.has("health") &&
    enabled.has("serverList") &&
    servers.length > 0 &&
    !density.scrollable &&
    density.bodyWidth >= 380 &&
    density.bodyWidth > 1.8 * density.bodyHeight;

  // Reveal in catalog priority — the health summary first, then the per-server
  // list which greedily fills whatever space remains. Rows are taller when
  // resource stats are shown beneath the server name. In the side-by-side
  // layout the health block costs width instead of height, so it is not
  // deducted from the vertical budget and the list columns come from the
  // remaining width.
  const budget = tileBudget(density);
  const showHealth = enabled.has("health") && (rowLayout || budget.block(STAT_ROW_PX + ROW_PX));
  let serverRows = 0;
  let listColumns = budget.columns;
  if (rowLayout) {
    const availH = Math.max(0, density.bodyHeight - 24);
    const listW = Math.max(0, density.bodyWidth - 170);
    listColumns = Math.max(1, Math.min(4, Math.floor(listW / 210)));
    const rowsPerColumn = Math.max(1, Math.floor(availH / rowPx));
    serverRows = Math.min(servers.length, rowsPerColumn * listColumns);
  } else if (enabled.has("serverList")) {
    serverRows = budget.list(SECTION_PX, rowPx, servers.length);
  }

  // Servers needing attention (offline / transitioning) float to the top so the
  // most useful rows survive truncation on smaller tiles.
  const sortOrder = (s: string) =>
    s === "offline" ? 0 : s === "starting" || s === "stopping" ? 1 : s === "unknown" ? 2 : 3;
  const sortedServers = [...servers].sort(
    (a, b) => sortOrder(a.state) - sortOrder(b.state),
  );
  const visibleServers = sortedServers.slice(0, serverRows);
  // Only fill-and-clip when rows are actually hidden. When every server fits,
  // the list sizes to its content so CenteredTileBody can center the health
  // block + list as one group instead of stretching rows across a tall tile.
  const listTruncated = visibleServers.length < sortedServers.length;
  // When everything fits AND there is still leftover height, scale the server
  // rows up too (bigger text, dots and spacing) so a big tile reads as a big
  // tile instead of a small one floating in empty space. Tier 2 also swaps the
  // CPU/RAM text line for labelled usage bars, which cost extra height — so it
  // requires more slack per row-line when resources are shown.
  const rowsTall = listColumns > 0 ? Math.ceil(Math.max(1, serverRows) / listColumns) : 1;
  const spareBudget = rowLayout
    ? Math.max(0, density.bodyHeight - 24 - rowsTall * rowPx)
    : visibleServers.length >= sortedServers.length
      ? budget.remaining
      : 0;
  const tier2Px = showResources ? 64 : 40;
  const rowScale =
    spareBudget >= rowsTall * tier2Px + 16 ? 2 : spareBudget >= rowsTall * 16 + 8 ? 1 : 0;
  const rowText = ["text-xs", "text-sm", "text-lg"][rowScale]!;
  const rowSubText = ["text-[10px]", "text-xs", "text-sm"][rowScale]!;
  const rowDot = ["h-1.5 w-1.5", "h-2 w-2", "h-2.5 w-2.5"][rowScale]!;
  const rowGap = ["gap-1.5", "gap-2.5", "gap-4"][rowScale]!;
  const showBars = showResources && rowScale === 2;
  // Larger tiles get bigger stat numbers so the health block doesn't look lost
  // in the extra space.
  const statSize =
    !rowLayout && density.level === "lg" && spareBudget >= 120
      ? "text-4xl"
      : density.level === "lg"
        ? "text-2xl"
        : "text-lg";

  const nothingToShow = !showHealth && serverRows === 0;
  if (nothingToShow) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
        No metrics selected
      </div>
    );
  }

  const healthBlock = showHealth && (
    <div className="flex-shrink-0">
      <div className="flex items-center justify-around text-center">
        <div>
          <div className={`${statSize} font-bold tabular-nums text-foreground leading-none`}>
            {online} / {total}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
            Online
          </div>
        </div>
        {transitioning > 0 && (
          <div>
            <div className={`${statSize} font-bold tabular-nums text-amber-500 leading-none`}>
              {transitioning}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
              Starting
            </div>
          </div>
        )}
      </div>
      {down > 0 && (
        <div className="flex items-center justify-center gap-1.5 text-xs text-amber-500 mt-1.5">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          <span>
            {down} server{down === 1 ? "" : "s"} offline
          </span>
        </div>
      )}
    </div>
  );

  const serverRow = (s: (typeof visibleServers)[number]) => {
    const style = STATE_STYLE[s.state] ?? STATE_STYLE["unknown"]!;
    const mem = formatMem(s.memUsedMb, s.memLimitMb);
    const memPct =
      s.memUsedMb != null && s.memLimitMb != null && s.memLimitMb > 0
        ? Math.min(100, (s.memUsedMb / s.memLimitMb) * 100)
        : null;
    const cpuPct = s.cpuPercent != null ? Math.min(100, s.cpuPercent) : null;
    return (
      <div key={s.id} className="min-w-0">
        <div className={`flex items-center justify-between gap-1.5 ${rowText}`}>
          <span className="flex items-center gap-1.5 min-w-0">
            <span className={`${rowDot} rounded-full flex-shrink-0 ${style.dot}`} />
            <span className="truncate font-medium text-foreground">{s.name}</span>
          </span>
          <span
            className={`${rowSubText} uppercase tracking-wider flex-shrink-0 ${style.text}`}
          >
            {style.label}
          </span>
        </div>
        {showResources &&
          s.state === "running" &&
          (showBars ? (
            <div className="flex flex-col gap-1 pl-4 mt-1.5">
              {cpuPct != null && (
                <div className="flex items-center gap-2">
                  <span className="w-8 text-[10px] uppercase tracking-wider text-muted-foreground flex-shrink-0">
                    CPU
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${cpuPct}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground flex-shrink-0 w-12 text-right">
                    {s.cpuPercent!.toFixed(1)}%
                  </span>
                </div>
              )}
              {mem && (
                <div className="flex items-center gap-2">
                  <span className="w-8 text-[10px] uppercase tracking-wider text-muted-foreground flex-shrink-0">
                    RAM
                  </span>
                  {memPct != null ? (
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${memPct}%` }}
                      />
                    </div>
                  ) : (
                    <div className="flex-1" />
                  )}
                  <span className="text-xs tabular-nums text-muted-foreground flex-shrink-0 text-right">
                    {mem}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div
              className={`flex items-center gap-3 ${rowSubText} tabular-nums text-muted-foreground pl-3 mt-0.5`}
            >
              {s.cpuPercent != null && <span>CPU {s.cpuPercent.toFixed(1)}%</span>}
              {mem && <span>RAM {mem}</span>}
            </div>
          ))}
      </div>
    );
  };

  // Side-by-side layout for wide, short tiles: health summary in a fixed left
  // column, server rows filling the remaining width.
  if (rowLayout) {
    return (
      <div className="flex h-full w-full items-center gap-3 p-3">
        <div className="w-36 flex-shrink-0 flex flex-col justify-center">{healthBlock}</div>
        <div className="self-stretch w-px bg-border flex-shrink-0" />
        <div
          className={`flex-1 min-w-0 min-h-0 overflow-hidden self-center max-h-full ${listColumnClass(listColumns, `flex flex-col justify-center ${rowGap}`)}`}
          style={listColumnStyle(listColumns)}
        >
          {visibleServers.map(serverRow)}
        </div>
      </div>
    );
  }

  return (
    <CenteredTileBody gap="gap-2">
      {healthBlock}

      {serverRows > 0 && (
        <div
          className={`${listTruncated ? "flex-1 min-h-0 overflow-hidden " : "flex-shrink-0 "}border-t border-border pt-2 content-start ${listColumnClass(listColumns, `flex flex-col ${rowGap}`)}`}
          style={listColumnStyle(listColumns)}
        >
          {visibleServers.map(serverRow)}
        </div>
      )}
    </CenteredTileBody>
  );
}
