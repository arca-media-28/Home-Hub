import { useEffect, useRef, useState } from "react";
import type { Tile } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Aquarium tile: a purely-cosmetic live fish tank. Fish idle-swim across the
// tank on looping CSS keyframe paths, and the number of fish/props scales with
// the tile's rendered pixel area (via ResizeObserver). All choices (three fish
// species slots, sand color, three prop slots) persist in tileSettings and are
// edited in the tile modal. In locked mode the tank is lightly interactive:
// clicking a fish makes it dart in a quick burst, and clicking the water drops
// a food pellet that sinks while the nearest fish swims over and eats it. Both
// are transient one-off animations — nothing persists.
// ---------------------------------------------------------------------------

export const NONE_SLOT = "none";

export const AQUARIUM_FISH_OPTIONS: { value: string; label: string }[] = [
  { value: "clownfish", label: "Clownfish" },
  { value: "bluetang", label: "Blue Tang" },
  { value: "angelfish", label: "Angelfish" },
  { value: "pufferfish", label: "Pufferfish" },
  { value: "goldfish", label: "Goldfish" },
  { value: "betta", label: "Betta" },
];

export const AQUARIUM_PROP_OPTIONS: { value: string; label: string }[] = [
  { value: "seaweed", label: "Seaweed" },
  { value: "coral", label: "Coral" },
  { value: "chest", label: "Treasure chest" },
  { value: "anchor", label: "Anchor" },
  { value: "castle", label: "Castle ruin" },
  { value: "rock", label: "Rock" },
];

// Preset sand swatches; a custom #hex stored on the tile is used directly.
export const AQUARIUM_SAND_COLORS: { value: string; label: string; color: string }[] = [
  { value: "white", label: "White sand", color: "#e9e2cf" },
  { value: "tan", label: "Tan", color: "#d9b98c" },
  { value: "dark", label: "Dark sand", color: "#8a6e4b" },
];

export const DEFAULT_FISH_TYPES = ["clownfish", "bluetang", NONE_SLOT];
export const DEFAULT_SAND_COLOR = "tan";
export const DEFAULT_PROPS = ["seaweed", "coral", NONE_SLOT];

// The tank's mood follows the time of day: "calm" is the original look
// (mornings and early afternoon), "lively" speeds everything up and adds
// extra bubbles/particles (from around 1 PM), and "night" darkens the water,
// dims the light, and slows the motion down (after 8 PM until morning).
export type AquariumMood = "calm" | "lively" | "night";

export function moodForHour(hour: number): AquariumMood {
  if (hour >= 20 || hour < 7) return "night";
  if (hour >= 13) return "lively";
  return "calm";
}

// Deterministic per-mood tuning applied on top of the per-index jitter:
// `speedMult` scales every looping animation duration (bigger = slower),
// `extraStreams`/`particleMult` adjust ambient density, and night mode swaps
// the water gradient and dims the rays/shimmer via `lightOpacity`.
const MOOD_CONFIG: Record<
  AquariumMood,
  {
    speedMult: number;
    extraStreams: number;
    particleMult: number;
    minParticles: number;
    lightOpacity: number;
    waterStops: [string, string, string];
  }
> = {
  calm: {
    speedMult: 1,
    extraStreams: 0,
    particleMult: 1,
    minParticles: 0,
    lightOpacity: 1,
    waterStops: ["#7ec3e8", "#3f8fc4", "#1e5f92"],
  },
  lively: {
    speedMult: 0.6,
    extraStreams: 2,
    particleMult: 1.75,
    minParticles: 4,
    lightOpacity: 1,
    waterStops: ["#7ec3e8", "#3f8fc4", "#1e5f92"],
  },
  night: {
    speedMult: 1.6,
    extraStreams: -1,
    particleMult: 0.6,
    minParticles: 0,
    lightOpacity: 0.35,
    waterStops: ["#2c4a6b", "#17304f", "#0a1c33"],
  },
};

export function resolveSandColor(value: string | null | undefined): string {
  if (typeof value === "string" && value.startsWith("#")) return value;
  const preset = AQUARIUM_SAND_COLORS.find((p) => p.value === value);
  return preset?.color ?? AQUARIUM_SAND_COLORS[1]!.color;
}

// Normalize a stored 3-slot array: keep known keys, pad/truncate to 3 slots.
function normalizeSlots(
  raw: string[] | null | undefined,
  known: Set<string>,
  fallback: string[],
): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const slots = raw
    .slice(0, 3)
    .map((v) => (known.has(v) ? v : NONE_SLOT));
  while (slots.length < 3) slots.push(NONE_SLOT);
  return slots;
}

const FISH_KEYS = new Set(AQUARIUM_FISH_OPTIONS.map((o) => o.value));
const PROP_KEYS = new Set(AQUARIUM_PROP_OPTIONS.map((o) => o.value));

// Drawing coordinate space. The height is fixed and the width is derived from
// the tile's measured aspect ratio, so the viewBox maps 1:1 onto the visible
// tile — nothing is cropped and the tank walls ARE the tile edges.
const VB_H = 140;
const DEFAULT_VB_W = 240;
const SAND_H = 18;
// How far a fish center keeps from the glass so even the largest fish turns
// fully inside the tank instead of poking through the walls.
const WALL_MARGIN = 20;

// Deterministic per-index pseudo-random in [0, 1) so each fish keeps its lane,
// speed and size across re-renders (no state churn, no Math.random flicker).
function jitter(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// -----------------------------------------------------------------------
// Fish silhouettes. Each species is a small <g> drawn facing RIGHT around a
// local origin at the fish's center, roughly 24 units long, with a distinct
// compound shape and color so the species read clearly at tile size.
// -----------------------------------------------------------------------

function FishShape({ species }: { species: string }) {
  switch (species) {
    case "clownfish":
      return (
        <g>
          <ellipse cx={0} cy={0} rx={10} ry={6} fill="#f4772e" />
          <path d="M-10 0 L-16 -5 L-16 5 Z" fill="#f4772e" />
          {/* White stripes with dark edging */}
          <path d="M-4 -5.4 L-1.5 -5.7 L-1.5 5.7 L-4 5.4 Z" fill="#ffffff" stroke="#2b2b2b" strokeWidth={0.5} />
          <path d="M4 -4.8 L6 -4 L6 4 L4 4.8 Z" fill="#ffffff" stroke="#2b2b2b" strokeWidth={0.5} />
          <circle cx={7} cy={-1.4} r={1.1} fill="#222" />
        </g>
      );
    case "bluetang":
      return (
        <g>
          <ellipse cx={0} cy={0} rx={11} ry={6.5} fill="#2f6fd6" />
          <path d="M-9 0 L-16 -4.5 L-16 4.5 Z" fill="#f5d02c" />
          <path d="M-6 -1 Q2 -4 8 -0.5 Q2 2 -6 1 Z" fill="#173a75" opacity={0.85} />
          <circle cx={7.5} cy={-1.6} r={1.1} fill="#111" />
        </g>
      );
    case "angelfish":
      return (
        <g>
          {/* Tall, laterally-compressed body with sweeping dorsal/anal fins */}
          <path d="M-4 0 Q-2 -11 4 -9 Q10 -5 10 0 Q10 5 4 9 Q-2 11 -4 0 Z" fill="#f2c02e" />
          <path d="M-4 0 L-13 -6 L-13 6 Z" fill="#f2c02e" />
          <path d="M0 -9.6 L1.8 -9.4 L2.4 9.4 L0.6 9.6 Z" fill="#3b3b3b" opacity={0.8} />
          <path d="M5 -7.6 L6.6 -6.6 L7 6.6 L5.6 7.6 Z" fill="#3b3b3b" opacity={0.8} />
          <circle cx={7.6} cy={-1.8} r={1} fill="#111" />
        </g>
      );
    case "pufferfish":
      return (
        <g>
          <circle cx={0} cy={0} r={8} fill="#d9c268" />
          {/* Spikes around the body */}
          {Array.from({ length: 8 }, (_, k) => {
            const a = (k / 8) * Math.PI * 2 + 0.4;
            const x1 = Math.cos(a) * 7.6;
            const y1 = Math.sin(a) * 7.6;
            const x2 = Math.cos(a) * 10.4;
            const y2 = Math.sin(a) * 10.4;
            return (
              <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#a8934a" strokeWidth={1.2} strokeLinecap="round" />
            );
          })}
          <path d="M-8 0 L-13 -3.5 L-13 3.5 Z" fill="#d9c268" />
          <ellipse cx={0} cy={3.2} rx={5} ry={2.6} fill="#f2ead0" />
          <circle cx={4.4} cy={-2} r={1.3} fill="#111" />
        </g>
      );
    case "goldfish":
      return (
        <g>
          <ellipse cx={0} cy={0} rx={9} ry={5.6} fill="#f59a23" />
          {/* Flowing double tail */}
          <path d="M-8 0 Q-14 -7 -17 -4 Q-13 -1 -16 1 Q-13 2 -17 5 Q-13 7 -8 0 Z" fill="#f7b24e" />
          <path d="M-1 -5.4 Q2 -9 5 -6 Q3 -4 1 -4.6 Z" fill="#f7b24e" />
          <circle cx={6.4} cy={-1.2} r={1.1} fill="#111" />
        </g>
      );
    case "betta":
      return (
        <g>
          <ellipse cx={1} cy={0} rx={8} ry={4.6} fill="#8a3fd1" />
          {/* Huge veiled tail + fins */}
          <path d="M-6 0 Q-12 -9 -18 -7 Q-14 -3 -17 0 Q-14 3 -18 7 Q-12 9 -6 0 Z" fill="#c05ae0" opacity={0.9} />
          <path d="M0 -4.4 Q3 -10 7 -7 Q4 -4 2 -3.8 Z" fill="#c05ae0" opacity={0.9} />
          <path d="M0 4.4 Q3 10 7 7 Q4 4 2 3.8 Z" fill="#c05ae0" opacity={0.9} />
          <circle cx={7} cy={-1} r={1} fill="#111" />
        </g>
      );
    default:
      return null;
  }
}

// -----------------------------------------------------------------------
// Props, each drawn sitting on y=0 (the sand line) around a local x origin.
// -----------------------------------------------------------------------

function PropShape({ prop }: { prop: string }) {
  switch (prop) {
    case "seaweed":
      return (
        <g className="aq-sway">
          <path d="M0 0 C-3 -8 3 -14 -1 -24" stroke="#2f8f4e" strokeWidth={2.4} fill="none" strokeLinecap="round" />
          <path d="M4 0 C7 -6 1 -12 5 -18" stroke="#3aa85f" strokeWidth={2} fill="none" strokeLinecap="round" />
          <path d="M-4 0 C-7 -5 -2 -9 -6 -14" stroke="#27753f" strokeWidth={1.8} fill="none" strokeLinecap="round" />
        </g>
      );
    case "coral":
      return (
        <g>
          <path d="M0 0 L0 -10 M0 -6 L-5 -13 M0 -6 L5 -12 M-5 -13 L-8 -16 M5 -12 L8 -16 M0 -10 L-2 -17" stroke="#e0656b" strokeWidth={2.6} fill="none" strokeLinecap="round" />
        </g>
      );
    case "chest":
      return (
        <g>
          <rect x={-8} y={-9} width={16} height={9} rx={1} fill="#8a5a2b" />
          <path d="M-8 -9 Q0 -16 8 -9 Z" fill="#a8703a" />
          <rect x={-8} y={-9.6} width={16} height={1.6} fill="#e2c044" />
          <rect x={-1.4} y={-9} width={2.8} height={4} fill="#e2c044" />
        </g>
      );
    case "anchor":
      return (
        <g stroke="#6b7683" strokeWidth={2.2} fill="none" strokeLinecap="round">
          <line x1={0} y1={-2} x2={0} y2={-18} />
          <path d="M-7 -6 Q0 2 7 -6" />
          <line x1={-4} y1={-15} x2={4} y2={-15} />
          <circle cx={0} cy={-20} r={2} />
        </g>
      );
    case "castle":
      return (
        <g fill="#a9a29a">
          <rect x={-9} y={-14} width={18} height={14} />
          <rect x={-11} y={-20} width={5} height={20} />
          <rect x={6} y={-20} width={5} height={20} />
          <path d="M-11 -20 h1.6 v-2 h1.8 v2 h1.6 v2 h-5 Z" fill="#8f8880" />
          <path d="M6 -20 h1.6 v-2 h1.8 v2 h1.6 v2 h-5 Z" fill="#8f8880" />
          <rect x={-2} y={-8} width={4} height={8} rx={2} fill="#5c564f" />
          <rect x={-6.5} y={-12} width={2.4} height={3.4} rx={1.2} fill="#5c564f" />
          <rect x={4.1} y={-12} width={2.4} height={3.4} rx={1.2} fill="#5c564f" />
        </g>
      );
    case "rock":
      return (
        <g>
          <path d="M-9 0 Q-8 -8 -2 -9 Q5 -10 8 -4 Q10 0 9 0 Z" fill="#7d7a74" />
          <path d="M-4 -8.6 Q0 -11 3 -9 Q0 -8 -1 -7.4 Z" fill="#93908a" />
        </g>
      );
    default:
      return null;
  }
}

// One swimming fish instance: the outer group loops across the tank
// (translateX keyframes), the inner group flips horizontally on the return
// leg, and a slight vertical bob keeps the motion organic. All animation
// parameters are deterministic per index.
interface FishInstance {
  species: string;
  y: number;
  scale: number;
  duration: number;
  delay: number;
  bobDuration: number;
}

function buildFish(species: string[], count: number): FishInstance[] {
  const chosen = species.filter((s) => s !== NONE_SLOT && FISH_KEYS.has(s));
  if (chosen.length === 0) return [];
  const swimTop = 12;
  const swimBottom = VB_H - SAND_H - 14;
  return Array.from({ length: count }, (_, i) => {
    const sp = chosen[i % chosen.length]!;
    return {
      species: sp,
      y: swimTop + jitter(i, 1) * (swimBottom - swimTop),
      scale: 0.55 + jitter(i, 2) * 0.55,
      duration: 14 + jitter(i, 3) * 16,
      delay: -jitter(i, 4) * 30,
      bobDuration: 3 + jitter(i, 5) * 3,
    };
  });
}

// One bubble stream: a fixed x position on the sand emitting a few staggered
// bubbles that rise, wiggle sideways, and fade ("pop") near the surface.
// Everything is deterministic per stream/bubble index — CSS keyframes only.
interface BubbleInstance {
  r: number;
  duration: number;
  delay: number;
  wiggleDuration: number;
}

interface BubbleStream {
  xFrac: number; // fraction of tank width, resolved at render
  bubbles: BubbleInstance[];
}

function buildBubbleStreams(count: number): BubbleStream[] {
  return Array.from({ length: count }, (_, i) => {
    const perStream = 2 + (jitter(i, 11) > 0.5 ? 1 : 0);
    return {
      xFrac: 0.12 + jitter(i, 10) * 0.76,
      bubbles: Array.from({ length: perStream }, (_, b) => {
        const k = i * 7 + b;
        return {
          r: 1.2 + jitter(k, 12) * 1.6,
          duration: 6 + jitter(k, 13) * 5,
          delay: -jitter(k, 14) * 16,
          wiggleDuration: 1.6 + jitter(k, 15) * 1.4,
        };
      }),
    };
  });
}

// Faint drifting particles (plankton/dust) that ride the water on larger
// tiles. Each one slowly drifts sideways while bobbing a little; everything is
// deterministic per index — CSS keyframes only.
interface ParticleInstance {
  xFrac: number; // fraction of tank width
  y: number; // viewBox y
  r: number;
  driftDuration: number;
  driftDelay: number;
  bobDuration: number;
  opacity: number;
}

function buildParticles(count: number): ParticleInstance[] {
  return Array.from({ length: count }, (_, i) => ({
    xFrac: 0.06 + jitter(i, 20) * 0.88,
    y: 14 + jitter(i, 21) * (VB_H - SAND_H - 24),
    r: 0.5 + jitter(i, 22) * 0.7,
    driftDuration: 18 + jitter(i, 23) * 20,
    driftDelay: -jitter(i, 24) * 38,
    bobDuration: 5 + jitter(i, 25) * 5,
    opacity: 0.18 + jitter(i, 26) * 0.22,
  }));
}

interface AquariumTileProps {
  tile: Tile;
  editMode: boolean;
}

// A dropped food pellet: sinks from the click point down to the sand, then is
// removed. Purely transient client state — nothing persists.
interface Pellet {
  id: number;
  x: number; // viewBox x
  y: number; // viewBox y where it was dropped
}

const PELLET_SINK_MS = 2600;
const DART_MS = 1100;
// After eating, the fish swims back up to its own lane before the ambient
// loop takes over again.
const FEED_BACK_MS = 700;
// One-off "chomp" flourish at the pellet's landing point when the fish
// arrives: crumb particles scatter, a couple of tiny bubbles puff up, and the
// fish itself does a quick mouth-wiggle pulse. Purely cosmetic and transient;
// it overlaps the swim-back without touching the feeding state machine.
const CHOMP_MS = 650;

// Lowest y a fish center aims for: slightly above the sand line, so if the
// pellet has fully landed the fish's mouth still meets it rather than
// burrowing into the sand.
const FEED_LAND_Y = VB_H - SAND_H - 8;
// Where a sinking pellet ends up (matches the --aq-sink target below).
const PELLET_REST_Y = VB_H - SAND_H - 2;

// The pellet sinks with CSS `ease-in` = cubic-bezier(0.42, 0, 1, 1). To meet
// the pellet mid-sink, predict its progress at a given time fraction: solve
// the bezier's x-curve for the parameter, then evaluate the y-curve (which
// for these control points is smoothstep 3t² - 2t³).
function easeInProgress(timeFrac: number): number {
  const f = Math.min(1, Math.max(0, timeFrac));
  // Bisection on B_x(t) = 3·0.42·t(1-t)² + 3·1·t²(1-t) + t³ (monotonic).
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const inv = 1 - mid;
    const x = 3 * 0.42 * mid * inv * inv + 3 * mid * mid * inv + mid * mid * mid;
    if (x < f) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return t * t * (3 - 2 * t);
}

// A fish currently swimming to dropped food. `x`/`y` are the inline transform
// target in viewBox units; the element CSS-transitions toward them.
interface Feeding {
  fishIndex: number;
  pelletId: number;
  x: number;
  y: number;
  dir: 1 | -1;
  durMs: number;
  // "start" places the fish at its measured position with no transition;
  // "to" glides it to the pellet; "back" returns it to its swim lane.
  phase: "start" | "to" | "back";
}

// A one-off eat flourish at the pellet's landing point. `dir` mirrors the
// eating fish so crumbs scatter away from its mouth.
interface Chomp {
  id: number;
  x: number;
  y: number;
  dir: 1 | -1;
}

// The ambient swim loop uses CSS `ease-in-out` = cubic-bezier(0.42,0,0.58,1),
// whose output curve is exactly smoothstep: y = 3t² - 2t³. To resume the loop
// at a given x without a snap we invert the easing: find the keyframe time
// fraction whose eased output equals `frac`.
function inverseEaseInOut(frac: number): number {
  const f = Math.min(1, Math.max(0, frac));
  // Bisection on y(t) = 3t² - 2t³ (monotonic on [0,1]).
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const y = mid * mid * (3 - 2 * mid);
    if (y < f) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  // Convert curve parameter t back to input time via B_x(t) for
  // cubic-bezier(0.42, 0, 0.58, 1).
  const inv = 1 - t;
  return 3 * 0.42 * t * inv * inv + 3 * 0.58 * t * t * inv + t * t * t;
}

export default function AquariumTile({ tile, editMode }: AquariumTileProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Rendered pixel size, observed so fish/prop counts track the tile's real
  // on-screen area (grid resizes, fixed-scale pages, window changes).
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      // Ignore zero-size passes (display:none, initial layout) so counts
      // don't collapse and re-expand.
      if (rect.width < 4 || rect.height < 4) return;
      setSize((prev) =>
        Math.abs(prev.w - rect.width) > 8 || Math.abs(prev.h - rect.height) > 8
          ? { w: rect.width, h: rect.height }
          : prev,
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Transient interaction state (locked mode only): fish currently darting
  // after a click, dropped food pellets, the one fish swimming to dropped
  // food, and per-fish swim-loop delay overrides used to resume the ambient
  // loop at the fish's post-meal position without a snap.
  const [dartingFish, setDartingFish] = useState<Record<number, number>>({});
  const [pellets, setPellets] = useState<Pellet[]>([]);
  const [feeding, setFeeding] = useState<Feeding | null>(null);
  const [chomps, setChomps] = useState<Chomp[]>([]);
  const [fishDelays, setFishDelays] = useState<Record<number, number>>({});
  const pelletIdRef = useRef(0);
  const timeoutsRef = useRef<number[]>([]);
  // Refs to each fish's innermost shape group so its live on-screen position
  // (driven by CSS animations) can be measured at click time.
  const fishShapeRefs = useRef<(SVGGElement | null)[]>([]);

  useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      timeouts.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const later = (fn: () => void, ms: number) => {
    timeoutsRef.current.push(window.setTimeout(fn, ms));
  };

  // The mood tracks the wall clock (night after 8 PM, lively from 1 PM,
  // calm in between); re-check once a minute so the tank transitions on
  // its own while the dashboard stays open.
  const [mood, setMood] = useState<AquariumMood>(() => moodForHour(new Date().getHours()));
  useEffect(() => {
    const id = window.setInterval(() => {
      setMood(moodForHour(new Date().getHours()));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const s = tile.tileSettings;
  const fishTypes = normalizeSlots(s?.aquariumFishTypes, FISH_KEYS, DEFAULT_FISH_TYPES);
  const propSlots = normalizeSlots(s?.aquariumProps, PROP_KEYS, DEFAULT_PROPS);
  const sand = resolveSandColor(s?.aquariumSandColor);
  const moodCfg = MOOD_CONFIG[mood];

  // Fish count scales with rendered area: a small tile (~200x150) shows 2-4
  // fish, a large one (~800x600+) shows 8-14. Props unlock with area too:
  // 1 slot on small tiles, up to all 3 on large ones.
  const area = size.w * size.h;
  const fishCount = Math.max(2, Math.min(14, Math.round(2 + area / 40_000)));
  const propBudget = area >= 240_000 ? 3 : area >= 80_000 ? 2 : 1;

  const fish = buildFish(fishTypes, fishCount);
  const props = propSlots.filter((p) => p !== NONE_SLOT).slice(0, propBudget);
  // A couple of bubble streams on small tiles, a few more on big tanks; the
  // mood adds or removes a couple on top of the area-based count.
  const baseStreams = Math.max(2, Math.min(5, Math.round(1 + area / 120_000)));
  const streamCount = Math.max(1, Math.min(7, baseStreams + moodCfg.extraStreams));
  const streams = buildBubbleStreams(streamCount);
  // Faint drifting particles only appear on larger tiles where the extra
  // motion reads as atmosphere rather than clutter (0 on small tiles) —
  // except in lively mood, which always keeps a few motes drifting.
  const baseParticles = area >= 240_000 ? 8 : area >= 80_000 ? 4 : 0;
  const particleCount = Math.max(
    moodCfg.minParticles,
    Math.round(baseParticles * moodCfg.particleMult),
  );
  const particles = buildParticles(particleCount);
  // 2 light rays on wide tanks, 1 on narrow ones.
  const rayCount = area >= 80_000 ? 2 : 1;

  // Match the drawing width to the tile's aspect ratio so the whole tank is
  // visible (no slice-cropping) and the fish's turnaround points sit just
  // inside the visible tile edges.
  const aspect = size.w > 0 && size.h > 0 ? size.w / size.h : DEFAULT_VB_W / VB_H;
  const vbW = Math.max(90, Math.round(VB_H * aspect));
  const swimMin = WALL_MARGIN;
  const swimMax = Math.max(swimMin + 10, vbW - WALL_MARGIN);

  // Clicking a fish makes it dart: bump a per-index nonce (so a re-click
  // restarts the animation via a fresh key) and clear it after the burst.
  const handleFishClick = (i: number, e: React.MouseEvent) => {
    if (editMode) return;
    e.stopPropagation();
    setDartingFish((prev) => ({ ...prev, [i]: (prev[i] ?? 0) + 1 }));
    later(() => {
      setDartingFish((prev) => {
        if (!(i in prev)) return prev;
        const next = { ...prev };
        delete next[i];
        return next;
      });
    }, DART_MS);
  };

  // Clicking the water drops a food pellet at the click point; the nearest
  // fish turns toward it, swims over, eats it, and rejoins its swim loop.
  const handleTankClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (editMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const x = ((e.clientX - rect.left) / rect.width) * vbW;
    const y = ((e.clientY - rect.top) / rect.height) * VB_H;
    // Ignore clicks in the sand — pellets sink onto it, not into it.
    if (y > VB_H - SAND_H) return;
    const id = ++pelletIdRef.current;
    const pelletX = x;
    const pelletY = Math.max(6, y);
    setPellets((prev) => [...prev.slice(-5), { id, x: pelletX, y: pelletY }]);
    later(() => setPellets((prev) => prev.filter((p) => p.id !== id)), PELLET_SINK_MS);

    // Send the nearest fish to the food. Skipped under reduced motion (the
    // ambient loop is frozen anyway) and while another meal is in progress —
    // rapid re-clicks just drop extra pellets.
    if (feeding !== null || fish.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Fish move via CSS animations, so live positions must be measured from
    // the rendered elements, not derived from state.
    let bestIdx = -1;
    let bestDist = Infinity;
    let bestX = 0;
    let bestY = 0;
    fishShapeRefs.current.forEach((el, i) => {
      if (!el || !fish[i]) return;
      const b = el.getBoundingClientRect();
      if (b.width < 1 && b.height < 1) return;
      const cx = ((b.left + b.width / 2 - rect.left) / rect.width) * vbW;
      const cy = ((b.top + b.height / 2 - rect.top) / rect.height) * VB_H;
      const d = Math.hypot(cx - pelletX, cy - pelletY);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
        bestX = cx;
        bestY = cy;
      }
    });
    if (bestIdx < 0) return;

    const target = fish[bestIdx]!;
    const eatX = Math.min(swimMax, Math.max(swimMin, pelletX));
    const dir: 1 | -1 = eatX >= bestX ? 1 : -1;
    // The fish is positioned by its body CENTER, but it should collect the
    // food with its mouth: offset the center back from the pellet by roughly
    // the snout distance (fish shapes face right with mouths ~9 local units
    // ahead of center, scaled per fish). Clamped to the swim range so the
    // hand-back math stays valid.
    const fishX = Math.min(swimMax, Math.max(swimMin, eatX - dir * 9 * target.scale));
    // Meet the pellet where it actually IS when the fish arrives, not where
    // it will eventually land — the pellet is usually still mid-sink. Predict
    // its y from the sink easing at the arrival time; since the travel time
    // itself depends on the distance, refine the estimate once.
    const sinkDist = Math.max(4, PELLET_REST_Y - pelletY);
    const pelletYAt = (ms: number) =>
      Math.min(FEED_LAND_Y, pelletY + sinkDist * easeInProgress(ms / PELLET_SINK_MS));
    const durFor = (y: number) =>
      Math.min(
        PELLET_SINK_MS - 200,
        Math.max(650, Math.round(Math.hypot(fishX - bestX, y - bestY) * 16)),
      );
    let toDur = durFor(pelletYAt(1000));
    toDur = durFor(pelletYAt(toDur));
    const eatY = pelletYAt(toDur);

    // Phase 1: pin the fish at its measured position (no transition)...
    setFeeding({ fishIndex: bestIdx, pelletId: id, x: bestX, y: bestY, dir, durMs: toDur, phase: "start" });
    // ...then glide it to where the pellet will be on arrival.
    later(() => {
      setFeeding((cur) =>
        cur && cur.pelletId === id ? { ...cur, x: fishX, y: eatY, phase: "to" } : cur,
      );
    }, 30);
    // Phase 2: eat (remove the pellet), play a one-off chomp flourish at the
    // meeting point, and swim back up to its own lane.
    later(() => {
      setPellets((prev) => prev.filter((p) => p.id !== id));
      setChomps((prev) => [...prev.slice(-3), { id, x: eatX, y: eatY, dir }]);
      later(() => setChomps((prev) => prev.filter((c) => c.id !== id)), CHOMP_MS);
      setFeeding((cur) =>
        cur && cur.pelletId === id
          ? { ...cur, x: fishX, y: target.y, durMs: FEED_BACK_MS, phase: "back" }
          : cur,
      );
    }, 30 + toDur);
    // Phase 3: hand back to the ambient loop. The loop's position is fully
    // determined by its (negative) delay, so pick a delay that puts the fish
    // exactly at (fishX, its lane y) moving in its current direction.
    later(() => {
      const range = swimMax - swimMin;
      const frac = range > 0 ? (dir === 1 ? fishX - swimMin : swimMax - fishX) / range : 0;
      const half = inverseEaseInOut(frac) * 0.5;
      const phasePos = dir === 1 ? half : 0.5 + half;
      setFishDelays((prev) => ({
        ...prev,
        [bestIdx]: -phasePos * target.duration * moodCfg.speedMult,
      }));
      setFeeding((cur) => (cur && cur.pelletId === id ? null : cur));
    }, 30 + toDur + FEED_BACK_MS);
  };

  return (
    <div ref={rootRef} className="absolute inset-0 overflow-hidden rounded-[inherit]">
      <style>{`
        @keyframes aq-swim-${tile.id} {
          0%   { transform: translateX(${swimMin}px); }
          50%  { transform: translateX(${swimMax}px); }
          100% { transform: translateX(${swimMin}px); }
        }
        @keyframes aq-flip {
          0%, 49.999% { transform: scaleX(1); }
          50%, 100%   { transform: scaleX(-1); }
        }
        @keyframes aq-bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(3px); }
        }
        @keyframes aq-prop-sway {
          0%, 100% { transform: rotate(-4deg); }
          50%      { transform: rotate(4deg); }
        }
        .aq-fish { animation: aq-swim-${tile.id} var(--aq-dur) ease-in-out infinite; animation-delay: var(--aq-delay); }
        .aq-fish-flip { animation: aq-flip var(--aq-dur) step-end infinite; animation-delay: var(--aq-delay); }
        .aq-fish-bob { animation: aq-bob var(--aq-bob) ease-in-out infinite; }
        .aq-sway { animation: aq-prop-sway ${(5 * moodCfg.speedMult).toFixed(1)}s ease-in-out infinite; transform-origin: 0 0; transform-box: fill-box; }
        /* Bubbles rise from the sand line to just under the surface, fading
           out ("pop") at the top. Distance is fixed because VB_H is fixed. */
        @keyframes aq-bubble-rise {
          0%   { transform: translateY(0); opacity: 0; }
          8%   { opacity: 0.85; }
          80%  { opacity: 0.85; }
          96%  { transform: translateY(-${VB_H - SAND_H - 10}px); opacity: 0; }
          100% { transform: translateY(-${VB_H - SAND_H - 10}px); opacity: 0; }
        }
        @keyframes aq-bubble-wiggle {
          0%, 100% { transform: translateX(-1.6px); }
          50%      { transform: translateX(1.6px); }
        }
        .aq-bubble { animation: aq-bubble-rise var(--aq-bdur) linear infinite; animation-delay: var(--aq-bdelay); opacity: 0; }
        .aq-bubble-wiggle { animation: aq-bubble-wiggle var(--aq-bwig) ease-in-out infinite; }
        /* Gentle water shimmer: the surface glow slowly drifts and breathes. */
        @keyframes aq-shimmer {
          0%, 100% { transform: translateX(0); opacity: 0.55; }
          50%      { transform: translateX(${Math.round(vbW * 0.06)}px); opacity: 0.95; }
        }
        .aq-shimmer { animation: aq-shimmer ${(9 * moodCfg.speedMult).toFixed(1)}s ease-in-out infinite; }
        /* Diagonal light rays sweep very slowly across the tank while gently
           breathing in intensity. The sweep animates the CSS transform on an
           OUTER group (the skew lives on an inner SVG attribute so it isn't
           overridden — CSS transforms beat the transform attribute). */
        @keyframes aq-ray-sweep-${tile.id} {
          0%, 100% { transform: translateX(0); }
          50%      { transform: translateX(${Math.round(vbW * 0.16)}px); }
        }
        @keyframes aq-ray-breathe {
          0%, 100% { opacity: 0.5; }
          50%      { opacity: 1; }
        }
        .aq-ray { animation: aq-ray-sweep-${tile.id} var(--aq-raydur) ease-in-out infinite; animation-delay: var(--aq-raydelay); }
        .aq-ray-breathe { animation: aq-ray-breathe var(--aq-raybreathe) ease-in-out infinite; animation-delay: var(--aq-raydelay); }
        /* Tiny plankton/dust motes drift sideways with the water and bob a
           little. Placement translate sits on an outer group (SVG attribute)
           so the CSS drift transform doesn't override it. */
        @keyframes aq-particle-drift-${tile.id} {
          0%, 100% { transform: translateX(0); }
          50%      { transform: translateX(${Math.round(vbW * 0.1)}px); }
        }
        @keyframes aq-particle-bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }
        .aq-particle { animation: aq-particle-drift-${tile.id} var(--aq-pdur) ease-in-out infinite; animation-delay: var(--aq-pdelay); }
        .aq-particle-bob { animation: aq-particle-bob var(--aq-pbob) ease-in-out infinite; }
        /* Click reactions: a clicked fish darts (a fast wobble + lunge burst),
           and after food drops the nearest fish glides over to eat it (inline
           transition, no keyframes needed). A pellet sinks from the click
           point to the sand and fades away. */
        @keyframes aq-dart {
          0%   { transform: translate(0, 0) rotate(0deg); }
          18%  { transform: translate(9px, -5px) rotate(-7deg); }
          38%  { transform: translate(-7px, 4px) rotate(6deg); }
          58%  { transform: translate(6px, -3px) rotate(-4deg); }
          78%  { transform: translate(-3px, 2px) rotate(2deg); }
          100% { transform: translate(0, 0) rotate(0deg); }
        }
        .aq-dart { animation: aq-dart ${DART_MS}ms ease-out 1; }
        @keyframes aq-pellet-sink {
          0%   { transform: translateY(0); opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translateY(var(--aq-sink)); opacity: 0; }
        }
        .aq-pellet { animation: aq-pellet-sink ${PELLET_SINK_MS}ms ease-in 1 forwards; }
        /* One-off chomp flourish when the fish reaches its food: crumb
           particles scatter away from the mouth and fade, a couple of tiny
           bubbles puff upward, and the fish does a quick bite pulse. Each
           crumb's scatter vector lives in CSS vars set inline. */
        @keyframes aq-crumb {
          0%   { transform: translate(0, 0) scale(1); opacity: 0.95; }
          100% { transform: translate(var(--aq-cx), var(--aq-cy)) scale(0.4); opacity: 0; }
        }
        .aq-crumb { animation: aq-crumb ${CHOMP_MS}ms ease-out 1 forwards; }
        @keyframes aq-puff {
          0%   { transform: translateY(0) scale(0.6); opacity: 0; }
          25%  { opacity: 0.8; }
          100% { transform: translateY(-14px) scale(1.15); opacity: 0; }
        }
        .aq-puff { animation: aq-puff ${CHOMP_MS}ms ease-out 1 forwards; animation-delay: var(--aq-puffdelay); opacity: 0; }
        @keyframes aq-bite {
          0%, 100% { transform: rotate(0deg); }
          25%      { transform: rotate(-6deg); }
          55%      { transform: rotate(4deg); }
          80%      { transform: rotate(-2deg); }
        }
        .aq-bite { animation: aq-bite ${CHOMP_MS}ms ease-in-out 1; }
        .aq-fish-hit { cursor: pointer; pointer-events: bounding-box; }
        @media (prefers-reduced-motion: reduce) {
          .aq-fish, .aq-fish-flip, .aq-fish-bob, .aq-sway, .aq-bubble, .aq-bubble-wiggle, .aq-shimmer, .aq-ray, .aq-ray-breathe, .aq-particle, .aq-particle-bob, .aq-dart, .aq-pellet, .aq-crumb, .aq-puff, .aq-bite { animation: none; }
          .aq-feeding { transition: none !important; }
          .aq-bubble, .aq-pellet, .aq-crumb, .aq-puff { opacity: 0; }
        }
      `}</style>
      <svg
        viewBox={`0 0 ${vbW} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        className={`h-full w-full select-none${editMode ? "" : " cursor-pointer"}`}
        aria-label="Aquarium"
        role="img"
        onClick={handleTankClick}
      >
        <defs>
          <linearGradient id={`aq-water-${tile.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={moodCfg.waterStops[0]} />
            <stop offset="45%" stopColor={moodCfg.waterStops[1]} />
            <stop offset="100%" stopColor={moodCfg.waterStops[2]} />
          </linearGradient>
          <linearGradient id={`aq-glow-${tile.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
          <linearGradient id={`aq-ray-${tile.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,240,0.22)" />
            <stop offset="70%" stopColor="rgba(255,255,240,0.06)" />
            <stop offset="100%" stopColor="rgba(255,255,240,0)" />
          </linearGradient>
          {/* Soften the ray shaft's hard left/right edges — without this the
              sweeping ray reads as a moving straight line on flat water. */}
          <filter
            id={`aq-ray-blur-${tile.id}`}
            x="-60%"
            y="-10%"
            width="220%"
            height="120%"
          >
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        {/* Water */}
        <rect x={0} y={0} width={vbW} height={VB_H} fill={`url(#aq-water-${tile.id})`} />
        {/* Soft light shafts near the surface. The rect is oversized on both
            sides so the shimmer's horizontal drift never pulls a hard vertical
            edge into view. */}
        <rect
          x={-Math.round(vbW * 0.12)}
          y={0}
          width={vbW + Math.round(vbW * 0.24)}
          height={34}
          className="aq-shimmer"
          fill={`url(#aq-glow-${tile.id})`}
          opacity={moodCfg.lightOpacity}
        />

        {/* Diagonal light rays: soft skewed shafts falling from the surface,
            sweeping very slowly. The CSS sweep animates the outer group; the
            placement + skew live on inner SVG transform attributes so they
            aren't overridden by the CSS transform. Behind fish and props. */}
        {Array.from({ length: rayCount }, (_, i) => {
          const rayX = vbW * (0.18 + jitter(i, 30) * 0.45);
          const rayW = 14 + jitter(i, 31) * 14;
          const raySkew = -14 - jitter(i, 32) * 8;
          return (
            <g
              key={`ray-${i}`}
              className="aq-ray"
              opacity={moodCfg.lightOpacity}
              style={
                {
                  "--aq-raydur": `${((26 + jitter(i, 33) * 14) * moodCfg.speedMult).toFixed(1)}s`,
                  "--aq-raydelay": `${(-jitter(i, 34) * 30).toFixed(1)}s`,
                } as React.CSSProperties
              }
            >
              <g
                className="aq-ray-breathe"
                style={
                  { "--aq-raybreathe": `${((11 + jitter(i, 35) * 8) * moodCfg.speedMult).toFixed(1)}s` } as React.CSSProperties
                }
              >
                <g transform={`translate(${rayX.toFixed(1)} 0) skewX(${raySkew.toFixed(1)})`}>
                  <rect
                    x={0}
                    y={0}
                    width={rayW.toFixed(1)}
                    height={VB_H - SAND_H + 6}
                    fill={`url(#aq-ray-${tile.id})`}
                    filter={`url(#aq-ray-blur-${tile.id})`}
                  />
                </g>
              </g>
            </g>
          );
        })}

        {/* Props sit on the sand line, spaced across the tank width. Rendered
            behind the fish so swimmers pass in front. */}
        {props.map((p, i) => {
          const x = (vbW / (props.length + 1)) * (i + 1);
          return (
            <g key={`${p}-${i}`} transform={`translate(${x} ${VB_H - SAND_H + 3})`}>
              <PropShape prop={p} />
            </g>
          );
        })}

        {/* Fish. A fish that's swimming to food renders on a separate branch:
            its looping CSS animation classes are dropped (so removing/re-adding
            them later restarts the loop fresh, honoring the recomputed delay)
            and an inline CSS transition glides it between measured positions. */}
        {fish.map((f, i) =>
          feeding && feeding.fishIndex === i ? (
            <g
              key={i}
              className="aq-feeding"
              style={{
                transform: `translate(${feeding.x.toFixed(1)}px, ${feeding.y.toFixed(1)}px)`,
                transition:
                  feeding.phase === "start"
                    ? "none"
                    : `transform ${feeding.durMs}ms ease-in-out`,
              }}
            >
              <g transform={`scale(${(feeding.dir * f.scale).toFixed(2)} ${f.scale.toFixed(2)})`}>
                {/* Quick bite wiggle plays as the fish turns back from the
                    pellet. It lives on an extra inner group so the CSS
                    rotation doesn't wipe the scale attribute above. */}
                {feeding.phase === "back" ? (
                  <g className="aq-bite">
                    <FishShape species={f.species} />
                  </g>
                ) : (
                  <FishShape species={f.species} />
                )}
              </g>
            </g>
          ) : (
            <g
              key={i}
              className="aq-fish"
              style={
                {
                  "--aq-dur": `${(f.duration * moodCfg.speedMult).toFixed(2)}s`,
                  "--aq-delay": `${(fishDelays[i] ?? f.delay * moodCfg.speedMult).toFixed(2)}s`,
                } as React.CSSProperties
              }
            >
              <g transform={`translate(0 ${f.y.toFixed(1)}) scale(${f.scale.toFixed(2)})`}>
                <g className="aq-fish-flip">
                  <g
                    ref={(el) => {
                      fishShapeRefs.current[i] = el;
                    }}
                    className={`aq-fish-bob${editMode ? "" : " aq-fish-hit"}`}
                    style={{ "--aq-bob": `${(f.bobDuration * moodCfg.speedMult).toFixed(2)}s` } as React.CSSProperties}
                    onClick={(e) => handleFishClick(i, e)}
                  >
                    {dartingFish[i] !== undefined ? (
                      <g key={`dart-${dartingFish[i]}`} className="aq-dart">
                        <FishShape species={f.species} />
                      </g>
                    ) : (
                      <FishShape species={f.species} />
                    )}
                  </g>
                </g>
              </g>
            </g>
          ),
        )}

        {/* Food pellets: transient, sink from the click point to the sand and
            fade out. Rendered in front of the fish like the bubbles. */}
        {/* The placement translate lives on an OUTER group: the sink keyframes
            animate the CSS transform property, which overrides the SVG
            transform attribute on the same element — so animating the placed
            group itself would snap every pellet back to the origin. */}
        {pellets.map((p) => (
          <g key={p.id} transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
            <g
              className="aq-pellet"
              style={
                { "--aq-sink": `${Math.max(4, VB_H - SAND_H - 2 - p.y).toFixed(1)}px` } as React.CSSProperties
              }
            >
              <circle r={2} fill="#b5803a" stroke="#8a5f26" strokeWidth={0.6} />
              <circle cx={-0.6} cy={-0.6} r={0.6} fill="rgba(255,255,255,0.5)" />
            </g>
          </g>
        ))}

        {/* One-off chomp flourishes at the pellet's landing point: a few
            crumb particles scatter away from the fish's mouth while a couple
            of tiny bubbles puff upward, then everything fades. Placement
            translate sits on the outer group so the CSS scatter/puff
            transforms on inner groups don't wipe it. */}
        {chomps.map((c) => (
          <g key={`chomp-${c.id}`} transform={`translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})`}>
            {Array.from({ length: 5 }, (_, k) => {
              // Scatter fan biased away from the mouth (opposite the fish's
              // approach direction), deterministic per crumb index.
              const ang = (-0.9 + (k / 4) * 1.8) * 0.9;
              const dist = 7 + jitter(k, 40) * 7;
              const dx = -c.dir * Math.cos(ang) * dist;
              const dy = Math.sin(ang) * dist - 3;
              return (
                <g
                  key={k}
                  className="aq-crumb"
                  style={
                    {
                      "--aq-cx": `${dx.toFixed(1)}px`,
                      "--aq-cy": `${dy.toFixed(1)}px`,
                    } as React.CSSProperties
                  }
                >
                  <circle r={(0.7 + jitter(k, 41) * 0.6).toFixed(2)} fill="#b5803a" />
                </g>
              );
            })}
            {Array.from({ length: 2 }, (_, k) => (
              <g key={`puff-${k}`} transform={`translate(${(k === 0 ? -2.5 : 2.5).toFixed(1)} -2)`}>
                <g
                  className="aq-puff"
                  style={{ "--aq-puffdelay": `${k * 90}ms` } as React.CSSProperties}
                >
                  <circle
                    r={(1.1 + k * 0.5).toFixed(2)}
                    fill="rgba(255,255,255,0.28)"
                    stroke="rgba(255,255,255,0.55)"
                    strokeWidth={0.5}
                  />
                </g>
              </g>
            ))}
          </g>
        ))}

        {/* Faint plankton/dust motes drifting with the water (large tiles
            only). Placement translate on the outer group; the CSS drift/bob
            transforms animate the inner groups so placement isn't wiped. */}
        {particles.map((p, i) => (
          <g key={`particle-${i}`} transform={`translate(${(p.xFrac * vbW).toFixed(1)} ${p.y.toFixed(1)})`}>
            <g
              className="aq-particle"
              style={
                {
                  "--aq-pdur": `${(p.driftDuration * moodCfg.speedMult).toFixed(2)}s`,
                  "--aq-pdelay": `${p.driftDelay.toFixed(2)}s`,
                } as React.CSSProperties
              }
            >
              <g
                className="aq-particle-bob"
                style={{ "--aq-pbob": `${(p.bobDuration * moodCfg.speedMult).toFixed(2)}s` } as React.CSSProperties}
              >
                <circle r={p.r.toFixed(2)} fill={`rgba(235,245,250,${p.opacity.toFixed(2)})`} />
              </g>
            </g>
          </g>
        ))}

        {/* Bubble streams rising from the sand line, in front of the fish so
            the tiny highlights read against everything. */}
        {streams.map((st, i) => (
          <g key={`stream-${i}`} transform={`translate(${(st.xFrac * vbW).toFixed(1)} ${VB_H - SAND_H + 2})`}>
            {st.bubbles.map((b, j) => (
              <g
                key={j}
                className="aq-bubble"
                style={
                  {
                    "--aq-bdur": `${(b.duration * moodCfg.speedMult).toFixed(2)}s`,
                    "--aq-bdelay": `${b.delay.toFixed(2)}s`,
                  } as React.CSSProperties
                }
              >
                <g
                  className="aq-bubble-wiggle"
                  style={{ "--aq-bwig": `${(b.wiggleDuration * moodCfg.speedMult).toFixed(2)}s` } as React.CSSProperties}
                >
                  <circle
                    r={b.r.toFixed(2)}
                    fill="rgba(255,255,255,0.28)"
                    stroke="rgba(255,255,255,0.55)"
                    strokeWidth={0.5}
                  />
                </g>
              </g>
            ))}
          </g>
        ))}

        {/* Sand floor */}
        <path
          d={`M0 ${VB_H - SAND_H} Q${vbW * 0.25} ${VB_H - SAND_H - 4} ${vbW * 0.5} ${VB_H - SAND_H} T${vbW} ${VB_H - SAND_H} V${VB_H} H0 Z`}
          fill={sand}
        />
        <path
          d={`M0 ${VB_H - SAND_H} Q${vbW * 0.25} ${VB_H - SAND_H - 4} ${vbW * 0.5} ${VB_H - SAND_H} T${vbW} ${VB_H - SAND_H}`}
          fill="none"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
