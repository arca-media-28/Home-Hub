import { useEffect, useRef, useState } from "react";
import type { Tile } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Aquarium tile: a purely-cosmetic live fish tank. Fish idle-swim across the
// tank on looping CSS keyframe paths, and the number of fish/props scales with
// the tile's rendered pixel area (via ResizeObserver). All choices (three fish
// species slots, sand color, three prop slots) persist in tileSettings and are
// edited in the tile modal — the tile itself has no interactions.
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

interface AquariumTileProps {
  tile: Tile;
  editMode: boolean;
}

export default function AquariumTile({ tile }: AquariumTileProps) {
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

  const s = tile.tileSettings;
  const fishTypes = normalizeSlots(s?.aquariumFishTypes, FISH_KEYS, DEFAULT_FISH_TYPES);
  const propSlots = normalizeSlots(s?.aquariumProps, PROP_KEYS, DEFAULT_PROPS);
  const sand = resolveSandColor(s?.aquariumSandColor);

  // Fish count scales with rendered area: a small tile (~200x150) shows 2-4
  // fish, a large one (~800x600+) shows 8-14. Props unlock with area too:
  // 1 slot on small tiles, up to all 3 on large ones.
  const area = size.w * size.h;
  const fishCount = Math.max(2, Math.min(14, Math.round(2 + area / 40_000)));
  const propBudget = area >= 240_000 ? 3 : area >= 80_000 ? 2 : 1;

  const fish = buildFish(fishTypes, fishCount);
  const props = propSlots.filter((p) => p !== NONE_SLOT).slice(0, propBudget);

  // Match the drawing width to the tile's aspect ratio so the whole tank is
  // visible (no slice-cropping) and the fish's turnaround points sit just
  // inside the visible tile edges.
  const aspect = size.w > 0 && size.h > 0 ? size.w / size.h : DEFAULT_VB_W / VB_H;
  const vbW = Math.max(90, Math.round(VB_H * aspect));
  const swimMin = WALL_MARGIN;
  const swimMax = Math.max(swimMin + 10, vbW - WALL_MARGIN);

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
        .aq-sway { animation: aq-prop-sway 5s ease-in-out infinite; transform-origin: 0 0; transform-box: fill-box; }
      `}</style>
      <svg
        viewBox={`0 0 ${vbW} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full select-none"
        aria-label="Aquarium"
        role="img"
      >
        <defs>
          <linearGradient id={`aq-water-${tile.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7ec3e8" />
            <stop offset="45%" stopColor="#3f8fc4" />
            <stop offset="100%" stopColor="#1e5f92" />
          </linearGradient>
          <linearGradient id={`aq-glow-${tile.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>

        {/* Water */}
        <rect x={0} y={0} width={vbW} height={VB_H} fill={`url(#aq-water-${tile.id})`} />
        {/* Soft light shafts near the surface */}
        <rect x={0} y={0} width={vbW} height={34} fill={`url(#aq-glow-${tile.id})`} />

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

        {/* Fish */}
        {fish.map((f, i) => (
          <g
            key={i}
            className="aq-fish"
            style={
              {
                "--aq-dur": `${f.duration.toFixed(2)}s`,
                "--aq-delay": `${f.delay.toFixed(2)}s`,
              } as React.CSSProperties
            }
          >
            <g transform={`translate(0 ${f.y.toFixed(1)}) scale(${f.scale.toFixed(2)})`}>
              <g className="aq-fish-flip">
                <g
                  className="aq-fish-bob"
                  style={{ "--aq-bob": `${f.bobDuration.toFixed(2)}s` } as React.CSSProperties}
                >
                  <FishShape species={f.species} />
                </g>
              </g>
            </g>
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
