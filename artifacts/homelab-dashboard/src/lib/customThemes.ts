// User-defined ("custom") dashboard themes. These are an ADDITIVE runtime path on
// top of the 6 hardcoded built-in themes: a custom theme is a small, fully
// validated JSON definition (colors + structural style only — never raw CSS) that
// the theming engine turns into CSS variables + data-* attributes at runtime.
//
// The actual DOM application lives in window.__homehubApplyTheme (index.html) so it
// can run before first paint. This module owns the FORMAT, VALIDATION, PERSISTENCE,
// EXPORT, and picker-preview derivation — all pure and unit-testable.

import type { ThemeMeta } from "./theme";

export const CUSTOM_THEMES_KEY = "homehub:customThemes";

/** Marker prefix for custom theme ids, so they never collide with built-ins. */
export const CUSTOM_THEME_PREFIX = "custom:";

export const SHADOW_STYLES = ["flat", "soft", "hard", "glow"] as const;
export const BACKGROUND_PATTERNS = ["none", "grid", "dots", "gradient"] as const;
export const HEADING_FONTS = ["sans", "serif"] as const;

export type ShadowStyle = (typeof SHADOW_STYLES)[number];
export type BackgroundPattern = (typeof BACKGROUND_PATTERNS)[number];
export type HeadingFont = (typeof HEADING_FONTS)[number];

/** The on-disk template file format users download, edit, and upload. */
export interface ThemeTemplateFile {
  /** Fixed discriminator so we can recognise our own files. */
  format: "homehub-theme";
  version: 1;
  /** Human-readable name shown in the theme picker. */
  name: string;
  /** Whether this theme reads as a dark surface (affects outlines/elevation). */
  dark: boolean;
  /** Base colors fed to the existing color-derivation engine. */
  colors: {
    primary: string;
    background: string;
  };
  /** Corner radius, e.g. "0.5rem" / "12px". */
  radius: string;
  /** CSS font stack, e.g. "'Inter', ui-sans-serif, system-ui, sans-serif". */
  font: string;
  /** Optional web-font stylesheet URL (Google Fonts / Bunny Fonts) to load. */
  fontUrl?: string;
  /** Elevation style. */
  shadow: ShadowStyle;
  /** Ambient page background pattern. */
  backgroundPattern: BackgroundPattern;
  /** Terminal-style UPPERCASE + wide tracking on labels. */
  uppercase: boolean;
  /** Heading typeface behaviour. */
  headingFont: HeadingFont;
}

/** A stored custom theme: the validated template plus a generated id. */
export interface CustomThemeDefinition extends ThemeTemplateFile {
  id: string;
}

export type CustomThemeMap = Record<string, CustomThemeDefinition>;

export type ValidationResult =
  | { ok: true; value: ThemeTemplateFile }
  | { ok: false; error: string };

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const LENGTH_RE = /^(\d+(?:\.\d+)?)(rem|px|em)$/;
// Font stacks are restricted to a safe charset so a value can never break out of
// the CSS custom property it is assigned to.
const FONT_RE = /^[A-Za-z0-9 ,_'"().\-]+$/;
const FONT_HOST_ALLOWLIST = ["fonts.googleapis.com", "fonts.gstatic.com", "fonts.bunny.net"];

const MAX_NAME = 40;
const MAX_FONT = 200;
const MAX_URL = 500;

export function isCustomThemeId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(CUSTOM_THEME_PREFIX);
}

/** Normalises a 3- or 6-digit hex to lowercase #rrggbb, or null if invalid. */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!HEX_RE.test(v)) return null;
  let m = v.replace(/^#/, "").toLowerCase();
  if (m.length === 3) m = m[0] + m[0] + m[1] + m[1] + m[2] + m[2];
  return `#${m}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates an unknown, parsed JSON value against the controlled template schema.
 * Every field is checked for type/range/enum; unknown fields are ignored rather
 * than applied. Returns a specific error string on the first failure.
 */
export function validateCustomTheme(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "Theme file must be a JSON object." };
  }

  if (raw.format !== "homehub-theme") {
    return { ok: false, error: 'Not a HomeHub theme file (missing format: "homehub-theme").' };
  }
  if (raw.version !== 1) {
    return { ok: false, error: "Unsupported theme version (expected version 1)." };
  }

  // name
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    return { ok: false, error: "Missing required field: name." };
  }
  const name = raw.name.trim();
  if (name.length > MAX_NAME) {
    return { ok: false, error: `Name is too long (max ${MAX_NAME} characters).` };
  }

  // dark
  if (typeof raw.dark !== "boolean") {
    return { ok: false, error: "Field 'dark' must be true or false." };
  }

  // colors
  if (!isPlainObject(raw.colors)) {
    return { ok: false, error: "Missing required field: colors." };
  }
  const primary = normalizeHexColor(raw.colors.primary);
  if (!primary) {
    return { ok: false, error: "Invalid color value for colors.primary (use a hex like #3b82f6)." };
  }
  const background = normalizeHexColor(raw.colors.background);
  if (!background) {
    return { ok: false, error: "Invalid color value for colors.background (use a hex like #0b0a1a)." };
  }

  // radius
  if (typeof raw.radius !== "string" || !LENGTH_RE.test(raw.radius.trim())) {
    return { ok: false, error: "Invalid radius value (use a length like 0.5rem, 12px, or 0px)." };
  }
  const radiusMatch = LENGTH_RE.exec(raw.radius.trim())!;
  const radiusNum = parseFloat(radiusMatch[1]);
  const radiusUnit = radiusMatch[2];
  const radiusMax = radiusUnit === "px" ? 48 : 4;
  if (radiusNum > radiusMax) {
    return { ok: false, error: `Radius is too large (max ${radiusMax}${radiusUnit}).` };
  }

  // font
  if (typeof raw.font !== "string" || raw.font.trim().length === 0) {
    return { ok: false, error: "Missing required field: font." };
  }
  const font = raw.font.trim();
  if (font.length > MAX_FONT) {
    return { ok: false, error: `Font value is too long (max ${MAX_FONT} characters).` };
  }
  if (!FONT_RE.test(font)) {
    return { ok: false, error: "Invalid font value (only letters, numbers, spaces, quotes, commas and hyphens are allowed)." };
  }

  // fontUrl (optional)
  let fontUrl: string | undefined;
  if (raw.fontUrl !== undefined && raw.fontUrl !== null && raw.fontUrl !== "") {
    if (typeof raw.fontUrl !== "string") {
      return { ok: false, error: "Field 'fontUrl' must be a string URL." };
    }
    const trimmed = raw.fontUrl.trim();
    if (trimmed.length > MAX_URL) {
      return { ok: false, error: `fontUrl is too long (max ${MAX_URL} characters).` };
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { ok: false, error: "Invalid fontUrl (must be a valid https URL)." };
    }
    if (parsed.protocol !== "https:") {
      return { ok: false, error: "fontUrl must use https." };
    }
    if (!FONT_HOST_ALLOWLIST.includes(parsed.hostname)) {
      return {
        ok: false,
        error: `fontUrl host not allowed (must be one of: ${FONT_HOST_ALLOWLIST.join(", ")}).`,
      };
    }
    fontUrl = trimmed;
  }

  // shadow
  if (typeof raw.shadow !== "string" || !SHADOW_STYLES.includes(raw.shadow as ShadowStyle)) {
    return { ok: false, error: `Field 'shadow' must be one of: ${SHADOW_STYLES.join(", ")}.` };
  }

  // backgroundPattern
  if (
    typeof raw.backgroundPattern !== "string" ||
    !BACKGROUND_PATTERNS.includes(raw.backgroundPattern as BackgroundPattern)
  ) {
    return {
      ok: false,
      error: `Field 'backgroundPattern' must be one of: ${BACKGROUND_PATTERNS.join(", ")}.`,
    };
  }

  // uppercase
  if (typeof raw.uppercase !== "boolean") {
    return { ok: false, error: "Field 'uppercase' must be true or false." };
  }

  // headingFont
  if (typeof raw.headingFont !== "string" || !HEADING_FONTS.includes(raw.headingFont as HeadingFont)) {
    return { ok: false, error: `Field 'headingFont' must be one of: ${HEADING_FONTS.join(", ")}.` };
  }

  const value: ThemeTemplateFile = {
    format: "homehub-theme",
    version: 1,
    name,
    dark: raw.dark,
    colors: { primary, background },
    radius: raw.radius.trim(),
    font,
    shadow: raw.shadow as ShadowStyle,
    backgroundPattern: raw.backgroundPattern as BackgroundPattern,
    uppercase: raw.uppercase,
    headingFont: raw.headingFont as HeadingFont,
  };
  if (fontUrl) value.fontUrl = fontUrl;

  return { ok: true, value };
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "theme";
}

/** Generates a unique custom theme id from a name. */
export function generateCustomThemeId(name: string, existing: CustomThemeMap = {}): string {
  const base = `${CUSTOM_THEME_PREFIX}${slugify(name)}`;
  let id = `${base}-${Math.random().toString(36).slice(2, 8)}`;
  while (existing[id]) {
    id = `${base}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return id;
}

/** Turns a validated template into a stored definition with a fresh id. */
export function createCustomTheme(
  template: ThemeTemplateFile,
  existing: CustomThemeMap = {},
): CustomThemeDefinition {
  return { ...template, id: generateCustomThemeId(template.name, existing) };
}

export function readCustomThemes(): CustomThemeMap {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return {};
    // Defensively re-validate each stored entry so a hand-edited/corrupt
    // localStorage value can never feed malformed data to the runtime.
    const out: CustomThemeMap = {};
    for (const [id, def] of Object.entries(parsed)) {
      if (!isCustomThemeId(id)) continue;
      const result = validateCustomTheme(def);
      if (result.ok) out[id] = { ...result.value, id };
    }
    return out;
  } catch {
    return {};
  }
}

export function persistCustomThemes(map: CustomThemeMap): void {
  try {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

/** Lightens (amount > 0) or darkens (amount < 0) a hex color by a percentage. */
export function shadeHex(hex: string, amount: number): string {
  const norm = normalizeHexColor(hex);
  if (!norm) return hex;
  const m = norm.slice(1);
  const channels = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
  const adjusted = channels.map((c) => {
    const next = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(next)));
  });
  return `#${adjusted.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Builds picker-preview metadata for a custom theme (mirrors built-in ThemeMeta). */
export function customThemeMeta(def: CustomThemeDefinition): ThemeMeta {
  return {
    id: def.id as ThemeMeta["id"],
    name: def.name,
    description: "Custom theme",
    dark: def.dark,
    radius: def.radius,
    font: def.font,
    swatch: {
      background: def.colors.background,
      surface: shadeHex(def.colors.background, def.dark ? 0.1 : -0.05),
      primary: def.colors.primary,
      accent: def.colors.primary,
    },
    defaults: { primary: def.colors.primary, background: def.colors.background },
  };
}

/** Serializes a template to a pretty-printed, downloadable JSON string. */
export function serializeTemplate(template: ThemeTemplateFile): string {
  // Stable key order so a downloaded file reads predictably top-to-bottom.
  const ordered: ThemeTemplateFile = {
    format: "homehub-theme",
    version: 1,
    name: template.name,
    dark: template.dark,
    colors: { primary: template.colors.primary, background: template.colors.background },
    radius: template.radius,
    font: template.font,
    shadow: template.shadow,
    backgroundPattern: template.backgroundPattern,
    uppercase: template.uppercase,
    headingFont: template.headingFont,
  };
  if (template.fontUrl) ordered.fontUrl = template.fontUrl;
  return JSON.stringify(ordered, null, 2);
}
