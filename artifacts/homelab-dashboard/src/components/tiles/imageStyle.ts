import type { CSSProperties } from "react";
import type { Tile } from "@workspace/api-client-react";

// The nine anchor positions a tile image can be aligned to. Each maps to a CSS
// `object-position` (and matching `transform-origin` so zooming feels natural).
export const POSITION_OPTIONS = [
  { key: "top-left", label: "Top left", objectPosition: "left top" },
  { key: "top", label: "Top", objectPosition: "center top" },
  { key: "top-right", label: "Top right", objectPosition: "right top" },
  { key: "left", label: "Left", objectPosition: "left center" },
  { key: "center", label: "Center", objectPosition: "center center" },
  { key: "right", label: "Right", objectPosition: "right center" },
  { key: "bottom-left", label: "Bottom left", objectPosition: "left bottom" },
  { key: "bottom", label: "Bottom", objectPosition: "center bottom" },
  { key: "bottom-right", label: "Bottom right", objectPosition: "right bottom" },
] as const;

export type PositionKey = (typeof POSITION_OPTIONS)[number]["key"];

const POSITION_MAP: Record<string, string> = Object.fromEntries(
  POSITION_OPTIONS.map((p) => [p.key, p.objectPosition]),
);

// The object-fit modes offered in the editor. Legacy "center"/"top-left" fit
// values still render (see resolveImageStyle) but are no longer offered.
export const FIT_OPTIONS = [
  { value: "cover", label: "Cover" },
  { value: "contain", label: "Contain" },
  { value: "none", label: "Actual size" },
] as const;

export type FitValue = (typeof FIT_OPTIONS)[number]["value"];

export const DEFAULT_FIT: FitValue = "cover";
export const DEFAULT_POSITION: PositionKey = "center";
export const DEFAULT_SCALE = 100;
export const MIN_SCALE = 25;
export const MAX_SCALE = 300;

// ── Tile title styling (plain app/link tiles only) ─────────────────────────────
// Integration (widget) tiles keep their fixed header layout, so these helpers
// are intentionally only applied by AppTile.

// Title size keys → Tailwind text classes. "md" matches the historical default.
export const TITLE_SIZE_OPTIONS = [
  { value: "sm", label: "Small", className: "text-xs" },
  { value: "md", label: "Medium", className: "text-sm" },
  { value: "lg", label: "Large", className: "text-lg" },
  { value: "xl", label: "Extra large", className: "text-2xl" },
] as const;

export type TitleSize = (typeof TITLE_SIZE_OPTIONS)[number]["value"];

export const DEFAULT_TITLE_SIZE: TitleSize = "md";
export const DEFAULT_TITLE_POSITION: PositionKey = "center";

const TITLE_SIZE_MAP: Record<string, string> = Object.fromEntries(
  TITLE_SIZE_OPTIONS.map((s) => [s.value, s.className]),
);

// Map an anchor key to flexbox alignment + text-align so the title block can be
// placed in any of the nine positions within the tile.
const VERTICAL: Record<string, string> = { top: "justify-start", center: "justify-center", bottom: "justify-end" };
const HORIZONTAL: Record<string, string> = { left: "items-start", center: "items-center", right: "items-end" };
const TEXT_ALIGN: Record<string, string> = { left: "text-left", center: "text-center", right: "text-right" };

function splitAnchor(position: string): { v: string; h: string } {
  if (position === "center") return { v: "center", h: "center" };
  const [a, b] = position.split("-");
  // Single-axis keys: "top"/"bottom" (vertical) and "left"/"right" (horizontal).
  if (a === "top" || a === "bottom") return { v: a, h: b ?? "center" };
  if (a === "left" || a === "right") return { v: "center", h: a };
  return { v: "center", h: "center" };
}

export interface TitlePlacement {
  titleSize?: Tile["titleSize"];
  titlePosition?: Tile["titlePosition"];
}

// Resolve the title container alignment classes and the title text size class.
export function resolveTitleStyle(p: TitlePlacement): {
  containerClass: string;
  sizeClass: string;
  textAlignClass: string;
} {
  const size = (p.titleSize as TitleSize) ?? DEFAULT_TITLE_SIZE;
  const position = (p.titlePosition as PositionKey) ?? DEFAULT_TITLE_POSITION;
  const { v, h } = splitAnchor(position);

  return {
    containerClass: `${VERTICAL[v] ?? "justify-center"} ${HORIZONTAL[h] ?? "items-center"}`,
    sizeClass: TITLE_SIZE_MAP[size] ?? TITLE_SIZE_MAP[DEFAULT_TITLE_SIZE],
    textAlignClass: TEXT_ALIGN[h] ?? "text-center",
  };
}

// A subset of Tile fields the rendering helpers need. Lets callers (e.g. the
// editor's live preview) pass plain objects instead of a full Tile.
export interface ImagePlacement {
  imageFit?: Tile["imageFit"];
  imagePosition?: Tile["imagePosition"];
  imageScale?: Tile["imageScale"];
}

// Normalize a tile's (possibly legacy) placement into the editor's orthogonal
// model: a real object-fit mode + an anchor key + a zoom percentage.
export function normalizePlacement(p: ImagePlacement): {
  fit: FitValue;
  position: PositionKey;
  scale: number;
} {
  let fit: FitValue = DEFAULT_FIT;
  let position: PositionKey = (p.imagePosition as PositionKey) ?? DEFAULT_POSITION;

  switch (p.imageFit) {
    case "cover":
    case "contain":
    case "none":
      fit = p.imageFit;
      break;
    // Legacy values were object-none with a baked-in anchor.
    case "center":
      fit = "none";
      if (!p.imagePosition) position = "center";
      break;
    case "top-left":
      fit = "none";
      if (!p.imagePosition) position = "top-left";
      break;
    default:
      fit = DEFAULT_FIT;
  }

  const scale = p.imageScale ?? DEFAULT_SCALE;
  return { fit, position, scale };
}

// Build the className + inline style for a tile image, honoring fit, anchor
// position and zoom — and staying backward-compatible with legacy fit values.
export function resolveImageStyle(p: ImagePlacement): {
  className: string;
  style: CSSProperties;
} {
  const { fit, position, scale } = normalizePlacement(p);

  const objectFitClass =
    fit === "contain" ? "object-contain" : fit === "none" ? "object-none" : "object-cover";

  const objectPosition = POSITION_MAP[position] ?? POSITION_MAP["center"];

  const style: CSSProperties = { objectPosition };
  if (scale !== 100) {
    style.transform = `scale(${scale / 100})`;
    style.transformOrigin = objectPosition;
  }

  return { className: objectFitClass, style };
}
