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

// Each discrete anchor maps to an (x, y) percentage pair — the same coordinate
// space CSS `object-position` uses (0% 0% = top-left, 50% 50% = center,
// 100% 100% = bottom-right). Drag-to-pan produces arbitrary points in between.
const ANCHOR_PERCENT: Record<string, { x: number; y: number }> = {
  "top-left": { x: 0, y: 0 },
  top: { x: 50, y: 0 },
  "top-right": { x: 100, y: 0 },
  left: { x: 0, y: 50 },
  center: { x: 50, y: 50 },
  right: { x: 100, y: 50 },
  "bottom-left": { x: 0, y: 100 },
  bottom: { x: 50, y: 100 },
  "bottom-right": { x: 100, y: 100 },
};

// A custom focal point is stored in imagePosition as a CSS object-position value
// of the form "<x>% <y>%" (e.g. "37.5% 62%"), distinguishing it from the named
// anchor keys above. This keeps the existing string column doing double duty.
const FOCAL_POINT_RE = /^(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/;

export function isFocalPoint(position: string | null | undefined): boolean {
  return typeof position === "string" && FOCAL_POINT_RE.test(position);
}

export function parseFocalPoint(
  position: string | null | undefined,
): { x: number; y: number } | null {
  if (typeof position !== "string") return null;
  const m = FOCAL_POINT_RE.exec(position);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

// Format an (x, y) percentage pair into the stored focal-point string. Values
// are clamped to [0, 100] and rounded to one decimal to keep the string short.
export function formatFocalPoint(x: number, y: number): string {
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  const round = (n: number) => Math.round(clamp(n) * 10) / 10;
  return `${round(x)}% ${round(y)}%`;
}

// Resolve any stored imagePosition (named anchor or custom focal point) into the
// (x, y) percentages used by the drag interaction. Falls back to center.
export function positionToPercent(
  position: string | null | undefined,
): { x: number; y: number } {
  const focal = parseFocalPoint(position);
  if (focal) return focal;
  return ANCHOR_PERCENT[position ?? "center"] ?? ANCHOR_PERCENT["center"];
}

// Resolve any stored imagePosition into a CSS object-position value: a custom
// focal point passes through verbatim; a named anchor maps through POSITION_MAP.
export function resolveObjectPosition(position: string | null | undefined): string {
  if (isFocalPoint(position)) return position as string;
  return POSITION_MAP[position ?? "center"] ?? POSITION_MAP["center"];
}

// ── Free-transform pan (drag-to-reposition) ───────────────────────────────────
// Newer tiles store placement as a free 2D pan instead of a bounded anchor: the
// image is treated as a canvas and the tile as a viewport over it. The pan is a
// translate offset in percentages of the tile box (so it scales with the tile),
// stored as "pan(<x>,<y>)". Combined with imageScale it gives full freedom —
// drag works on both axes at any zoom, and the whole image stays manipulable
// (nothing is force-cropped to the tile's aspect ratio).
const PAN_RE = /^pan\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/;

// How far (in % of the tile box) the image may be panned in any direction.
// Keeps at least part of the image within view rather than letting it vanish.
export const PAN_LIMIT = 100;

export const DEFAULT_PAN = "pan(0,0)";

export function isPan(position: string | null | undefined): boolean {
  return typeof position === "string" && PAN_RE.test(position);
}

export function parsePan(
  position: string | null | undefined,
): { x: number; y: number } | null {
  if (typeof position !== "string") return null;
  const m = PAN_RE.exec(position);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

// Format an (x, y) translate pair (in % of the tile box) into the stored pan
// string. Values are clamped to ±PAN_LIMIT and rounded to one decimal.
export function formatPan(x: number, y: number): string {
  const clamp = (n: number) => Math.min(PAN_LIMIT, Math.max(-PAN_LIMIT, n));
  const round = (n: number) => Math.round(clamp(n) * 10) / 10;
  return `pan(${round(x)},${round(y)})`;
}

// The object-fit modes offered in the editor. Legacy "center"/"top-left" fit
// values still render (see resolveImageStyle) but are no longer offered.
export const FIT_OPTIONS = [
  { value: "contain", label: "Fit whole image" },
  { value: "cover", label: "Fill tile (crop)" },
  { value: "none", label: "Actual size" },
] as const;

export type FitValue = (typeof FIT_OPTIONS)[number]["value"];

// Fallback for legacy tiles whose imageFit was never set — keep the historical
// "cover" behavior so their appearance doesn't shift.
export const DEFAULT_FIT: FitValue = "cover";

// Default for a freshly chosen image in the editor: show the whole image so the
// user can pan/zoom the full picture rather than a forced crop.
export const DEFAULT_NEW_FIT: FitValue = "contain";
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
  // Either a named anchor key or a custom focal-point string ("<x>% <y>%").
  position: string;
  scale: number;
} {
  let fit: FitValue = DEFAULT_FIT;
  let position: string = p.imagePosition ?? DEFAULT_POSITION;

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

// The rendering of a tile image is split into a box-sized wrapper that carries
// the pan/zoom transform and the <img> that lives inside it. Keeping the wrapper
// box-sized means a pan translate of N% is always N% of the tile (not of the
// image), so drag stays 1:1 across fits and zoom levels; the image itself is
// free to overflow the wrapper (the tile container clips it), which is what lets
// "Actual size" reveal hidden parts as you pan instead of clipping at the box.
export interface ResolvedImageStyle {
  // Box-sized layer carrying the pan/zoom transform; the tile container clips it.
  wrapperClassName: string;
  wrapperStyle: CSSProperties;
  // The <img> rendered inside the wrapper.
  className: string;
  style: CSSProperties;
}

// Build the wrapper + img styling for a tile image, honoring fit, position and
// zoom. Two positioning models are supported:
//   • Free pan ("pan(x,y)") — the image is a canvas freely translated within the
//     tile viewport and scaled about its center. Drag works on both axes at any
//     zoom and the whole image stays manipulable (no forced aspect crop). For
//     "Actual size" the image renders at its natural size and overflows the
//     wrapper so the container clips it — panning reveals the off-screen parts.
//   • Legacy anchor / focal-point — kept so existing saved tiles render exactly
//     as before (object-position + scale about that point).
export function resolveImageStyle(p: ImagePlacement): ResolvedImageStyle {
  const { fit, position, scale } = normalizePlacement(p);

  const objectFitClass =
    fit === "contain" ? "object-contain" : fit === "none" ? "object-none" : "object-cover";

  const z = scale / 100;
  const pan = parsePan(position);
  if (pan) {
    // translate is resolved against the box-sized wrapper, so the pan is
    // independent of zoom and gives a 1:1 drag in either direction.
    const wrapperStyle: CSSProperties = {
      transform: `translate(${pan.x}%, ${pan.y}%) scale(${z})`,
      transformOrigin: "center",
    };

    if (fit === "none") {
      // Natural pixel size, centered, allowed to overflow the wrapper so the
      // tile container (overflow-hidden) clips it and panning reveals more.
      return {
        wrapperClassName: "absolute inset-0",
        wrapperStyle,
        className: "max-w-none max-h-none",
        style: {
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: "auto",
          height: "auto",
        },
      };
    }

    // contain / cover fill the box; zooming past 100% overflows and is clipped
    // by the tile container.
    return {
      wrapperClassName: "absolute inset-0",
      wrapperStyle,
      className: `absolute inset-0 w-full h-full ${objectFitClass}`,
      style: { objectPosition: "center" },
    };
  }

  const objectPosition = resolveObjectPosition(position);
  const style: CSSProperties = { objectPosition };
  if (scale !== 100) {
    style.transform = `scale(${z})`;
    style.transformOrigin = objectPosition;
  }

  return {
    wrapperClassName: "absolute inset-0",
    wrapperStyle: {},
    className: `absolute inset-0 w-full h-full ${objectFitClass}`,
    style,
  };
}
