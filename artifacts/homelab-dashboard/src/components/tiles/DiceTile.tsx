import { useState, useEffect, useRef, type ReactNode } from "react";
import type { TileSettings } from "@workspace/api-client-react";

// The selectable die types, each with its number of sides. The "d6" shows
// classic pips; every other type shows its rolled number.
export const DICE_TYPES = [
  { value: "d3", sides: 3 },
  { value: "d4", sides: 4 },
  { value: "d6", sides: 6 },
  { value: "d8", sides: 8 },
  { value: "d10", sides: 10 },
  { value: "d12", sides: 12 },
  { value: "d20", sides: 20 },
  { value: "d100", sides: 100 },
] as const;

export type DiceType = (typeof DICE_TYPES)[number]["value"];

export const DEFAULT_DICE_TYPE: DiceType = "d6";
export const DEFAULT_DICE_COUNT = 2;
export const MIN_DICE_COUNT = 1;
export const MAX_DICE_COUNT = 6;

function sidesFor(diceType: string): number {
  return DICE_TYPES.find((d) => d.value === diceType)?.sides ?? 6;
}

// Pip layouts for each d6 face (1-6) on a 3x3 grid. Each entry lists the grid
// cells (0-8, row-major) that carry a pip for that value.
const PIP_LAYOUTS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// Silhouette for each die type, evoking the real polyhedron's outline. d6 is
// left undefined so it keeps a rounded square (and its pips). All others are
// clipped to a polygon: d4/d3 a triangle, d8 a diamond, d10/d100 a kite, d12 a
// pentagon, d20 a hexagon.
const CLIP_PATHS: Record<string, string> = {
  d3: "polygon(50% 4%, 96% 92%, 4% 92%)",
  d4: "polygon(50% 4%, 96% 92%, 4% 92%)",
  d8: "polygon(50% 2%, 98% 50%, 50% 98%, 2% 50%)",
  d10: "polygon(50% 2%, 88% 42%, 50% 98%, 12% 42%)",
  d12: "polygon(50% 2%, 98% 39%, 80% 98%, 20% 98%, 2% 39%)",
  d20: "polygon(50% 2%, 95% 27%, 95% 73%, 50% 98%, 5% 73%, 5% 27%)",
  d100: "polygon(50% 2%, 88% 42%, 50% 98%, 12% 42%)",
};

// Triangular dice carry most of their area near the base, so nudge the number
// downward to sit visually centered inside the shape.
const TRIANGLE_TYPES = new Set(["d3", "d4"]);

function rollValue(sides: number) {
  return Math.floor(Math.random() * sides) + 1;
}

// Die size shrinks as more dice are shown so the whole set keeps fitting the
// tile. Sizes are CSS container-query units relative to the tile body.
function dieSize(count: number): string {
  if (count <= 1) return "min(52cqw, 64cqh)";
  if (count === 2) return "min(38cqw, 56cqh)";
  if (count <= 4) return "min(30cqw, 40cqh)";
  return "min(24cqw, 32cqh)";
}

// A single die. Its outline matches the chosen die type (square for d6,
// triangle for d4/d3, diamond for d8, kite for d10/d100, pentagon for d12,
// hexagon for d20). A d6 shows classic pips; every other type shows its numeric
// value. The cast shadow lives on a wrapper via `drop-shadow` so it follows the
// clipped silhouette instead of a square box.
function Die({
  value,
  diceType,
  showPips,
  size,
}: {
  value: number;
  diceType: string;
  showPips: boolean;
  size: string;
}) {
  const clipPath = CLIP_PATHS[diceType];
  const faceBackground =
    "linear-gradient(145deg, #fefefe 0%, #e9e9ef 60%, #d6d6e0 100%)";
  const faceShadow =
    "inset 0 -3cqmin 6cqmin rgba(0,0,0,0.18), inset 0 2cqmin 4cqmin rgba(255,255,255,0.9)";

  let inner: ReactNode;
  if (showPips) {
    const pips = new Set(PIP_LAYOUTS[value] ?? []);
    inner = (
      <div
        className="relative rounded-[18%] grid grid-cols-3 grid-rows-3"
        style={{
          width: size,
          height: size,
          padding: "12%",
          gap: "6%",
          background: faceBackground,
          boxShadow: faceShadow,
        }}
      >
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="flex items-center justify-center">
            {pips.has(i) && (
              <div
                className="rounded-full"
                style={{
                  width: "70%",
                  height: "70%",
                  background:
                    "radial-gradient(circle at 35% 30%, #4a4a55 0%, #16161c 75%)",
                  boxShadow: "inset 0 0.4cqmin 0.8cqmin rgba(0,0,0,0.6)",
                }}
              />
            )}
          </div>
        ))}
      </div>
    );
  } else {
    // Show the rolled number. Longer numbers (e.g. d100) shrink to fit.
    const digits = String(value).length;
    const fontSize = `min(${Math.round(46 / Math.max(1, digits - 0.4))}cqmin, 16cqmin)`;
    const nudge = TRIANGLE_TYPES.has(diceType) ? "translateY(22%)" : undefined;
    inner = (
      <div
        className="relative flex items-center justify-center"
        style={{
          width: size,
          height: size,
          background: faceBackground,
          boxShadow: faceShadow,
          clipPath,
          borderRadius: clipPath ? undefined : "18%",
        }}
      >
        <span
          className="font-bold leading-none"
          style={{ color: "#16161c", fontSize, transform: nudge }}
        >
          {value}
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        filter: "drop-shadow(0 3cqmin 5cqmin rgba(0,0,0,0.4))",
        lineHeight: 0,
      }}
    >
      {inner}
    </div>
  );
}

interface DiceTileProps {
  tileSettings?: TileSettings | null;
}

// A self-contained set of dice. Clicking the tile "rolls" every die and shows
// a fresh random result with their total. The die type (d3…d100) and how many
// dice to roll are configured per-tile in the edit modal. No backend, no
// connection — entirely client-side. Everything scales to the tile via CSS
// container-query units.
export default function DiceTile({ tileSettings }: DiceTileProps) {
  const diceType = tileSettings?.diceType || DEFAULT_DICE_TYPE;
  const sides = sidesFor(diceType);
  const showPips = diceType === "d6";
  const count = Math.min(
    MAX_DICE_COUNT,
    Math.max(MIN_DICE_COUNT, tileSettings?.diceCount ?? DEFAULT_DICE_COUNT),
  );

  const [dice, setDice] = useState<number[]>(() =>
    Array.from({ length: count }, () => rollValue(sides)),
  );
  const [rolling, setRolling] = useState(false);
  const swapTimer = useRef<number | null>(null);
  const stopTimer = useRef<number | null>(null);

  function clearTimers() {
    if (swapTimer.current !== null) window.clearTimeout(swapTimer.current);
    if (stopTimer.current !== null) window.clearTimeout(stopTimer.current);
    swapTimer.current = null;
    stopTimer.current = null;
  }

  function roll() {
    clearTimers();
    setRolling(true);
    // Land on the new values partway through the tumble so they snap into place.
    swapTimer.current = window.setTimeout(
      () => setDice(Array.from({ length: count }, () => rollValue(sides))),
      350,
    );
    stopTimer.current = window.setTimeout(() => setRolling(false), 600);
  }

  // Re-roll whenever the configured die type or count changes (and once on
  // mount) so the tile always reflects the current settings.
  useEffect(() => {
    setDice(Array.from({ length: count }, () => rollValue(sides)));
    setRolling(true);
    stopTimer.current = window.setTimeout(() => setRolling(false), 600);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, sides]);

  const total = dice.reduce((a, b) => a + b, 0);
  const size = dieSize(count);

  return (
    <div className="w-full h-full" style={{ containerType: "size" }}>
      <style>{`
        @keyframes dice-tumble {
          0% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-12%) rotate(-90deg); }
          50% { transform: translateY(0) rotate(-180deg); }
          75% { transform: translateY(-8%) rotate(-270deg); }
          100% { transform: translateY(0) rotate(-360deg); }
        }
        @keyframes dice-total-in {
          0% { opacity: 0; transform: scale(0.6); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>

      <div
        className="w-full h-full flex flex-col items-center justify-center gap-[4cqh] select-none cursor-pointer overflow-hidden"
        onClick={roll}
        role="button"
        tabIndex={0}
        aria-label={`Roll ${count} ${diceType} ${count === 1 ? "die" : "dice"}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            roll();
          }
        }}
      >
        <div className="flex flex-wrap items-center justify-center gap-[5cqmin] max-w-full">
          {dice.map((value, i) => (
            <div
              key={i}
              style={{
                animation: rolling
                  ? `dice-tumble 0.6s cubic-bezier(.36,.07,.19,.97)`
                  : "none",
              }}
            >
              <Die
                value={value}
                diceType={diceType}
                showPips={showPips}
                size={size}
              />
            </div>
          ))}
        </div>

        {/* Show the total only when more than one die is in play. */}
        {count > 1 && (
          <span
            key={total}
            className="font-bold tracking-tight leading-none"
            style={{
              color: "hsl(var(--foreground))",
              fontSize: "9cqmin",
              opacity: rolling ? 0.3 : 1,
              animation: rolling ? "none" : "dice-total-in 0.35s ease-out",
            }}
          >
            {total}
          </span>
        )}
      </div>
    </div>
  );
}
