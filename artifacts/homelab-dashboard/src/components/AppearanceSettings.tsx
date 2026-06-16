import { useState } from "react";
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
import { Palette, Check, RotateCcw } from "lucide-react";

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

function normalizeHex(value: string): string | null {
  const v = value.trim();
  if (!HEX_RE.test(v)) return null;
  return v.startsWith("#") ? v.toLowerCase() : `#${v.toLowerCase()}`;
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
    meta,
    colors,
    setTheme,
    setPrimaryColor,
    setBackgroundColor,
    resetColors,
    hasCustomColors,
  } = useTheme();

  const primaryValue = colors.primary ?? meta.defaults.primary;
  const backgroundValue = colors.background ?? meta.defaults.background;

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
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {themes.map((t) => {
                const active = t.id === theme;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(t.id)}
                    aria-pressed={active}
                    style={{ borderRadius: t.radius }}
                    className={`group text-left border transition-all overflow-hidden ${
                      active
                        ? "border-primary ring-1 ring-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div
                      className="h-16 w-full flex items-center justify-center gap-1.5 relative"
                      style={{ background: t.swatch.background }}
                    >
                      <span
                        className="w-8 h-8 border"
                        style={{
                          background: t.swatch.surface,
                          borderColor: "rgba(128,128,128,0.25)",
                          borderRadius: t.radius,
                        }}
                      />
                      <span
                        className="w-4 h-8"
                        style={{ background: t.swatch.primary, borderRadius: t.radius }}
                      />
                      <span
                        className="w-2.5 h-8"
                        style={{ background: t.swatch.accent, borderRadius: t.radius }}
                      />
                      {active && (
                        <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                    <div className="px-3 py-2 bg-card">
                      <div
                        className="text-sm font-semibold text-foreground"
                        style={{ fontFamily: t.font }}
                      >
                        {t.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {t.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

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
        </div>
      </div>
    </section>
  );
}
