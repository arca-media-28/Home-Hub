import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import GridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import {
  useGetMe,
  useGetTiles,
  useSaveLayout,
  TileType,
  type Tile,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import AppTile from "@/components/tiles/AppTile";
import TruenasTile from "@/components/tiles/TruenasTile";
import MediaTile from "@/components/tiles/MediaTile";
import SonarrTile from "@/components/tiles/SonarrTile";
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
  Plus,
  LogOut,
  Lock,
  Unlock,
  ChevronDown,
  Pencil,
} from "lucide-react";

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

function renderTileContent(tile: Tile) {
  switch (tile.type) {
    case TileType.truenas:
      return <TruenasTile />;
    case TileType.media:
      return <MediaTile />;
    case TileType.sonarr:
      return <SonarrTile />;
    default:
      return <AppTile tile={tile} />;
  }
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
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Measure container width for the grid
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setGridWidth(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { data: me, isError: meError } = useGetMe({
    query: { retry: false },
  });

  // Redirect to login when auth check fails (TanStack Query v5: no onError in query options)
  useEffect(() => {
    if (meError) setLocation("/login");
  }, [meError, setLocation]);

  const { data: tiles = [], isLoading } = useGetTiles({
    query: {
      enabled: Boolean(me),
    },
  });

  const saveLayout = useSaveLayout({
    mutation: {
      onError: () => {
        toast({ title: "Failed to save layout", variant: "destructive" });
      },
    },
  });

  const layout = tiles.map(tileToLayout);

  const handleLayoutChange = useCallback(
    (currentLayout: { i: string; x: number; y: number; w: number; h: number }[]) => {
      if (!editMode) return;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        const mapped = currentLayout.map((l) => ({
          id: parseInt(l.i, 10),
          gridX: l.x,
          gridY: l.y,
          gridW: l.w,
          gridH: l.h,
        }));
        saveLayout.mutate({ data: { tiles: mapped } });
      }, 600);
    },
    [editMode, saveLayout],
  );

  function handleLogout() {
    localStorage.removeItem("token");
    queryClient.clear();
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-screen-2xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <LayoutGrid className="w-5 h-5 text-primary" />
            <span className="font-semibold text-sm tracking-tight">Homelab</span>
          </div>

          <div className="flex items-center gap-2">
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
            Loading tiles…
          </div>
        ) : tiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-72 gap-4 text-center">
            <LayoutGrid className="w-12 h-12 text-primary opacity-40" />
            <div>
              <p className="font-semibold text-foreground">No tiles yet</p>
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
            <GridLayout
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
                  className={`relative rounded-xl overflow-hidden border border-border shadow-sm bg-card transition-all ${
                    editMode ? "ring-2 ring-primary/30 hover:ring-primary/60 cursor-default" : ""
                  }`}
                >
                  {editMode && (
                    <div className="drag-handle absolute inset-0 z-20 flex items-start justify-end p-1.5 cursor-grab active:cursor-grabbing">
                      <button
                        type="button"
                        className="p-1 rounded bg-background/80 hover:bg-background border border-border shadow-sm text-muted-foreground hover:text-foreground transition-colors"
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
                  {renderTileContent(tile)}
                </div>
              ))}
            </GridLayout>
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
