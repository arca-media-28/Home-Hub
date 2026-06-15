import { useState, useEffect, useRef } from "react";
import { HexColorPicker } from "react-colorful";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { METRIC_CATALOG, allMetricKeys } from "@/components/tiles/metrics";
import {
  resolveImageStyle,
  resolveTitleStyle,
  normalizePlacement,
  isPan,
  parsePan,
  formatPan,
  FIT_OPTIONS,
  POSITION_OPTIONS,
  DEFAULT_NEW_FIT,
  DEFAULT_PAN,
  DEFAULT_SCALE,
  MIN_SCALE,
  MAX_SCALE,
  TITLE_SIZE_OPTIONS,
  DEFAULT_TITLE_SIZE,
  DEFAULT_TITLE_POSITION,
  type FitValue,
  type PositionKey,
  type TitleSize,
} from "@/components/tiles/imageStyle";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateTile,
  useUpdateTile,
  useDeleteTile,
  useListUploads,
  useDeleteUpload,
  useGetQbittorrentStatus,
  getListUploadsQueryKey,
  getGetQbittorrentStatusQueryKey,
  TileType,
  TileIntegration,
  type Tile,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, X, Pipette, RotateCcw } from "lucide-react";

export type EditMode = "create" | "edit";

interface TileEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tile?: Tile;
  mode: EditMode;
}

const NONE = "none";

// Default tile background color (matches the app's card surface).
const DEFAULT_BG_COLOR = "#1c1c20";

// Optional integrations a tile can attach. "None" keeps the tile a plain
// app/link shortcut.
const INTEGRATIONS = [
  { value: NONE, label: "None" },
  { value: TileIntegration.media, label: "Plex / Media Server" },
  { value: TileIntegration.sonarr, label: "Sonarr" },
  { value: TileIntegration.radarr, label: "Radarr" },
  { value: TileIntegration.qbittorrent, label: "qBittorrent" },
  { value: TileIntegration.truenas, label: "TrueNAS" },
  { value: TileIntegration.pihole, label: "Pi-hole" },
  { value: TileIntegration["nginx-proxy-manager"], label: "Nginx Proxy Manager" },
] as const;

type ImageSource = "upload" | "library" | "url";

export default function TileEditModal({ open, onOpenChange, tile, mode }: TileEditModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const initialPlacement = normalizePlacement(tile ?? {});

  const [integration, setIntegration] = useState<string>(tile?.integration ?? NONE);
  const [name, setName] = useState(tile?.name ?? "");
  const [url, setUrl] = useState(tile?.url ?? "");
  const [bgColor, setBgColor] = useState(tile?.bgColor ?? DEFAULT_BG_COLOR);
  const [imageUrl, setImageUrl] = useState(tile?.imageUrl ?? "");
  const [imageFit, setImageFit] = useState<FitValue>(initialPlacement.fit);
  const [imagePosition, setImagePosition] = useState<string>(initialPlacement.position);
  const [imageScale, setImageScale] = useState<number>(initialPlacement.scale);
  const [imageSource, setImageSource] = useState<ImageSource>("upload");
  const [titleSize, setTitleSize] = useState<TitleSize>(
    (tile?.titleSize as TitleSize) ?? DEFAULT_TITLE_SIZE,
  );
  const [titlePosition, setTitlePosition] = useState<PositionKey>(
    (tile?.titlePosition as PositionKey) ?? DEFAULT_TITLE_POSITION,
  );
  // null = automatic title color (white over image, theme color otherwise).
  const [titleColor, setTitleColor] = useState<string | null>(tile?.titleColor ?? null);
  // When true, the tile renders without its title text (icon-only look).
  const [hideTitle, setHideTitle] = useState<boolean>(tile?.hideTitle ?? false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showTitleColorPicker, setShowTitleColorPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Selected metric keys for the active integration. null = "show all"
  // (backward-compatible default); an explicit array (incl. empty) is honored.
  const [metrics, setMetrics] = useState<string[] | null>(tile?.metrics ?? null);
  // qBittorrent category allow-list. null = "show all categories"; an explicit
  // array narrows the tile's torrent list to those categories.
  const [categoryFilter, setCategoryFilter] = useState<string[] | null>(
    tile?.tileSettings?.categoryFilter ?? null,
  );
  // When true, the qBittorrent tile groups torrents under category headers
  // instead of a flat list. Defaults to false (flat list).
  const [groupByCategory, setGroupByCategory] = useState<boolean>(
    tile?.tileSettings?.groupByCategory ?? false,
  );

  useEffect(() => {
    if (open) {
      const placement = normalizePlacement(tile ?? {});
      setIntegration(tile?.integration ?? NONE);
      setName(tile?.name ?? "");
      setUrl(tile?.url ?? "");
      setBgColor(tile?.bgColor ?? DEFAULT_BG_COLOR);
      setImageUrl(tile?.imageUrl ?? "");
      setImageFit(placement.fit);
      setImagePosition(placement.position);
      setImageScale(placement.scale);
      setImageSource("upload");
      setTitleSize((tile?.titleSize as TitleSize) ?? DEFAULT_TITLE_SIZE);
      setTitlePosition((tile?.titlePosition as PositionKey) ?? DEFAULT_TITLE_POSITION);
      setTitleColor(tile?.titleColor ?? null);
      setHideTitle(tile?.hideTitle ?? false);
      setMetrics(tile?.metrics ?? null);
      setCategoryFilter(tile?.tileSettings?.categoryFilter ?? null);
      setGroupByCategory(tile?.tileSettings?.groupByCategory ?? false);
      setShowColorPicker(false);
      setShowTitleColorPicker(false);
    }
  }, [open, tile]);

  // The image library — the user's previously uploaded images.
  const uploadsQuery = useListUploads({
    query: { queryKey: getListUploadsQueryKey(), enabled: open },
  });
  const deleteUpload = useDeleteUpload({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUploadsQueryKey() });
      },
      onError: (err) => {
        toast({ title: "Failed to delete image", description: err.message, variant: "destructive" });
      },
    },
  });

  // The set of metric keys currently shown. A null selection means "show all",
  // so reflect every catalog key as checked in the picker.
  const catalog = integration === NONE ? [] : METRIC_CATALOG[integration] ?? [];
  const enabledKeys = new Set(metrics ?? allMetricKeys(integration));

  // qBittorrent category discovery — only fetch live status when the editor is
  // open and qBittorrent is the selected integration. The list of selectable
  // categories comes from the widget's `categories` field, which reflects
  // qBittorrent's full category catalog (every defined category, even ones with
  // no active torrents) rather than being derived from the live torrent list.
  const isQbittorrent = integration === TileIntegration.qbittorrent;
  const qbStatusQuery = useGetQbittorrentStatus({
    query: {
      queryKey: getGetQbittorrentStatusQueryKey(),
      enabled: open && isQbittorrent,
    },
  });
  const availableCategories = Array.from(
    new Set(
      (qbStatusQuery.data?.categories ?? []).filter(
        (c): c is string => typeof c === "string" && c.length > 0,
      ),
    ),
  ).sort((a, b) => a.localeCompare(b));

  // The set of categories the saved filter currently covers. A null filter
  // means "all categories" — reflect every catalog category as checked. An
  // explicit array is honored as-is so a saved selection survives even when the
  // live catalog is empty (e.g. the categories fetch transiently failed).
  const checkedCategories = new Set(categoryFilter ?? availableCategories);
  const torrentsMetricOn = enabledKeys.has("torrents");

  function toggleCategory(category: string, checked: boolean) {
    // Start from the saved selection when present; otherwise (null = "all")
    // start from the full catalog so unchecking one leaves the rest selected.
    const base = categoryFilter ?? availableCategories;
    const set = new Set(base);
    if (checked) set.add(category);
    else set.delete(category);
    // Collapse back to null ("show all") only when every catalog category is
    // selected, so newly-added categories appear automatically. This is
    // computed against the full catalog — never an empty live list — so a
    // transiently-empty catalog can't silently wipe an explicit selection.
    const next = Array.from(set).sort((a, b) => a.localeCompare(b));
    const coversFullCatalog =
      availableCategories.length > 0 &&
      availableCategories.every((c) => set.has(c));
    setCategoryFilter(coversFullCatalog ? null : next);
  }

  function handleIntegrationChange(next: string) {
    setIntegration(next);
    // Switching integrations invalidates the old category filter too.
    setCategoryFilter(null);
    // Switching integrations invalidates the old metric keys; reset to "show
    // all" for the newly chosen service.
    setMetrics(null);
  }

  function toggleMetric(key: string, checked: boolean) {
    const base = metrics ?? allMetricKeys(integration);
    const set = new Set(base);
    if (checked) set.add(key);
    else set.delete(key);
    // Persist an explicit ordered subset so widgets honor exactly this choice.
    setMetrics(allMetricKeys(integration).filter((k) => set.has(k)));
  }

  const createTile = useCreateTile({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/tiles"] });
        toast({ title: "Tile created" });
        onOpenChange(false);
      },
      onError: (err) => {
        toast({ title: "Failed to create tile", description: err.message, variant: "destructive" });
      },
    },
  });

  const updateTile = useUpdateTile({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/tiles"] });
        toast({ title: "Tile updated" });
        onOpenChange(false);
      },
      onError: (err) => {
        toast({ title: "Failed to update tile", description: err.message, variant: "destructive" });
      },
    },
  });

  const deleteTile = useDeleteTile({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/tiles"] });
        toast({ title: "Tile deleted" });
        onOpenChange(false);
      },
      onError: (err) => {
        toast({ title: "Failed to delete tile", description: err.message, variant: "destructive" });
      },
    },
  });

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      const { url: uploadedUrl } = await res.json();
      setImageUrl(uploadedUrl);
      // Reset placement to sensible defaults for the freshly chosen image:
      // show the whole image, centered, at 100% so it can be freely panned.
      setImageFit(DEFAULT_NEW_FIT);
      setImagePosition(DEFAULT_PAN);
      setImageScale(DEFAULT_SCALE);
      // Refresh the library so the new image appears there too.
      queryClient.invalidateQueries({ queryKey: getListUploadsQueryKey() });
      toast({ title: "Image uploaded" });
    } catch (err: unknown) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  // Pick an image from the library / URL and reset placement to defaults so the
  // new image starts centered with the whole picture visible.
  function pickImage(nextUrl: string) {
    setImageUrl(nextUrl);
    setImageFit(DEFAULT_NEW_FIT);
    setImagePosition(DEFAULT_PAN);
    setImageScale(DEFAULT_SCALE);
  }

  // Clear the tile's image entirely.
  function clearImage() {
    setImageUrl("");
    setImageFit(DEFAULT_NEW_FIT);
    setImagePosition(DEFAULT_PAN);
    setImageScale(DEFAULT_SCALE);
  }

  // Delete an image from the library; if it was the tile's current image, clear
  // that selection too so we don't reference a now-missing file.
  function handleDeleteUpload(id: number, fileUrl: string) {
    deleteUpload.mutate({ id });
    if (imageUrl === fileUrl) clearImage();
  }

  // Eyedropper: pick any color on screen using the browser EyeDropper API.
  // Only Chromium-based browsers support it, so we feature-detect.
  const eyeDropperSupported =
    typeof window !== "undefined" && "EyeDropper" in window;

  async function pickColorFromScreen() {
    if (!eyeDropperSupported) return;
    try {
      const EyeDropperCtor = (window as unknown as {
        EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> };
      }).EyeDropper;
      const result = await new EyeDropperCtor().open();
      setBgColor(result.sRGBHex);
    } catch {
      // User dismissed the eyedropper (Esc) — nothing to do.
    }
  }

  async function pickTitleColorFromScreen() {
    if (!eyeDropperSupported) return;
    try {
      const EyeDropperCtor = (window as unknown as {
        EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> };
      }).EyeDropper;
      const result = await new EyeDropperCtor().open();
      setTitleColor(result.sRGBHex);
    } catch {
      // User dismissed the eyedropper (Esc) — nothing to do.
    }
  }

  // Live placement preview for the editor (mirrors how tiles render).
  const preview = resolveImageStyle({ imageFit, imagePosition, imageScale });
  const titlePreview = resolveTitleStyle({ titleSize, titlePosition });

  // ── Drag-to-reposition (free pan) ─────────────────────────────────────────
  // The user drags the preview image to pan it anywhere within the tile: the
  // image is a canvas and the tile a viewport over it. The pan is stored in
  // imagePosition as "pan(<x>,<y>)" — a translate in % of the tile box — so it
  // works on both axes at any zoom and never force-crops the image. The drag is
  // 1:1 in pixels because translate is resolved against the box the img fills.
  const previewRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    boxW: number;
    boxH: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handlePreviewPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!imageUrl) return;
    const box = previewRef.current;
    if (!box) return;
    const boxW = box.clientWidth;
    const boxH = box.clientHeight;
    if (!boxW || !boxH) return;
    // Start from the current pan; a legacy anchor/focal value has no pan, so we
    // begin from center and the drag recalibrates it into the free-pan model.
    const start = parsePan(imagePosition) ?? { x: 0, y: 0 };
    dragState.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: start.x,
      startY: start.y,
      boxW,
      boxH,
    };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handlePreviewPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragState.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startClientX;
    const dy = e.clientY - s.startClientY;
    // translate is % of the box, so a px delta maps to (dx / boxW) * 100.
    const nx = s.startX + (dx / s.boxW) * 100;
    const ny = s.startY + (dy / s.boxH) * 100;
    setImagePosition(formatPan(nx, ny));
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragState.current;
    if (!s || e.pointerId !== s.pointerId) return;
    dragState.current = null;
    setIsDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  // Whether the image has been panned away from its centered default.
  const isCentered = !isPan(imagePosition) || imagePosition === DEFAULT_PAN;

  function handleSave() {
    const data = {
      // Every tile is stored as an app/link with an optional integration.
      type: TileType.app,
      integration:
        integration === NONE
          ? null
          : (integration as typeof TileIntegration[keyof typeof TileIntegration]),
      name: name || undefined,
      url: url || undefined,
      bgColor: bgColor || undefined,
      // Send "" to explicitly clear the image when removed; placement fields are
      // only sent when an image is present.
      imageUrl: imageUrl || "",
      imageFit: imageUrl ? imageFit : undefined,
      imagePosition: imageUrl ? imagePosition : undefined,
      imageScale: imageUrl ? imageScale : undefined,
      // Title size/placement only applies to plain app/link tiles; integration
      // (widget) tiles keep their fixed header layout, so clear those fields.
      titleSize: integration === NONE ? titleSize : null,
      titlePosition: integration === NONE ? titlePosition : null,
      titleColor: integration === NONE ? titleColor : null,
      // Applies to both plain and integration tiles.
      hideTitle,
      // Plain app/link tiles carry no metric selection.
      metrics: integration === NONE ? null : metrics,
      // qBittorrent is the only integration that uses tileSettings (category
      // filter + grouping) for now; every other tile clears it.
      tileSettings: isQbittorrent ? { categoryFilter, groupByCategory } : null,
      gridX: tile?.gridX ?? 0,
      gridY: tile?.gridY ?? 0,
      gridW: tile?.gridW ?? 2,
      gridH: tile?.gridH ?? 2,
    };

    if (mode === "create") {
      createTile.mutate({ data });
    } else if (tile) {
      updateTile.mutate({ id: tile.id, data });
    }
  }

  function handleDelete() {
    if (tile) deleteTile.mutate({ id: tile.id });
  }

  const isPending = createTile.isPending || updateTile.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Tile" : "Edit Tile"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My App" />
          </div>

          <div className="space-y-1.5">
            <Label>URL</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
            />
          </div>

          <label
            htmlFor="hide-title"
            className="flex items-center gap-2 cursor-pointer select-none"
          >
            <Checkbox
              id="hide-title"
              checked={hideTitle}
              onCheckedChange={(c) => setHideTitle(c === true)}
            />
            <span className="text-sm">Hide title text</span>
          </label>

          {integration === NONE && (
            <div className="space-y-1.5">
              <Label>Title Color</Label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="w-8 h-8 rounded-md border border-border flex-shrink-0 shadow-sm"
                  style={{ background: titleColor || "transparent" }}
                  onClick={() => setShowTitleColorPicker((v) => !v)}
                  aria-label="Pick title color"
                />
                <Input
                  value={titleColor ?? ""}
                  onChange={(e) => setTitleColor(e.target.value || null)}
                  placeholder="Automatic"
                  className="font-mono text-sm"
                />
                {eyeDropperSupported && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="flex-shrink-0"
                    onClick={pickTitleColorFromScreen}
                    title="Pick a color from your screen"
                    aria-label="Pick a color from your screen"
                  >
                    <Pipette className="w-4 h-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="flex-shrink-0"
                  onClick={() => setTitleColor(null)}
                  disabled={titleColor === null}
                  title="Reset to automatic color"
                  aria-label="Reset to automatic color"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </div>
              {showTitleColorPicker && (
                <div className="mt-2">
                  <HexColorPicker color={titleColor ?? "#ffffff"} onChange={setTitleColor} />
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Background Color</Label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="w-8 h-8 rounded-md border border-border flex-shrink-0 shadow-sm"
                style={{ background: bgColor }}
                onClick={() => setShowColorPicker((v) => !v)}
                aria-label="Pick color"
              />
              <Input
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                placeholder={DEFAULT_BG_COLOR}
                className="font-mono text-sm"
              />
              {eyeDropperSupported && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="flex-shrink-0"
                  onClick={pickColorFromScreen}
                  title="Pick a color from your screen"
                  aria-label="Pick a color from your screen"
                >
                  <Pipette className="w-4 h-4" />
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="flex-shrink-0"
                onClick={() => setBgColor(DEFAULT_BG_COLOR)}
                disabled={bgColor === DEFAULT_BG_COLOR}
                title="Reset to default color"
                aria-label="Reset to default color"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
            {showColorPicker && (
              <div className="mt-2">
                <HexColorPicker color={bgColor} onChange={setBgColor} />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Image</Label>
              {imageUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                  onClick={clearImage}
                >
                  <X className="w-3.5 h-3.5 mr-1" />
                  Remove
                </Button>
              )}
            </div>

            {/* Live preview of how the tile image will look. Drag it to set a
                custom focal point when the image overflows the box. */}
            <div
              ref={previewRef}
              className={`relative w-full h-28 rounded-md overflow-hidden border border-border ${
                imageUrl
                  ? isDragging
                    ? "cursor-grabbing touch-none select-none"
                    : "cursor-grab touch-none select-none"
                  : ""
              }`}
              style={{ background: bgColor }}
              onPointerDown={handlePreviewPointerDown}
              onPointerMove={handlePreviewPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {imageUrl ? (
                <div className={preview.wrapperClassName} style={preview.wrapperStyle}>
                  <img
                    src={imageUrl}
                    alt="preview"
                    className={preview.className}
                    style={preview.style}
                    draggable={false}
                  />
                </div>
              ) : null}
              {imageUrl && <div className="absolute inset-0 bg-black/20" />}
              {/* Title overlay mirrors AppTile placement for plain tiles; widget
                  tiles keep their fixed header so just show a simple label. */}
              {hideTitle ? null : integration === NONE ? (
                <div className={`absolute inset-0 flex flex-col gap-1 p-2 ${titlePreview.containerClass}`}>
                  <span
                    className={`font-bold leading-tight tracking-wide drop-shadow-sm truncate max-w-full ${titlePreview.sizeClass} ${titlePreview.textAlignClass}`}
                    style={{ color: titleColor || (imageUrl ? "#fff" : "inherit") }}
                  >
                    {name || "Preview"}
                  </span>
                </div>
              ) : (
                imageUrl && (
                  <span className="absolute bottom-1.5 left-2 text-xs font-bold text-white drop-shadow-sm truncate max-w-[90%]">
                    {name || "Preview"}
                  </span>
                )
              )}
              {!imageUrl && integration !== NONE && (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  No image selected
                </div>
              )}
            </div>

            {/* Image source: upload a new one, pick from the library, or paste a URL. */}
            <Tabs value={imageSource} onValueChange={(v) => setImageSource(v as ImageSource)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="upload">Upload</TabsTrigger>
                <TabsTrigger value="library">Library</TabsTrigger>
                <TabsTrigger value="url">URL</TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="pt-2">
                <Label
                  htmlFor="file-upload"
                  className="cursor-pointer inline-flex text-xs px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  {uploading ? "Uploading…" : imageUrl ? "Upload replacement" : "Upload image"}
                </Label>
                <input
                  id="file-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUpload}
                  disabled={uploading}
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  Large photos are automatically resized and compressed.
                </p>
              </TabsContent>

              <TabsContent value="library" className="pt-2">
                {uploadsQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : (uploadsQuery.data?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No uploads yet. Upload an image to start your library.
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-1">
                    {uploadsQuery.data!.map((file) => (
                      <div key={file.id} className="relative group/lib aspect-square">
                        <button
                          type="button"
                          onClick={() => pickImage(file.url)}
                          className={`w-full h-full rounded-md overflow-hidden border ${
                            imageUrl === file.url
                              ? "border-primary ring-2 ring-primary"
                              : "border-border hover:border-primary/60"
                          }`}
                          title={file.originalName ?? undefined}
                        >
                          <img
                            src={file.url}
                            alt={file.originalName ?? "uploaded image"}
                            className="w-full h-full object-cover"
                            draggable={false}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteUpload(file.id, file.url)}
                          className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover/lib:opacity-100 transition-opacity shadow"
                          title="Delete from library"
                          aria-label="Delete image"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="url" className="pt-2">
                <Input
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://…/icon.png"
                />
              </TabsContent>
            </Tabs>
          </div>

          {imageUrl && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Fit</Label>
                <Select value={imageFit} onValueChange={(v) => setImageFit(v as FitValue)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIT_OPTIONS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Position</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setImagePosition(DEFAULT_PAN)}
                    disabled={isCentered}
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    Recenter
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Drag the image in the preview above to position it, and use Scale
                  to zoom in or out.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Scale</Label>
                  <span className="text-xs text-muted-foreground tabular-nums">{imageScale}%</span>
                </div>
                <Slider
                  min={MIN_SCALE}
                  max={MAX_SCALE}
                  step={5}
                  value={[imageScale]}
                  onValueChange={([v]) => setImageScale(v)}
                />
              </div>
            </div>
          )}

          {integration === NONE && name && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="space-y-1.5">
                <Label>Title size</Label>
                <Select value={titleSize} onValueChange={(v) => setTitleSize(v as TitleSize)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TITLE_SIZE_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Title placement</Label>
                <div className="grid grid-cols-3 gap-1 w-[88px]">
                  {POSITION_OPTIONS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setTitlePosition(p.key)}
                      title={p.label}
                      aria-label={p.label}
                      className={`h-7 rounded border transition-colors ${
                        titlePosition === p.key
                          ? "bg-primary border-primary"
                          : "bg-secondary border-border hover:bg-secondary/70"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5 border-t border-border pt-4">
            <Label>App integration</Label>
            <Select value={integration} onValueChange={handleIntegrationChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTEGRATIONS.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Optional. Attach a service to show its live status on this tile.
            </p>
          </div>

          {catalog.length > 0 && (
            <div className="space-y-2 border-t border-border pt-4">
              <Label>Metrics shown</Label>
              <p className="text-xs text-muted-foreground">
                Pick what this tile displays. Larger tiles reveal more detail.
              </p>
              <div className="space-y-2 pt-1">
                {catalog.map((m) => (
                  <label
                    key={m.key}
                    htmlFor={`metric-${m.key}`}
                    className="flex items-center gap-2 cursor-pointer select-none"
                  >
                    <Checkbox
                      id={`metric-${m.key}`}
                      checked={enabledKeys.has(m.key)}
                      onCheckedChange={(c) => toggleMetric(m.key, c === true)}
                    />
                    <span className="text-sm">{m.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {isQbittorrent && torrentsMetricOn && (
            <div className="space-y-2 border-t border-border pt-4">
              <label
                htmlFor="group-by-category"
                className="flex items-center gap-2 cursor-pointer select-none"
              >
                <Checkbox
                  id="group-by-category"
                  checked={groupByCategory}
                  onCheckedChange={(c) => setGroupByCategory(c === true)}
                />
                <span className="text-sm">Group torrents by category</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Show torrents under category headers instead of a flat list.
              </p>
            </div>
          )}

          {isQbittorrent && torrentsMetricOn && (
            <div className="space-y-2 border-t border-border pt-4">
              <Label>Filter categories</Label>
              <p className="text-xs text-muted-foreground">
                Show only torrents in the selected categories. Leave all checked
                to show every category.
              </p>
              {qbStatusQuery.isLoading ? (
                <p className="text-xs text-muted-foreground pt-1">Loading categories…</p>
              ) : availableCategories.length === 0 ? (
                <p className="text-xs text-muted-foreground pt-1">
                  No categories are defined in qBittorrent.
                </p>
              ) : (
                <div className="space-y-2 pt-1">
                  <label
                    htmlFor="category-all"
                    className="flex items-center gap-2 cursor-pointer select-none"
                  >
                    <Checkbox
                      id="category-all"
                      checked={categoryFilter === null}
                      onCheckedChange={(c) => {
                        if (c === true) setCategoryFilter(null);
                        else setCategoryFilter([]);
                      }}
                    />
                    <span className="text-sm font-medium">All categories</span>
                  </label>
                  {availableCategories.map((cat) => (
                    <label
                      key={cat}
                      htmlFor={`category-${cat}`}
                      className="flex items-center gap-2 cursor-pointer select-none pl-5"
                    >
                      <Checkbox
                        id={`category-${cat}`}
                        checked={checkedCategories.has(cat)}
                        onCheckedChange={(c) => toggleCategory(cat, c === true)}
                      />
                      <span className="text-sm">{cat}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {mode === "edit" && (
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteTile.isPending}
              className="sm:mr-auto"
            >
              {deleteTile.isPending ? "Deleting…" : "Delete tile"}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving…" : mode === "create" ? "Add tile" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
