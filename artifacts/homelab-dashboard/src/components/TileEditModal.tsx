import { useState, useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { METRIC_CATALOG, allMetricKeys } from "@/components/tiles/metrics";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateTile,
  useUpdateTile,
  useDeleteTile,
  TileType,
  TileIntegration,
  type Tile,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export type EditMode = "create" | "edit";

interface TileEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tile?: Tile;
  mode: EditMode;
}

const NONE = "none";

// Optional integrations a tile can attach. "None" keeps the tile a plain
// app/link shortcut.
const INTEGRATIONS = [
  { value: NONE, label: "None" },
  { value: TileIntegration.media, label: "Plex / Media Server" },
  { value: TileIntegration.sonarr, label: "Sonarr" },
  { value: TileIntegration.radarr, label: "Radarr" },
  { value: TileIntegration.qbittorrent, label: "qBittorrent" },
  { value: TileIntegration.truenas, label: "TrueNAS" },
] as const;

const IMAGE_FITS = [
  { value: "cover", label: "Cover" },
  { value: "contain", label: "Contain" },
  { value: "center", label: "Center" },
  { value: "top-left", label: "Top Left" },
];

export default function TileEditModal({ open, onOpenChange, tile, mode }: TileEditModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [integration, setIntegration] = useState<string>(tile?.integration ?? NONE);
  const [name, setName] = useState(tile?.name ?? "");
  const [url, setUrl] = useState(tile?.url ?? "");
  const [bgColor, setBgColor] = useState(tile?.bgColor ?? "#1c1c20");
  const [imageUrl, setImageUrl] = useState(tile?.imageUrl ?? "");
  const [imageFit, setImageFit] = useState(tile?.imageFit ?? "cover");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Selected metric keys for the active integration. null = "show all"
  // (backward-compatible default); an explicit array (incl. empty) is honored.
  const [metrics, setMetrics] = useState<string[] | null>(tile?.metrics ?? null);

  useEffect(() => {
    if (open) {
      setIntegration(tile?.integration ?? NONE);
      setName(tile?.name ?? "");
      setUrl(tile?.url ?? "");
      setBgColor(tile?.bgColor ?? "#1c1c20");
      setImageUrl(tile?.imageUrl ?? "");
      setImageFit(tile?.imageFit ?? "cover");
      setMetrics(tile?.metrics ?? null);
      setShowColorPicker(false);
    }
  }, [open, tile]);

  // The set of metric keys currently shown. A null selection means "show all",
  // so reflect every catalog key as checked in the picker.
  const catalog = integration === NONE ? [] : METRIC_CATALOG[integration] ?? [];
  const enabledKeys = new Set(metrics ?? allMetricKeys(integration));

  function handleIntegrationChange(next: string) {
    setIntegration(next);
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
      imageUrl: imageUrl || undefined,
      imageFit: imageFit || undefined,
      // Plain app/link tiles carry no metric selection.
      metrics: integration === NONE ? null : metrics,
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
                placeholder="#1c1c20"
                className="font-mono text-sm"
              />
            </div>
            {showColorPicker && (
              <div className="mt-2">
                <HexColorPicker color={bgColor} onChange={setBgColor} />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Image URL</Label>
            <Input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…/icon.png"
            />
            <div className="flex items-center gap-2 mt-1">
              <Label
                htmlFor="file-upload"
                className="cursor-pointer text-xs px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                {uploading ? "Uploading…" : "Upload image"}
              </Label>
              <input
                id="file-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
              />
              {imageUrl && (
                <img
                  src={imageUrl}
                  alt="preview"
                  className="w-8 h-8 rounded object-cover border border-border"
                />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Image Fit</Label>
            <Select value={imageFit} onValueChange={(v) => setImageFit(v as typeof imageFit)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_FITS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
