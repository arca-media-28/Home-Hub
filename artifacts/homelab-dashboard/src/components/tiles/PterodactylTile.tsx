import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPterodactylWidget,
  getGetPterodactylWidgetQueryKey,
  useSendPterodactylPower,
  type PterodactylPowerRequestSignal,
} from "@workspace/api-client-react";
import { Gamepad2, AlertTriangle, Users, Play, Square, RotateCw, Loader2, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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

// How long a row keeps its spinner after a power action if no poll ever
// reflects the transition (panel accepted but state read lags/fails).
const PENDING_TIMEOUT_MS = 20_000;
// After an action, poll faster for a while so starting/stopping resolves
// visibly instead of waiting out the normal 30s interval.
const BOOST_MS = 60_000;

export default function PterodactylTile({ enabled, density, tileSettings, editMode }: WidgetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Servers with an in-flight power action: id → the signal sent + when. The
  // row shows a spinner until a poll reports the server transitioning (or the
  // action clearly completed), or the timeout lapses.
  const [pending, setPending] = useState<Record<string, { signal: PterodactylPowerRequestSignal; at: number }>>({});
  // A stop/restart awaiting confirmation because players are online. Only one
  // row confirms at a time; any other action or a cancel clears it.
  const [confirm, setConfirm] = useState<{ id: string; signal: PterodactylPowerRequestSignal } | null>(null);
  const [boostUntil, setBoostUntil] = useState(0);

  const { data, isLoading, isError } = useGetPterodactylWidget({
    query: {
      queryKey: getGetPterodactylWidgetQueryKey(),
      refetchInterval: Date.now() < boostUntil ? 5_000 : 30_000,
    },
  });

  const power = useSendPterodactylPower({
    mutation: {
      onSuccess: (result, { data: req }) => {
        if (result.demo) {
          // Sample data — nothing was sent; don't fake a transition.
          setPending((p) => {
            const next = { ...p };
            delete next[req.serverId];
            return next;
          });
          toast({
            title: "Demo mode",
            description: "Connect Pterodactyl in Settings to control real servers.",
          });
          return;
        }
        setBoostUntil(Date.now() + BOOST_MS);
        void queryClient.invalidateQueries({ queryKey: getGetPterodactylWidgetQueryKey() });
      },
      onError: (err, { data: req }) => {
        setPending((p) => {
          const next = { ...p };
          delete next[req.serverId];
          return next;
        });
        const message =
          err instanceof Error && err.message ? err.message : "The panel rejected the request";
        toast({
          title: `Could not ${req.signal} server`,
          description: message,
          variant: "destructive",
        });
      },
    },
  });

  const sendPower = (serverId: string, signal: PterodactylPowerRequestSignal) => {
    setConfirm(null);
    setPending((p) => ({ ...p, [serverId]: { signal, at: Date.now() } }));
    power.mutate({ data: { serverId, signal } });
  };

  // Clear a row's pending spinner once a poll shows the action took effect
  // (server transitioning, or already in the expected end state), or when the
  // timeout lapses without the panel ever reflecting it.
  const serversRef = useRef(data?.servers);
  serversRef.current = data?.servers;
  useEffect(() => {
    setPending((p) => {
      let changed = false;
      const next = { ...p };
      for (const [id, entry] of Object.entries(p)) {
        const server = serversRef.current?.find((s) => s.id === id);
        const state = server?.state;
        const settled =
          state === "starting" ||
          state === "stopping" ||
          (entry.signal === "start" && state === "running") ||
          (entry.signal === "stop" && state === "offline") ||
          // A quick restart can land back on "running" between polls without
          // us ever observing the stopping/starting transition.
          (entry.signal === "restart" && state === "running" && Date.now() - entry.at > 5_000) ||
          Date.now() - entry.at > PENDING_TIMEOUT_MS ||
          !server;
        if (settled) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : p;
    });
  }, [data]);

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
  // Rows are always at least two lines (name, then players/status/controls);
  // the resources metric adds a third line. Each row renders as its own card
  // (background + padding) so servers read as separate items — the card
  // chrome costs extra height per row.
  const CARD_PX = 14;
  const rowPx = (showResources ? TWO_LINE_ROW_PX + 16 : TWO_LINE_ROW_PX) + CARD_PX;

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

  // Per-row power controls (locked mode only — in edit mode clicks belong to
  // drag/resize). Contextual: start when offline, stop/restart when running;
  // a spinner replaces the buttons while an action awaits its state change or
  // the panel reports the server transitioning.
  const btnIcon = rowScale === 2 ? "w-3.5 h-3.5" : "w-3 h-3";
  const powerControls = (s: (typeof visibleServers)[number]) => {
    if (editMode) return null;
    const isPending = Boolean(pending[s.id]);
    const transitioning = s.state === "starting" || s.state === "stopping";
    if (isPending || transitioning) {
      return (
        <span className="flex items-center flex-shrink-0 text-muted-foreground" aria-label="Working…">
          <Loader2 className={`${btnIcon} animate-spin`} />
        </span>
      );
    }
    // Stop/restart on a server with players connected asks first — the inline
    // confirm replaces the buttons so nothing shifts at small tile sizes.
    if (confirm?.id === s.id) {
      const verb = confirm.signal === "stop" ? "Stop" : "Restart";
      const players = s.players?.current ?? 0;
      return (
        <span className="flex items-center gap-1 flex-shrink-0">
          <span className={`${rowSubText} text-amber-500 whitespace-nowrap`}>
            {verb}? {players} online
          </span>
          <button
            type="button"
            title={`Confirm ${verb.toLowerCase()}`}
            aria-label={`Confirm ${verb.toLowerCase()} ${s.name}`}
            onClick={(e) => {
              e.stopPropagation();
              sendPower(s.id, confirm.signal);
            }}
            className="p-0.5 rounded text-muted-foreground transition-colors hover:text-red-500"
          >
            <Check className={btnIcon} />
          </button>
          <button
            type="button"
            title="Cancel"
            aria-label={`Cancel ${verb.toLowerCase()} ${s.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setConfirm(null);
            }}
            className="p-0.5 rounded text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className={btnIcon} />
          </button>
        </span>
      );
    }
    const btn = (
      label: string,
      signal: PterodactylPowerRequestSignal,
      Icon: typeof Play,
      cls: string,
    ) => (
      <button
        type="button"
        title={label}
        aria-label={`${label} ${s.name}`}
        onClick={(e) => {
          e.stopPropagation();
          const disruptive = signal === "stop" || signal === "restart";
          if (disruptive && (s.players?.current ?? 0) > 0) {
            setConfirm({ id: s.id, signal });
            return;
          }
          sendPower(s.id, signal);
        }}
        className={`p-0.5 rounded text-muted-foreground transition-colors ${cls}`}
      >
        <Icon className={btnIcon} />
      </button>
    );
    if (s.state === "running") {
      return (
        <span className="flex items-center gap-0.5 flex-shrink-0">
          {btn("Restart", "restart", RotateCw, "hover:text-amber-500")}
          {btn("Stop", "stop", Square, "hover:text-red-500")}
        </span>
      );
    }
    if (s.state === "offline") {
      return (
        <span className="flex items-center flex-shrink-0">
          {btn("Start", "start", Play, "hover:text-green-500")}
        </span>
      );
    }
    // Unknown state — we couldn't read it, so offer nothing rather than guess.
    return null;
  };

  const serverRow = (s: (typeof visibleServers)[number]) => {
    const style = STATE_STYLE[s.state] ?? STATE_STYLE["unknown"]!;
    const mem = formatMem(s.memUsedMb, s.memLimitMb);
    const memPct =
      s.memUsedMb != null && s.memLimitMb != null && s.memLimitMb > 0
        ? Math.min(100, (s.memUsedMb / s.memLimitMb) * 100)
        : null;
    const cpuPct = s.cpuPercent != null ? Math.min(100, s.cpuPercent) : null;
    return (
      <div key={s.id} className="min-w-0 rounded-md bg-muted/40 border border-border/60 px-2 py-1.5">
        <div className={`flex items-center gap-1.5 ${rowText}`}>
          <span className={`${rowDot} rounded-full flex-shrink-0 ${style.dot}`} />
          <span className="truncate font-medium text-foreground">{s.name}</span>
        </div>
        <div className="flex items-center justify-between gap-2 pl-3 mt-0.5">
          <span className="flex items-center gap-2 min-w-0">
            <span className={`${rowSubText} uppercase tracking-wider ${style.text}`}>
              {style.label}
            </span>
            {s.players != null && (
              <span
                className={`flex items-center gap-1 ${rowSubText} tabular-nums ${
                  s.players.current > 0 ? "text-foreground" : "text-muted-foreground"
                }`}
                title="Players online"
              >
                <Users className={rowScale === 2 ? "w-3.5 h-3.5" : "w-3 h-3"} />
                {s.players.current}
                {s.players.max != null && ` / ${s.players.max}`}
              </span>
            )}
          </span>
          {powerControls(s)}
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
