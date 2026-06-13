import React, { useState, useCallback, useRef, useEffect } from "react";
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
  Terminal,
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

const COLS = 12;
const ROW_HEIGHT = 80;

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

// Maps a tile's integration to the saved connection it pings. Plain app/link
// tiles (no integration) have no backing service and so get no reachability dot.
const INTEGRATION_SERVICE: Record<string, string> = {
  truenas: "truenas",
  media: "plex",
  sonarr: "sonarr",
  radarr: "radarr",
  qbittorrent: "qbittorrent",
};

function renderTileContent(tile: Tile, status?: ServiceStatus) {
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
  const [gridWidth, setGridWidth] = useState(1200);

  const containerRef = useRef<HTMLDivElement>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSaved, setShowSaved] = useState(false);

  // Measure container width for the non-responsive GridLayout
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setGridWidth(w);
    });
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
            <Terminal className="w-5 h-5 text-primary" />
            <span className="font-bold text-sm uppercase tracking-widest text-foreground">
              Homelab
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
      <main className="max-w-screen-2xl mx-auto px-4 py-6">
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
          <div ref={containerRef}>
            <Grid
              className="layout"
              layout={layout}
              cols={COLS}
              rowHeight={ROW_HEIGHT}
              width={gridWidth}
              isDraggable={editMode}
              isResizable={editMode}
              onLayoutChange={handleLayoutChange}
              margin={[12, 12]}
              containerPadding={[0, 0]}
              draggableHandle=".drag-handle"
            >
              {tiles.map((tile) => (
                <div
                  key={String(tile.id)}
                  className={`relative overflow-hidden border border-border shadow-sm bg-card transition-all ${
                    editMode ? "ring-1 ring-primary/40 hover:ring-primary cursor-default" : "hover:border-primary/40"
                  }`}
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
                  )}
                </div>
              ))}
            </Grid>
          </div>
        )}
      </main>

      <TileEditModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        tile={selectedTile}
        mode={modalMode}
      />
    </div>
  );
}
