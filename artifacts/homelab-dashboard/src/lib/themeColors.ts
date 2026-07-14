import { useEffect, useState } from "react";

// Resolves the active theme's colors into hex strings usable by canvas
// renderers and <input type="color">. The theme system stores colors as
// space-separated HSL triples in CSS custom properties on <html> (e.g.
// `--primary: 41 100% 50%`), switched via the `data-theme` attribute — so we
// read them with getComputedStyle and re-resolve whenever the attribute
// changes.

// Ultimate fallbacks if CSS vars are unreadable (tests, detached documents).
export const FALLBACK_VISUALIZER_PRIMARY = "#7c3aed";
export const FALLBACK_VISUALIZER_BACKGROUND = "#0f0f1a";

export interface VisualizerThemeDefaults {
  primary: string;
  background: string;
}

// Parse a "H S% L%" triple (as stored in the theme CSS vars). Returns null on
// anything malformed so callers can fall back safely.
function parseHslTriple(raw: string): [number, number, number] | null {
  const m = /^\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%\s*$/.exec(raw);
  if (!m) return null;
  const h = Number(m[1]);
  const s = Number(m[2]);
  const l = Number(m[3]);
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;
  return [h, Math.min(100, Math.max(0, s)), Math.min(100, Math.max(0, l))];
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = ln - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Resolve the current theme's visualizer defaults from the document. The
// primary color is the theme's `--primary`; the background is the theme's
// card surface forced dark — the visualizers (glow, additive compositing)
// are designed for a dark canvas, so on light themes we keep the surface's
// hue but clamp lightness way down, giving a "native dark" tinted panel.
export function resolveVisualizerThemeDefaults(): VisualizerThemeDefaults {
  if (typeof document === "undefined") {
    return { primary: FALLBACK_VISUALIZER_PRIMARY, background: FALLBACK_VISUALIZER_BACKGROUND };
  }
  const styles = getComputedStyle(document.documentElement);
  const primaryTriple = parseHslTriple(styles.getPropertyValue("--primary"));
  // Prefer --background: it is the token users actually see (and override via
  // the per-theme color controls, which set it inline); --card is only a
  // fallback if a theme somehow lacks a background.
  const surfaceTriple =
    parseHslTriple(styles.getPropertyValue("--background")) ??
    parseHslTriple(styles.getPropertyValue("--card"));

  const primary = primaryTriple
    ? hslToHex(primaryTriple[0], primaryTriple[1], primaryTriple[2])
    : FALLBACK_VISUALIZER_PRIMARY;

  // Use the theme's background as-is — light themes get a light tile so it
  // genuinely reflects the selected theme (the renderers still read fine;
  // they just glow less on bright surfaces).
  const background = surfaceTriple
    ? hslToHex(surfaceTriple[0], surfaceTriple[1], surfaceTriple[2])
    : FALLBACK_VISUALIZER_BACKGROUND;
  return { primary, background };
}

// React hook: theme-derived visualizer defaults that update live when the
// theme changes. Watches <html>'s attributes (data-theme flips on theme
// switch; style/class can change when a custom theme's variables update).
export function useVisualizerThemeDefaults(): VisualizerThemeDefaults {
  const [defaults, setDefaults] = useState<VisualizerThemeDefaults>(() =>
    resolveVisualizerThemeDefaults(),
  );

  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDefaults(resolveVisualizerThemeDefaults());
    // Resolve once on mount in case the theme changed between render and effect.
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
    // Custom themes inject/update a <style> tag in <head>; watch for that too.
    const headObserver = new MutationObserver(update);
    headObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      headObserver.disconnect();
    };
  }, []);

  return defaults;
}
