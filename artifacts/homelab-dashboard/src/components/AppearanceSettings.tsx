import { useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { useTheme } from "@/components/ThemeProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { validateCustomTheme } from "@/lib/customThemes";
import {
  Palette,
  Check,
  RotateCcw,
  Download,
  Upload,
  Trash2,
  AlertCircle,
  LayoutGrid,
  ChevronUp,
} from "lucide-react";

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function normalizeHex(value: string): string | null {
  const v = value.trim();
  if (!HEX_RE.test(v)) return null;
  return v.startsWith("#") ? v.toLowerCase() : `#${v.toLowerCase()}`;
}

function slugifyFilename(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "theme";
}

function ColorControl({
  label,
  value,
  isCustom,
  onChange,
}: {
  label: string;
  value: string;
  isCustom: boolean;
  onChange: (hex: string | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);

  // Keep the text input in sync with the active color when the popover opens.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) setDraft(value);
  }

  function commitDraft(raw: string) {
    setDraft(raw);
    const hex = normalizeHex(raw);
    if (hex) onChange(hex);
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="w-9 h-9 border border-border flex-shrink-0 shadow-sm rounded-[--radius]"
              style={{ background: value }}
              aria-label={`Pick ${label.toLowerCase()}`}
            />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" align="start">
            <HexColorPicker color={value} onChange={(hex) => onChange(hex)} />
            <Input
              value={draft}
              onChange={(e) => commitDraft(e.target.value)}
              spellCheck={false}
              className="mt-3 font-mono text-xs"
              placeholder="#000000"
            />
          </PopoverContent>
        </Popover>
        <Input
          value={value}
          onChange={(e) => commitDraft(e.target.value)}
          spellCheck={false}
          className="font-mono text-xs"
        />
        {isCustom && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="flex-shrink-0"
            onClick={() => onChange(null)}
            title="Use theme default"
            aria-label="Use theme default"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AppearanceSettings() {
  const {
    theme,
    themes,
    customThemeMetas,
    meta,
    colors,
    isCustom,
    setTheme,
    setPrimaryColor,
    setBackgroundColor,
    resetColors,
    hasCustomColors,
    addCustomTheme,
    renameCustomTheme,
    deleteCustomTheme,
    exportActiveTemplate,
  } = useTheme();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showAllThemes, setShowAllThemes] = useState(false);

  const primaryValue = colors.primary ?? meta.defaults.primary;
  const backgroundValue = colors.background ?? meta.defaults.background;

  const allThemes = [...themes, ...customThemeMetas];
  const customIds = new Set(customThemeMetas.map((t) => t.id));
  // Show 7 themes + a "More themes" tile (8th) when the user has more than fit.
  const VISIBLE_LIMIT = 7;
  const hasOverflow = allThemes.length > VISIBLE_LIMIT;
  const visibleThemes =
    showAllThemes || !hasOverflow ? allThemes : allThemes.slice(0, VISIBLE_LIMIT);

  function handleDownload() {
    const json = exportActiveTemplate();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugifyFilename(meta.name)}-theme.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setUploadError(null);
    const file = e.target.files?.[0];
    // Reset the input so re-uploading the same file fires onChange again.
    e.target.value = "";
    if (!file) return;

    let text: string;
    try {
      text = await file.text();
    } catch {
      setUploadError("Could not read the selected file.");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setUploadError("File is not valid JSON.");
      return;
    }

    const result = validateCustomTheme(parsed);
    if (!result.ok) {
      setUploadError(result.error);
      return;
    }

    const id = addCustomTheme(result.value);
    setTheme(id);
  }

  return (
    <section className="mb-8">
      <div className="border border-border bg-card relative">
        <div className="absolute top-0 left-0 h-full w-0.5 bg-primary/60" />
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
          <Palette className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-sm uppercase tracking-widest text-foreground">
            Appearance
          </h2>
        </div>

        <div className="p-5 space-y-6">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Theme
            </Label>
            <div className="mt-2 grid grid-cols-4 gap-2.5">
              {visibleThemes.map((t) => {
                const active = t.id === theme;
                const custom = customIds.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(t.id)}
                    aria-pressed={active}
                    title={t.name}
                    style={{ borderRadius: t.radius }}
                    className={`group relative aspect-square flex flex-col overflow-hidden border transition-all ${
                      active
                        ? "border-primary ring-1 ring-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div
                      className="flex-1 w-full flex items-center justify-center gap-1.5 relative"
                      style={{ background: t.swatch.background }}
                    >
                      <span
                        className="w-7 h-7 border"
                        style={{
                          background: t.swatch.surface,
                          borderColor: "rgba(128,128,128,0.25)",
                          borderRadius: t.radius,
                        }}
                      />
                      <span
                        className="w-3.5 h-7"
                        style={{ background: t.swatch.primary, borderRadius: t.radius }}
                      />
                      <span
                        className="w-2 h-7"
                        style={{ background: t.swatch.accent, borderRadius: t.radius }}
                      />
                      {custom && (
                        <span className="absolute top-1 left-1 text-[8px] font-bold uppercase tracking-wide px-1 py-0.5 rounded-sm bg-black/50 text-white">
                          Custom
                        </span>
                      )}
                      {active && (
                        <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                    <div className="px-2 py-1.5 bg-card border-t border-border w-full">
                      <div
                        className="text-xs font-semibold text-foreground truncate text-left"
                        style={{ fontFamily: t.font }}
                      >
                        {t.name}
                      </div>
                    </div>
                  </button>
                );
              })}
              {hasOverflow && (
                <button
                  type="button"
                  onClick={() => setShowAllThemes((v) => !v)}
                  aria-expanded={showAllThemes}
                  style={{ borderRadius: meta.radius }}
                  className="aspect-square flex flex-col items-center justify-center gap-1 border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground transition-all"
                >
                  {showAllThemes ? (
                    <ChevronUp className="w-5 h-5" />
                  ) : (
                    <LayoutGrid className="w-5 h-5" />
                  )}
                  <span className="text-xs font-semibold">
                    {showAllThemes ? "Show less" : "More themes"}
                  </span>
                  {!showAllThemes && (
                    <span className="text-[10px]">+{allThemes.length - VISIBLE_LIMIT}</span>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Import / export custom themes */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={handleDownload}
              >
                <Download className="w-3.5 h-3.5" />
                Download template
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-3.5 h-3.5" />
                Upload theme
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={handleUpload}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Download a template pre-filled from the current theme, edit its colors,
              font, radius and style, then upload it to use as your own theme.
            </p>
            {uploadError && (
              <div className="flex items-start gap-2 text-xs text-destructive border border-destructive/40 bg-destructive/10 px-3 py-2 rounded-[--radius]">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
                <span>{uploadError}</span>
              </div>
            )}
          </div>

          {/* Manage custom themes */}
          {customThemeMetas.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Your custom themes
              </Label>
              <div className="space-y-2">
                {customThemeMetas.map((t) => (
                  <div key={t.id} className="flex items-center gap-2">
                    <span
                      className="w-5 h-5 border border-border flex-shrink-0 rounded-[--radius]"
                      style={{ background: t.swatch.primary }}
                    />
                    <Input
                      defaultValue={t.name}
                      spellCheck={false}
                      maxLength={40}
                      className="text-sm"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== t.name) renameCustomTheme(t.id, v);
                        else e.target.value = t.name;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="flex-shrink-0 text-destructive hover:text-destructive"
                      onClick={() => deleteCustomTheme(t.id)}
                      title={`Delete ${t.name}`}
                      aria-label={`Delete ${t.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-theme color overrides only apply to built-in themes; custom
              themes carry their own colors in the uploaded definition. */}
          {!isCustom && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <ColorControl
                  label="Primary color"
                  value={primaryValue}
                  isCustom={Boolean(colors.primary)}
                  onChange={setPrimaryColor}
                />
                <ColorControl
                  label="Background color"
                  value={backgroundValue}
                  isCustom={Boolean(colors.background)}
                  onChange={setBackgroundColor}
                />
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs text-muted-foreground">
                  Custom colors override the selected theme and are saved in this
                  browser.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5 flex-shrink-0"
                  onClick={resetColors}
                  disabled={!hasCustomColors}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset to theme defaults
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
