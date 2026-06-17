import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { useLocation } from "wouter";
import GridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import {
  useGetMe,
  useGetTiles,
  useSaveLayout,
  useGetConnectionsStatus,
  getGetMeQueryKey,
  getGetTilesQueryKey,
  getGetConnectionsStatusQueryKey,
  type Tile,
  type ServiceStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useHealthAlerts } from "@/hooks/use-health-alerts";
import AppTile from "@/components/tiles/AppTile";
import IntegrationTile from "@/components/tiles/IntegrationTile";
import TileEditModal, { type EditMode } from "@/components/TileEditModal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutGrid,
  Boxes,
  Plus,
  LogOut,
  Lock,
  Unlock,
  ChevronDown,
  Pencil,
  Check,
  Loader2,
  Settings as SettingsIcon,
} from "lucide-react";

// react-grid-layout's TS types omit some valid props (cols, margin, containerPadding)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Grid = GridLayout as React.ComponentType<any>;

const ROW_HEIGHT = 40;
const GRID_MARGIN = 12;
// Fixed per-column footprint (column width + one margin) that matches the
// established grid resolution (24 cols at ~1536px). Holding this constant keeps
// every tile the same visual size while the number of columns scales with the
// available width — a wider screen exposes more placeable columns instead of
// stretching the existing ones. With react-grid-layout's containerPadding=[0,0]
// the rendered column width is (width - margin*(cols-1))/cols, so solving for a
// target column width gives cols = (width + margin) / (colWidth + margin).
const COL_WIDTH = 51;
const MIN_COLS = 12;

function colsForWidth(width: number): number {
  return Math.max(
    MIN_COLS,
    Math.round((width + GRID_MARGIN) / (COL_WIDTH + GRID_MARGIN)),
  );
}

function tileToLayout(tile: Tile) {
  return {
    i: String(tile.id),
    x: tile.gridX,
    y: tile.gridY,
    w: tile.gridW,
    h: tile.gridH,
    minW: 1,
    minH: 1,
  };
}

// Scan the grid row by row, column by column for the first rectangular slot of
// size (w × h) that is fully unoccupied by existing tiles. Returns {x, y} of the
// first free slot, or {x: 0, y: maxY} (below every existing tile) as a safe
// fallback if nothing fits within the scan depth.
function findFirstEmptyPosition(
  existing: Pick<Tile, "gridX" | "gridY" | "gridW" | "gridH">[],
  w: number,
  h: number,
  cols: number,
): { x: number; y: number } {
  const maxX = Math.max(0, cols - w);
  const maxY = existing.reduce((acc, t) => Math.max(acc, t.gridY + t.gridH), 0);

  const overlaps = (x: number, y: number): boolean =>
    existing.some(
      (t) =>
        x < t.gridX + t.gridW &&
        x + w > t.gridX &&
        y < t.gridY + t.gridH &&
        y + h > t.gridY,
    );

  // Scan one row past the current content so a slot just below also gets found.
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      if (!overlaps(x, y)) return { x, y };
    }
  }

  return { x: 0, y: maxY };
}

// Maps a tile's integration to the saved connection it pings. Plain app/link
// tiles (no integration) have no backing service and so get no reachability dot.
const INTEGRATION_SERVICE: Record<string, string> = {
  truenas: "truenas",
  media: "plex",
  sonarr: "sonarr",
  radarr: "radarr",
  qbittorrent: "qbittorrent",
  pihole: "pihole",
  "nginx-proxy-manager": "nginx-proxy-manager",
};

function renderTileContent(tile: Tile, status: ServiceStatus | undefined, editMode: boolean) {
  // The spacer is a layout-only tile: an invisible gap. In locked mode it
  // renders nothing at all; in edit mode it shows a dashed ghost so users can
  // find, move, resize, or delete it.
  if (tile.integration === "spacer") {
    if (!editMode) return null;
    return (
      <div className="absolute inset-0 flex items-center justify-center border-2 border-dashed border-primary/40 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Spacer
      </div>
    );
  }
  // The divider is a layout-only tile: a low-profile section heading users drop
  // between groups of tiles. It shows its label as styled text (no card
  // surface) and stays visible in both locked and edit modes.
  if (tile.integration === "divider") {
    return (
      <div className="absolute inset-0 flex items-center px-1">
        <span className="text-sm font-bold uppercase tracking-widest text-muted-foreground truncate">
          {tile.name || "Section"}
        </span>
      </div>
    );
  }
  // Every tile renders as a styled app/link card. When an integration is
  // attached it also shows a compact live-status section from that service.
  if (tile.integration) {
    return <IntegrationTile tile={tile} status={status} />;
  }
  return <AppTile tile={tile} />;
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editMode, setEditMode] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTile, setSelectedTile] = useState<Tile | undefined>(undefined);
  const [modalMode, setModalMode] = useState<EditMode>("create");
  // Grid slot a newly-created tile should occupy, computed at the moment the
  // create modal opens so the tile lands in the first empty cell instead of
  // stacking at (0, 0).
  const [createGridPos, setCreateGridPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  // null until the real container width is measured. Gating the grid render on
  // a measured width (instead of starting from a hard-coded guess) keeps the
  // column count correct on the very first paint, so saved tile positions are
  // never compacted out of bounds on a hard refresh.
  const [gridWidth, setGridWidth] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  // Measure container width for the non-responsive GridLayout. useLayoutEffect
  // measures synchronously before the browser paints, so the grid's first paint
  // already uses the true width (and therefore the correct column count).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w) setGridWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { data: me, isError: meError } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false },
  });

  // Redirect to login on auth failure (TanStack Query v5 removed onError from query options)
  useEffect(() => {
    if (meError) setLocation("/login");
  }, [meError, setLocation]);

  const { data: tiles = [], isLoading } = useGetTiles({
    query: { queryKey: getGetTilesQueryKey(), enabled: Boolean(me) },
  });

  // Poll service reachability so each live-widget tile shows an up/down badge.
  // Refetches on a timer and whenever the dashboard regains focus (e.g. after
  // saving a connection in Settings).
  const { data: statuses } = useGetConnectionsStatus({
    query: {
      queryKey: getGetConnectionsStatusQueryKey(),
      enabled: Boolean(me),
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    },
  });

  const statusByService = new Map((statuses ?? []).map((s) => [s.service, s]));

  // Surface a toast whenever a previously-healthy service goes unreachable.
  useHealthAlerts(Boolean(me));

  const saveLayout = useSaveLayout({
    mutation: {
      onSuccess: (data) => {
        // Reconcile with the server's authoritative response
        queryClient.setQueryData(getGetTilesQueryKey(), data);
        if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
        setShowSaved(true);
        savedTimeoutRef.current = setTimeout(() => setShowSaved(false), 2000);
      },
      onError: () => {
        toast({ title: "Failed to save layout", variant: "destructive" });
        // Roll back the optimistic update to the server's true state
        queryClient.invalidateQueries({ queryKey: getGetTilesQueryKey() });
      },
    },
  });

  const layout = tiles.map(tileToLayout);
  const cols = gridWidth !== null ? colsForWidth(gridWidth) : MIN_COLS;

  const handleLayoutChange = useCallback(
    (currentLayout: { i: string; x: number; y: number; w: number; h: number }[]) => {
      if (!editMode) return;

      const mapped = currentLayout.map((l) => ({
        id: parseInt(l.i, 10),
        gridX: l.x,
        gridY: l.y,
        gridW: l.w,
        gridH: l.h,
      }));

      // Optimistically apply the new positions to the cache so a tab close
      // during the in-flight request never loses the change.
      const byId = new Map(mapped.map((m) => [m.id, m]));
      queryClient.setQueryData<Tile[]>(getGetTilesQueryKey(), (old) =>
        old?.map((t) => {
          const m = byId.get(t.id);
          return m
            ? { ...t, gridX: m.gridX, gridY: m.gridY, gridW: m.gridW, gridH: m.gridH }
            : t;
        }),
      );

      // Persist immediately on drag/resize end — no debounce.
      saveLayout.mutate({ data: { tiles: mapped } });
    },
    [editMode, saveLayout, queryClient],
  );

  // Clean up the "saved" indicator timer on unmount
  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  // Warn before leaving the tab if a layout save is still in flight or has
  // failed and not yet been retried, so a slow-network change is never lost.
  const hasUnsavedLayout = saveLayout.isPending || saveLayout.isError;
  useEffect(() => {
    if (!hasUnsavedLayout) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedLayout]);

  function handleLogout() {
    localStorage.removeItem("token");
    // Only drop auth-related state. Keep the tile list cache so a slow
    // re-login doesn't briefly flash a stale empty grid.
    queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
    setLocation("/login");
  }

  function openCreateModal() {
    setSelectedTile(undefined);
    setModalMode("create");
    // Drop the new (default 4×4) tile into the first empty grid slot rather
    // than stacking it on top of whatever already sits at (0, 0).
    setCreateGridPos(findFirstEmptyPosition(tiles, 4, 4, cols));
    setModalOpen(true);
  }

  function openEditModal(tile: Tile) {
    if (!editMode) return;
    setSelectedTile(tile);
    setModalMode("edit");
    setModalOpen(true);
  }

  if (!me && isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background bg-dot-pattern">
        <div className="text-muted-foreground text-sm">
          <span className="text-primary">{"> "}</span>
          <span className="animate-pulse">Initializing…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background bg-dot-pattern">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-screen-2xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Boxes className="w-5 h-5 text-primary" />
            <span className="font-bold text-sm uppercase tracking-widest text-foreground">
              HomeHub
            </span>
          </div>

          <div className="flex items-center gap-2">
            {saveLayout.isPending ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Saving…
              </span>
            ) : showSaved ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="w-3.5 h-3.5 text-primary" />
                Saved
              </span>
            ) : null}

            {editMode && (
              <Button size="sm" variant="default" className="gap-1.5" onClick={openCreateModal}>
                <Plus className="w-3.5 h-3.5" />
                Add tile
              </Button>
            )}

            <Button
              size="sm"
              variant={editMode ? "secondary" : "outline"}
              className="gap-1.5"
              onClick={() => setEditMode((v) => !v)}
            >
              {editMode ? (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  Done
                </>
              ) : (
                <>
                  <Unlock className="w-3.5 h-3.5" />
                  Edit
                </>
              )}
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => setLocation("/settings")}
              aria-label="Settings"
            >
              <SettingsIcon className="w-4 h-4" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="gap-1.5">
                  <span className="max-w-24 truncate text-sm">{me?.username}</span>
                  <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleLogout} className="text-destructive gap-2">
                  <LogOut className="w-3.5 h-3.5" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Grid */}
      <main className="px-4 py-6">
        <div ref={containerRef}>
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            <span className="text-primary">{"> "}</span>
            <span className="animate-pulse">Loading tiles…</span>
          </div>
        ) : tiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-72 gap-4 text-center border border-dashed border-border bg-card/40">
            <LayoutGrid className="w-12 h-12 text-primary opacity-40" />
            <div>
              <p className="font-bold uppercase tracking-widest text-foreground">No tiles yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Enable edit mode and add your first tile.
              </p>
            </div>
            <Button
              onClick={() => {
                setEditMode(true);
                openCreateModal();
              }}
              className="gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Add your first tile
            </Button>
          </div>
        ) : (
          <div>
            {gridWidth !== null && (
            <Grid
              className={`layout ${editMode ? "grid-editing" : "grid-locked"}`}
              layout={layout}
              width={gridWidth}
              gridConfig={{
                cols,
                rowHeight: ROW_HEIGHT,
                margin: [GRID_MARGIN, GRID_MARGIN],
                containerPadding: [0, 0],
              }}
              dragConfig={{ enabled: editMode, handle: ".drag-handle" }}
              resizeConfig={{ enabled: editMode }}
              onLayoutChange={handleLayoutChange}
            >
              {tiles.map((tile) => {
                // Per-tile overflow: when "scrollable" is on, the tile body
                // scrolls instead of clipping. The image background sub-layer
                // keeps its own overflow-hidden so framing is unaffected. The
                // spacer tile is layout-only and always clips.
                const isLayoutTile =
                  tile.integration === "spacer" || tile.integration === "divider";
                const overflowClass =
                  !isLayoutTile && tile.tileSettings?.scrollable
                    ? "overflow-auto"
                    : "overflow-hidden";
                return (
                <div
                  key={String(tile.id)}
                  className={
                    isLayoutTile
                      ? // Layout tiles (spacer/divider) carry no card surface.
                        // The spacer is invisible in locked mode; the divider
                        // shows its label text. Neither is a click target when
                        // locked, but both keep the edit ring so they can be
                        // moved, resized, or deleted.
                        `relative ${overflowClass} transition-all ${
                          editMode
                            ? "ring-1 ring-primary/40 hover:ring-primary cursor-default"
                            : "pointer-events-none"
                        }`
                      : `relative ${overflowClass} border border-border shadow-sm bg-card transition-all ${
                          editMode ? "ring-1 ring-primary/40 hover:ring-primary cursor-default" : "hover:border-primary/40"
                        }`
                  }
                >
                  {editMode && (
                    <div className="drag-handle absolute inset-0 z-20 flex items-start justify-end p-1.5 cursor-grab active:cursor-grabbing">
                      <button
                        type="button"
                        className="p-1 bg-background/80 hover:bg-background border border-border shadow-sm text-muted-foreground hover:text-primary transition-colors"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditModal(tile);
                        }}
                        aria-label="Edit tile"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  {renderTileContent(
                    tile,
                    tile.integration
                      ? statusByService.get(INTEGRATION_SERVICE[tile.integration])
                      : undefined,
                    editMode,
                  )}
                </div>
                );
              })}
            </Grid>
            )}
          </div>
        )}
        </div>
      </main>

      <TileEditModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        tile={selectedTile}
        mode={modalMode}
        defaultGridPos={createGridPos}
      />
    </div>
  );
}
