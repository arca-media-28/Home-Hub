import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { useLocation } from "wouter";
import GridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import {
  useGetMe,
  useGetTiles,
  useSaveLayout,
  useCreateTile,
  useGetConnectionsStatus,
  useGetPages,
  useCreatePage,
  useUpdatePage,
  useDeletePage,
  useReorderPages,
  useImportPages,
  exportPage,
  exportAllPages,
  getGetMeQueryKey,
  getGetTilesQueryKey,
  getGetPagesQueryKey,
  getGetConnectionsStatusQueryKey,
  TileType,
  type Tile,
  type Page,
  type PageExport,
  type ServiceStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useHealthAlerts } from "@/hooks/use-health-alerts";
import AppTile from "@/components/tiles/AppTile";
import IntegrationTile from "@/components/tiles/IntegrationTile";
import NoteTile from "@/components/tiles/NoteTile";
import TimerTile from "@/components/tiles/TimerTile";
import TamagotchiTile from "@/components/tiles/TamagotchiTile";
import BonsaiTile from "@/components/tiles/BonsaiTile";
import TileEditModal, { type EditMode } from "@/components/TileEditModal";
import { INTEGRATION_SERVICE, CONNECTION_BACKED_INTEGRATIONS } from "@/lib/integrationMeta";
import { ToastAction } from "@/components/ui/toast";
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
  SeparatorHorizontal,
  Heading,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  X,
  Trash2,
  Download,
  Upload,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";

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
  // The note is a post-it tile: its content is created and edited in-place by
  // the user (no backing service). It renders its own colored surface, bypassing
  // the standard integration header.
  if (tile.integration === "note") {
    return <NoteTile tile={tile} editMode={editMode} />;
  }
  // The timer is a client-side stopwatch/countdown tile. Its run state is
  // operated in-place on the tile (Start/Pause/Reset) and persisted back via
  // the tile-update flow, so it manages its own surface like the note.
  if (tile.integration === "timer") {
    return <TimerTile tile={tile} editMode={editMode} />;
  }
  // The Tamagotchi is a self-contained virtual-pet toy. Its living state
  // (hunger/happiness/energy) decays over real time and is cared for in-place on
  // the tile, so it paints its own surface and persists like the note/timer,
  // bypassing the standard integration header.
  if (tile.integration === "tamagotchi") {
    return <TamagotchiTile tile={tile} editMode={editMode} />;
  }
  // The Bonsai is a self-contained living-plant toy. Its hydration, overgrowth
  // and growth-stage state changes over real time and is tended in-place on the
  // tile (Water/Prune), so it paints its own surface and persists like the
  // tamagotchi/note/timer, bypassing the standard integration header.
  if (tile.integration === "bonsai") {
    return <BonsaiTile tile={tile} editMode={editMode} />;
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

  // The currently-shown page. null until pages load / are reconciled below.
  // Persisted to localStorage so the active page survives reloads.
  const [activePageId, setActivePageId] = useState<number | null>(() => {
    const stored = localStorage.getItem("activePageId");
    const n = stored ? parseInt(stored, 10) : NaN;
    return Number.isNaN(n) ? null : n;
  });
  // Page id whose name is being edited inline (edit mode only), plus its draft.
  const [renamingPageId, setRenamingPageId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // Page queued for deletion; drives the confirm dialog.
  const [pagePendingDelete, setPagePendingDelete] = useState<Page | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  // Hidden file input that backs the "Import page" action.
  const importInputRef = useRef<HTMLInputElement>(null);

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

  const { data: pages = [] } = useGetPages({
    query: { queryKey: getGetPagesQueryKey(), enabled: Boolean(me) },
  });

  // Reconcile the active page against the loaded list: keep the persisted page
  // when it still exists, otherwise fall back to the first page. Runs whenever
  // pages change (e.g. after a delete removes the active page).
  useEffect(() => {
    if (pages.length === 0) return;
    setActivePageId((current) => {
      if (current != null && pages.some((p) => p.id === current)) return current;
      return pages[0]!.id;
    });
  }, [pages]);

  // Persist the active page so a reload reopens it.
  useEffect(() => {
    if (activePageId != null) localStorage.setItem("activePageId", String(activePageId));
  }, [activePageId]);

  const { data: tiles = [], isLoading } = useGetTiles(
    activePageId != null ? { pageId: activePageId } : undefined,
    {
      query: {
        queryKey: getGetTilesQueryKey(
          activePageId != null ? { pageId: activePageId } : undefined,
        ),
        enabled: Boolean(me) && activePageId != null,
      },
    },
  );

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

  // Query key for the active page's tiles. All cache reads/writes for tiles go
  // through this so each page keeps its own independently-cached tile list.
  const tilesQueryKey =
    activePageId != null
      ? getGetTilesQueryKey({ pageId: activePageId })
      : getGetTilesQueryKey();

  const saveLayout = useSaveLayout({
    mutation: {
      onSuccess: (data) => {
        // Reconcile with the server's authoritative response
        queryClient.setQueryData(tilesQueryKey, data);
        if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
        setShowSaved(true);
        savedTimeoutRef.current = setTimeout(() => setShowSaved(false), 2000);
      },
      onError: () => {
        toast({ title: "Failed to save layout", variant: "destructive" });
        // Roll back the optimistic update to the server's true state
        queryClient.invalidateQueries({ queryKey: tilesQueryKey });
      },
    },
  });

  // Quick-add for the layout-only spacer/divider tiles. They carry no settings,
  // so they skip the editor entirely and drop straight into the first empty slot
  // on the active page.
  const createTile = useCreateTile({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: tilesQueryKey });
      },
      onError: (err) => {
        toast({
          title: "Failed to add tile",
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  // Page CRUD mutations. Each refreshes the page list; create also switches to
  // the new page, and the tile cache for a deleted page is dropped.
  const createPage = useCreatePage({
    mutation: {
      onSuccess: (page) => {
        queryClient.invalidateQueries({ queryKey: getGetPagesQueryKey() });
        setActivePageId(page.id);
      },
      onError: (err) => {
        toast({ title: "Failed to create page", description: err.message, variant: "destructive" });
      },
    },
  });

  const updatePage = useUpdatePage({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPagesQueryKey() });
      },
      onError: (err) => {
        toast({ title: "Failed to rename page", description: err.message, variant: "destructive" });
      },
    },
  });

  const deletePage = useDeletePage({
    mutation: {
      onSuccess: (_data, variables) => {
        queryClient.removeQueries({
          queryKey: getGetTilesQueryKey({ pageId: variables.id }),
        });
        queryClient.invalidateQueries({ queryKey: getGetPagesQueryKey() });
      },
      onError: (err) => {
        toast({ title: "Failed to delete page", description: err.message, variant: "destructive" });
      },
    },
  });

  const reorderPages = useReorderPages({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetPagesQueryKey(), data);
      },
      onError: (err) => {
        toast({ title: "Failed to reorder pages", description: err.message, variant: "destructive" });
        queryClient.invalidateQueries({ queryKey: getGetPagesQueryKey() });
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
      queryClient.setQueryData<Tile[]>(tilesQueryKey, (old) =>
        old?.map((t) => {
          const m = byId.get(t.id);
          return m
            ? { ...t, gridX: m.gridX, gridY: m.gridY, gridW: m.gridW, gridH: m.gridH }
            : t;
        }),
      );

      // Persist immediately on drag/resize end — no debounce. Scope the save to
      // the active page so the response (and reconcile) carries only its tiles.
      saveLayout.mutate({ data: { tiles: mapped, pageId: activePageId } });
    },
    [editMode, saveLayout, queryClient, tilesQueryKey, activePageId],
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

  function addSpacer() {
    // Spacers carry no content — drop a default 4×4 gap into the first empty
    // slot without opening the editor. It lands movable/resizable like any tile.
    const pos = findFirstEmptyPosition(tiles, 4, 4, cols);
    createTile.mutate({
      data: {
        pageId: activePageId,
        type: TileType.app,
        integration: "spacer",
        gridX: pos.x,
        gridY: pos.y,
        gridW: 4,
        gridH: 4,
      },
    });
  }

  function addDivider() {
    // Dividers are layout-only section headings carrying just a label. Drop a
    // default 4×4 divider into the first empty slot without opening the editor;
    // it lands movable/resizable/editable like any tile and can be renamed.
    const pos = findFirstEmptyPosition(tiles, 4, 4, cols);
    createTile.mutate({
      data: {
        pageId: activePageId,
        type: TileType.app,
        integration: "divider",
        name: "Section",
        gridX: pos.x,
        gridY: pos.y,
        gridW: 4,
        gridH: 4,
      },
    });
  }

  function openEditModal(tile: Tile) {
    if (!editMode) return;
    setSelectedTile(tile);
    setModalMode("edit");
    setModalOpen(true);
  }

  function handleSelectPage(id: number) {
    if (id === activePageId) return;
    setRenamingPageId(null);
    setActivePageId(id);
  }

  function handleAddPage() {
    createPage.mutate({ data: { name: "New Page" } });
  }

  function startRename(page: Page) {
    setRenamingPageId(page.id);
    setRenameDraft(page.name);
  }

  function commitRename() {
    const id = renamingPageId;
    if (id == null) return;
    const name = renameDraft.trim();
    const current = pages.find((p) => p.id === id);
    setRenamingPageId(null);
    if (!name || (current && current.name === name)) return;
    updatePage.mutate({ id, data: { name } });
  }

  // Move a page one slot left/right and persist the new order.
  function movePage(id: number, direction: -1 | 1) {
    const index = pages.findIndex((p) => p.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= pages.length) return;
    const order = pages.map((p) => p.id);
    const [moved] = order.splice(index, 1);
    order.splice(target, 0, moved!);
    // Optimistically reorder the cached list so the tabs reflow immediately.
    const byId = new Map(pages.map((p) => [p.id, p]));
    queryClient.setQueryData<Page[]>(
      getGetPagesQueryKey(),
      order.map((pid, i) => ({ ...byId.get(pid)!, position: i })),
    );
    reorderPages.mutate({ data: { order } });
  }

  function confirmDeletePage() {
    const page = pagePendingDelete;
    setPagePendingDelete(null);
    if (page) deletePage.mutate({ id: page.id });
  }

  // Import a previously exported file. On success the new pages are appended,
  // the page list is refreshed, and we switch to the first imported page.
  const importPages = useImportPages({
    mutation: {
      onSuccess: (created, variables) => {
        queryClient.invalidateQueries({ queryKey: getGetPagesQueryKey() });
        const first = created[0];
        if (first) setActivePageId(first.id);
        toast({
          title:
            created.length === 1
              ? "Imported 1 page"
              : `Imported ${created.length} pages`,
        });

        // Exports deliberately omit credentials, so an imported integration
        // tile references a service but has no connection configured. Surface
        // the distinct integrations whose connection still needs setting up so
        // the user isn't left wondering why those tiles show errors.
        const needsReconnect = integrationsNeedingReconnect(variables.data);
        if (needsReconnect.length > 0) {
          toast({
            title:
              needsReconnect.length === 1
                ? "1 integration needs reconnecting"
                : `${needsReconnect.length} integrations need reconnecting`,
            description: `Imports don't include credentials. Set up ${formatLabelList(needsReconnect)} in Settings so these tiles can load.`,
            action: (
              <ToastAction
                altText="Open settings"
                onClick={() => setLocation("/settings")}
              >
                Open settings
              </ToastAction>
            ),
          });
        }
      },
      onError: (err) => {
        toast({ title: "Import failed", description: err.message, variant: "destructive" });
      },
    },
  });

  // Inspect a just-imported envelope and return the distinct friendly labels of
  // the connection-backed integrations that still lack a configured connection.
  // Uses the live connection status; until that has loaded we stay silent rather
  // than risk a false "needs reconnecting" warning for an already-set-up service.
  function integrationsNeedingReconnect(envelope: PageExport): string[] {
    if (!statuses) return [];
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const page of envelope.pages ?? []) {
      for (const tile of page.tiles ?? []) {
        const integration = tile.integration;
        if (!integration) continue;
        const backing = CONNECTION_BACKED_INTEGRATIONS[integration];
        if (!backing) continue;
        if (statusByService.get(backing.service)?.configured) continue;
        if (seen.has(backing.label)) continue;
        seen.add(backing.label);
        labels.push(backing.label);
      }
    }
    return labels;
  }

  // Join labels into readable prose: "A", "A and B", "A, B and C".
  function formatLabelList(labels: string[]): string {
    if (labels.length <= 1) return labels[0] ?? "";
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  }

  // Turn arbitrary text into a safe download filename fragment.
  function safeFileName(name: string): string {
    const cleaned = name.trim().replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "");
    return cleaned || "dashboard";
  }

  // Trigger a browser download of an export envelope as a pretty-printed JSON.
  function downloadExport(data: PageExport, filename: string) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  async function handleExportPage(page: Page) {
    try {
      const data = await exportPage(page.id);
      downloadExport(data, `${safeFileName(page.name)}.dashboard.json`);
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Could not export page",
        variant: "destructive",
      });
    }
  }

  async function handleExportAll() {
    try {
      const data = await exportAllPages();
      downloadExport(data, "all-pages.dashboard.json");
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Could not export pages",
        variant: "destructive",
      });
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so selecting the same file again re-fires the change event.
    e.target.value = "";
    if (!file) return;
    let parsed: PageExport;
    try {
      parsed = JSON.parse(await file.text()) as PageExport;
    } catch {
      toast({
        title: "Import failed",
        description: "That file isn't valid JSON.",
        variant: "destructive",
      });
      return;
    }
    importPages.mutate({ data: parsed });
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
              <>
                <Button size="sm" variant="default" className="gap-1.5" onClick={openCreateModal}>
                  <Plus className="w-3.5 h-3.5" />
                  Add tile
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={addSpacer}
                  disabled={createTile.isPending}
                >
                  <SeparatorHorizontal className="w-3.5 h-3.5" />
                  Add spacer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={addDivider}
                  disabled={createTile.isPending}
                >
                  <Heading className="w-3.5 h-3.5" />
                  Add divider
                </Button>
              </>
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

        {/* Page switcher */}
        {pages.length > 0 && (
          <div className="border-t border-border/60">
            <div className="max-w-screen-2xl mx-auto px-4 h-11 flex items-center gap-1 overflow-x-auto">
              {pages.map((page, index) => {
                const isActive = page.id === activePageId;
                const isRenaming = renamingPageId === page.id;
                return (
                  <div
                    key={page.id}
                    className={`group flex items-center shrink-0 h-8 px-1 border-b-2 transition-colors ${
                      isActive
                        ? "border-primary"
                        : "border-transparent hover:border-border"
                    }`}
                  >
                    {editMode && (
                      <button
                        type="button"
                        className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
                        onClick={() => movePage(page.id, -1)}
                        disabled={index === 0}
                        aria-label="Move page left"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {isRenaming ? (
                      <Input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setRenamingPageId(null);
                        }}
                        className="h-7 w-32 px-2 text-sm"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSelectPage(page.id)}
                        onDoubleClick={() => editMode && startRename(page)}
                        className={`px-2 h-7 text-sm whitespace-nowrap transition-colors ${
                          isActive
                            ? "text-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {page.name}
                      </button>
                    )}

                    {editMode && !isRenaming && (
                      <>
                        <button
                          type="button"
                          className="p-0.5 text-muted-foreground hover:text-foreground"
                          onClick={() => startRename(page)}
                          aria-label="Rename page"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          className="p-0.5 text-muted-foreground hover:text-foreground"
                          onClick={() => handleExportPage(page)}
                          aria-label="Export page"
                          title="Export this page"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
                          onClick={() => movePage(page.id, 1)}
                          disabled={index === pages.length - 1}
                          aria-label="Move page right"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground"
                          onClick={() => setPagePendingDelete(page)}
                          disabled={pages.length <= 1}
                          aria-label="Delete page"
                          title={pages.length <= 1 ? "Can't delete your last page" : "Delete page"}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}

              {editMode && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 shrink-0 h-7 ml-1"
                    onClick={handleAddPage}
                    disabled={createPage.isPending}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New page
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 shrink-0 h-7"
                    onClick={() => importInputRef.current?.click()}
                    disabled={importPages.isPending}
                  >
                    {importPages.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    Import page
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 shrink-0 h-7"
                    onClick={handleExportAll}
                    disabled={pages.length === 0}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export all
                  </Button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleImportFile}
                  />
                </>
              )}
            </div>
          </div>
        )}
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
        pageId={activePageId}
      />

      <AlertDialog
        open={pagePendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPagePendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pagePendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the page and all of its tiles. This can't be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeletePage}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete page
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
