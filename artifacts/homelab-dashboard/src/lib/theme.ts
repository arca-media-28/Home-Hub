// HomeHub theme system. The actual color application (including custom-color
// derivation) is implemented once as window.__homehubApplyTheme in index.html so
// it can run before first paint. This module owns the theme metadata, the React
// state, and persistence, and delegates the DOM work to that global.

export type ThemeId = "rack" | "hearth" | "nebula" | "friction" | "workshop" | "pebble";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  description: string;
  dark: boolean;
  /** Corner radius this theme uses, so the picker preview can show its shape. */
  radius: string;
  /** Font stack this theme uses, so the picker preview can show its voice. */
  font: string;
  /** Default palette swatch colors for the picker preview (hex). */
  swatch: {
    background: string;
    surface: string;
    primary: string;
    accent: string;
  };
  /** Default colors offered as the starting point in the color pickers (hex). */
  defaults: {
    primary: string;
    background: string;
  };
}

export const THEMES: ThemeMeta[] = [
  {
    id: "friction",
    name: "Friction",
    description: "Industrial — royal blue, red, bold caps",
    dark: true,
    radius: "0.25rem",
    font: "'Outfit', ui-sans-serif, system-ui, sans-serif",
    swatch: { background: "#11264f", surface: "#16305e", primary: "#d23f30", accent: "#d23f30" },
    defaults: { primary: "#d23f30", background: "#11264f" },
  },
  {
    id: "rack",
    name: "Rack",
    description: "Dark terminal — mono, sharp corners, grid, flat",
    dark: true,
    radius: "0rem",
    font: "'Space Mono', ui-monospace, monospace",
    swatch: { background: "#0a0a0c", surface: "#0f0f12", primary: "#ffb000", accent: "#ffb000" },
    defaults: { primary: "#ffb000", background: "#0a0a0c" },
  },
  {
    id: "nebula",
    name: "Nebula",
    description: "Cosmic — glassy, glowing, violet & cyan",
    dark: true,
    radius: "0.75rem",
    font: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    swatch: { background: "#0b0a1a", surface: "#15123a", primary: "#7c5cff", accent: "#22d3ee" },
    defaults: { primary: "#7c5cff", background: "#0b0a1a" },
  },
  {
    id: "hearth",
    name: "Hearth",
    description: "Warm editorial — serif, soft, rounded, borderless",
    dark: false,
    radius: "1.25rem",
    font: "'Fraunces', Georgia, serif",
    swatch: { background: "#fdfbf7", surface: "#ffffff", primary: "#d97736", accent: "#d97736" },
    defaults: { primary: "#d97736", background: "#fdfbf7" },
  },
  {
    id: "workshop",
    name: "Workshop",
    description: "Skeuomorphic — brushed metal, glossy, beveled",
    dark: false,
    radius: "0.625rem",
    font: "'Nunito Sans', ui-sans-serif, system-ui, sans-serif",
    swatch: { background: "#bbc3cc", surface: "#e1e7ec", primary: "#2774b3", accent: "#cf9836" },
    defaults: { primary: "#2774b3", background: "#bbc3cc" },
  },
  {
    id: "pebble",
    name: "Pebble",
    description: "Neumorphic — soft monochrome, extruded, big radius",
    dark: false,
    radius: "1rem",
    font: "'Inter', ui-sans-serif, system-ui, sans-serif",
    swatch: { background: "#dfe2e9", surface: "#e6e9ef", primary: "#5a6ad6", accent: "#5a6ad6" },
    defaults: { primary: "#5a6ad6", background: "#dfe2e9" },
  },
];

export const DEFAULT_THEME: ThemeId = "friction";
export const THEME_KEY = "homehub:theme";
export const COLORS_KEY = "homehub:colors";

export interface CustomColors {
  primary?: string;
  background?: string;
}

/** Map of themeId -> custom color overrides for that theme. */
export type ColorOverrides = Partial<Record<ThemeId, CustomColors>>;

declare global {
  interface Window {
    __homehubApplyTheme?: (theme: string, colors?: CustomColors) => void;
  }
}

export function getThemeMeta(id: ThemeId): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function isKnownTheme(id: string | null): id is ThemeId {
  return !!id && THEMES.some((t) => t.id === id);
}

export function readSavedTheme(): ThemeId {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isKnownTheme(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function readSavedColors(): ColorOverrides {
  try {
    const raw = localStorage.getItem(COLORS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function persistTheme(theme: ThemeId): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export function persistColors(overrides: ColorOverrides): void {
  try {
    localStorage.setItem(COLORS_KEY, JSON.stringify(overrides));
  } catch {
    /* ignore */
  }
}

/** Applies a theme + custom colors to the document via the shared global. */
export function applyThemeToDom(theme: ThemeId, colors?: CustomColors): void {
  if (typeof window !== "undefined" && window.__homehubApplyTheme) {
    window.__homehubApplyTheme(theme, colors);
  } else if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
}
