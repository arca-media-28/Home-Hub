import { useEffect, useRef, useState } from "react";
import type { Tile, TileSettings } from "@workspace/api-client-react";
import { useUpdateTile, getGetTilesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Drumstick, Gamepad2, Moon } from "lucide-react";

// All three pet stats live on the same 0-100 scale: 0 is the worst (starving /
// miserable / exhausted) and 100 is the best (full / delighted / rested). New
// pets start healthy but not maxed so there is something to do right away.
const STAT_MAX = 100;
const STAT_MIN = 0;
const DEFAULT_STAT = 80;

// Per-hour decay rates (points/hour). Hunger drops fastest so feeding is the
// most frequent chore, energy slowest. Tuned so a pet left overnight (~8h)
// slides into a needy-but-recoverable state rather than flatlining instantly.
const DECAY_PER_HOUR = {
  hunger: 14,
  happiness: 10,
  energy: 7,
} as const;

// How much each action restores. Actions have a small trade-off so caring for
// the pet feels like a balancing act rather than mashing one button: playing
// burns a little energy, resting makes the pet a touch hungrier.
const FEED_HUNGER = 32;
const PLAY_HAPPINESS = 30;
const PLAY_ENERGY_COST = 8;
const REST_ENERGY = 36;
const REST_HUNGER_COST = 6;

const SAVE_DEBOUNCE_MS = 800;
// Recompute decay on a slow interval while the tile is mounted so the stats and
// mood drift visibly without the persistence churn of a per-second tick.
const TICK_MS = 15_000;
// How long an interaction animation (pet wiggle + floating icons) plays before
// the pet settles back into its idle bob.
const REACTION_MS = 900;

interface PetState {
  hunger: number;
  happiness: number;
  energy: number;
  updatedAt: number;
}

// The three care actions, each of which plays its own little reaction animation.
type CareKind = "feed" | "play" | "rest";

// Per-action reaction styling: the emoji that floats up over the pet, how many
// copies spawn, and which short wiggle the pet body plays.
const REACTION_CONFIG: Record<
  CareKind,
  { emoji: string; count: number; petAnim: string; tint: string }
> = {
  feed: { emoji: "🍖", count: 3, petAnim: "tamagotchi-munch", tint: "#f59e0b" },
  play: { emoji: "❤️", count: 4, petAnim: "tamagotchi-bounce", tint: "#ec4899" },
  rest: { emoji: "💤", count: 3, petAnim: "tamagotchi-rest", tint: "#3b82f6" },
};

function clamp(n: number): number {
  return Math.max(STAT_MIN, Math.min(STAT_MAX, n));
}

function petStateFromTile(tile: Tile): PetState {
  const s = tile.tileSettings;
  return {
    hunger: clamp(s?.petHunger ?? DEFAULT_STAT),
    happiness: clamp(s?.petHappiness ?? DEFAULT_STAT),
    energy: clamp(s?.petEnergy ?? DEFAULT_STAT),
    updatedAt: s?.petUpdatedAt ?? Date.now(),
  };
}

// Apply real-elapsed-time decay from a pet's last-updated anchor up to `now`.
// This is what makes the pet feel alive across reloads/sessions: the stats are
// recomputed from wall-clock time, not just while the tab was open.
function decayTo(state: PetState, now: number): PetState {
  const hours = Math.max(0, (now - state.updatedAt) / 3_600_000);
  if (hours === 0) return state;
  return {
    hunger: clamp(state.hunger - DECAY_PER_HOUR.hunger * hours),
    happiness: clamp(state.happiness - DECAY_PER_HOUR.happiness * hours),
    energy: clamp(state.energy - DECAY_PER_HOUR.energy * hours),
    updatedAt: now,
  };
}

type Mood = "happy" | "hungry" | "sad" | "sleepy" | "content";

// Pick the pet's overall mood from its weakest, most-urgent need. A critically
// low stat drives the mood (and the face); otherwise the pet is content or, when
// everything is high, outright happy.
function moodOf(state: PetState): Mood {
  const lowest = Math.min(state.hunger, state.happiness, state.energy);
  if (lowest <= 25) {
    if (state.hunger === lowest) return "hungry";
    if (state.energy === lowest) return "sleepy";
    return "sad";
  }
  if (state.hunger >= 70 && state.happiness >= 70 && state.energy >= 70) {
    return "happy";
  }
  return "content";
}

const MOOD_LABEL: Record<Mood, string> = {
  happy: "Happy!",
  content: "Content",
  hungry: "Hungry",
  sad: "Lonely",
  sleepy: "Sleepy",
};

// ---------------------------------------------------------------------------
// Customization: the pet's look is fully user-chosen (body color + eyes + nose
// + mouth). Mood no longer drives the body color; instead it temporarily
// overrides the expression (sleepy → closed eyes + "z", hungry/sad → frown) so
// the pet still visibly reacts to neglect while otherwise wearing the face the
// user picked. All four choices persist in tileSettings.
// ---------------------------------------------------------------------------

export type EyeStyle = "round" | "dot" | "happy" | "sleepy" | "star" | "wink";
export type NoseStyle = "none" | "dot" | "round" | "triangle" | "heart";
export type MouthStyle = "smile" | "neutral" | "open" | "cat" | "frown";

export const DEFAULT_BODY_COLOR = "green";
export const DEFAULT_EYES: EyeStyle = "round";
export const DEFAULT_NOSE: NoseStyle = "dot";
export const DEFAULT_MOUTH: MouthStyle = "smile";

// Preset body colors, each a glossy radial gradient. Custom hex values are also
// supported (see resolveBodyGradient).
export const PET_BODY_COLORS: { value: string; label: string; gradient: string }[] = [
  { value: "green", label: "Green", gradient: "radial-gradient(circle at 38% 32%, #c4f0a8 0%, #7fd45a 55%, #4ea832 100%)" },
  { value: "blue", label: "Blue", gradient: "radial-gradient(circle at 38% 32%, #b8e9f0 0%, #6cc6d6 55%, #3f97a8 100%)" },
  { value: "pink", label: "Pink", gradient: "radial-gradient(circle at 38% 32%, #ffc9e3 0%, #f178b6 55%, #c84d8e 100%)" },
  { value: "yellow", label: "Yellow", gradient: "radial-gradient(circle at 38% 32%, #fff0b0 0%, #f5cf4b 55%, #c79f1f 100%)" },
  { value: "purple", label: "Purple", gradient: "radial-gradient(circle at 38% 32%, #ddc9f5 0%, #a777e0 55%, #7a4dc8 100%)" },
  { value: "orange", label: "Orange", gradient: "radial-gradient(circle at 38% 32%, #ffd6a8 0%, #f59e4b 55%, #c8741f 100%)" },
  { value: "teal", label: "Teal", gradient: "radial-gradient(circle at 38% 32%, #aef0e2 0%, #4fc8b0 55%, #1f9882 100%)" },
  { value: "gray", label: "Gray", gradient: "radial-gradient(circle at 38% 32%, #e0e4e9 0%, #aab2bd 55%, #79828d 100%)" },
];

export const PET_EYES_OPTIONS: { value: EyeStyle; label: string }[] = [
  { value: "round", label: "Round" },
  { value: "dot", label: "Dot" },
  { value: "happy", label: "Happy" },
  { value: "sleepy", label: "Sleepy" },
  { value: "star", label: "Star" },
  { value: "wink", label: "Wink" },
];

export const PET_NOSE_OPTIONS: { value: NoseStyle; label: string }[] = [
  { value: "none", label: "None" },
  { value: "dot", label: "Dot" },
  { value: "round", label: "Round" },
  { value: "triangle", label: "Cat" },
  { value: "heart", label: "Heart" },
];

export const PET_MOUTH_OPTIONS: { value: MouthStyle; label: string }[] = [
  { value: "smile", label: "Smile" },
  { value: "neutral", label: "Neutral" },
  { value: "open", label: "Open" },
  { value: "cat", label: "Cat (ω)" },
  { value: "frown", label: "Frown" },
];

// Resolve a stored body-color value (preset key or custom #hex) into a glossy
// gradient. Unknown/empty falls back to the default preset.
export function resolveBodyGradient(value: string | null | undefined): string {
  const preset = PET_BODY_COLORS.find((c) => c.value === value);
  if (preset) return preset.gradient;
  if (value && /^#[0-9a-fA-F]{3,8}$/.test(value)) {
    return `radial-gradient(circle at 38% 32%, rgba(255,255,255,0.55) 0%, ${value} 60%, rgba(0,0,0,0.25) 100%)`;
  }
  return PET_BODY_COLORS[0].gradient;
}

const FACE_DARK = "rgba(30,30,40,0.85)";

// SVG face parts, drawn on a 0-100 viewBox over the body circle. Each returns a
// fragment so eyes/nose/mouth compose independently.
function Eyes({ style }: { style: EyeStyle }) {
  const lx = 36;
  const rx = 64;
  const cy = 43;
  const open = (cx: number) => (
    <>
      <circle cx={cx} cy={cy} r={6.5} fill={FACE_DARK} />
      <circle cx={cx - 2} cy={cy - 2.3} r={2} fill="rgba(255,255,255,0.9)" />
    </>
  );
  const dot = (cx: number) => <circle cx={cx} cy={cy} r={4} fill={FACE_DARK} />;
  const happyArc = (cx: number) => (
    <path d={`M${cx - 7} ${cy + 2} Q${cx} ${cy - 6} ${cx + 7} ${cy + 2}`} stroke={FACE_DARK} strokeWidth={3} fill="none" strokeLinecap="round" />
  );
  const sleepyArc = (cx: number) => (
    <path d={`M${cx - 7} ${cy - 1} Q${cx} ${cy + 5} ${cx + 7} ${cy - 1}`} stroke={FACE_DARK} strokeWidth={3} fill="none" strokeLinecap="round" />
  );
  const star = (cx: number) => (
    <path
      d={`M${cx} ${cy - 7} L${cx + 2} ${cy - 2} L${cx + 7} ${cy} L${cx + 2} ${cy + 2} L${cx} ${cy + 7} L${cx - 2} ${cy + 2} L${cx - 7} ${cy} L${cx - 2} ${cy - 2} Z`}
      fill={FACE_DARK}
    />
  );
  switch (style) {
    case "dot":
      return (<>{dot(lx)}{dot(rx)}</>);
    case "happy":
      return (<>{happyArc(lx)}{happyArc(rx)}</>);
    case "sleepy":
      return (<>{sleepyArc(lx)}{sleepyArc(rx)}</>);
    case "star":
      return (<>{star(lx)}{star(rx)}</>);
    case "wink":
      return (<>{open(lx)}{happyArc(rx)}</>);
    case "round":
    default:
      return (<>{open(lx)}{open(rx)}</>);
  }
}

function Nose({ style }: { style: NoseStyle }) {
  const cx = 50;
  const cy = 56;
  switch (style) {
    case "none":
      return null;
    case "round":
      return <ellipse cx={cx} cy={cy} rx={4} ry={3} fill={FACE_DARK} />;
    case "triangle":
      return <path d={`M${cx - 4} ${cy - 2} L${cx + 4} ${cy - 2} L${cx} ${cy + 4} Z`} fill={FACE_DARK} />;
    case "heart":
      return (
        <path
          d={`M${cx} ${cy + 4} C${cx - 5} ${cy - 1} ${cx - 4} ${cy - 5} ${cx} ${cy - 2} C${cx + 4} ${cy - 5} ${cx + 5} ${cy - 1} ${cx} ${cy + 4} Z`}
          fill="#e0557f"
        />
      );
    case "dot":
    default:
      return <circle cx={cx} cy={cy} r={2.6} fill={FACE_DARK} />;
  }
}

function Mouth({ style }: { style: MouthStyle }) {
  switch (style) {
    case "neutral":
      return <path d="M42 67 L58 67" stroke={FACE_DARK} strokeWidth={3} strokeLinecap="round" fill="none" />;
    case "open":
      return (
        <>
          <ellipse cx={50} cy={68} rx={7} ry={5.5} fill={FACE_DARK} />
          <ellipse cx={50} cy={70.5} rx={3.5} ry={2.5} fill="#e8728f" />
        </>
      );
    case "cat":
      return <path d="M41 64 Q46 70 50 64 Q54 70 59 64" stroke={FACE_DARK} strokeWidth={3} fill="none" strokeLinecap="round" />;
    case "frown":
      return <path d="M40 71 Q50 62 60 71" stroke={FACE_DARK} strokeWidth={3} fill="none" strokeLinecap="round" />;
    case "smile":
    default:
      return <path d="M40 64 Q50 74 60 64" stroke={FACE_DARK} strokeWidth={3} fill="none" strokeLinecap="round" />;
  }
}

export interface PetAppearance {
  bodyColor: string;
  eyes: EyeStyle;
  nose: NoseStyle;
  mouth: MouthStyle;
}

interface PetFaceProps {
  appearance: PetAppearance;
  // Mood temporarily overrides the expression; pass "content" for a neutral
  // (un-moody) render, e.g. the editor preview.
  mood: Mood;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

// The pet's body + face, reused by both the live tile and the editor preview so
// customization always looks identical in both. Mood overrides keep the pet
// expressive when neglected without discarding the user's chosen face.
export function PetFace({ appearance, mood, className, style, children }: PetFaceProps) {
  const eyes: EyeStyle = mood === "sleepy" ? "sleepy" : appearance.eyes;
  const mouth: MouthStyle = mood === "hungry" || mood === "sad" ? "frown" : appearance.mouth;
  return (
    <div
      className={`relative flex items-center justify-center rounded-full ${className ?? ""}`}
      style={{
        background: resolveBodyGradient(appearance.bodyColor),
        boxShadow:
          "inset 0 -4cqmin 8cqmin rgba(0,0,0,0.22), inset 0 3cqmin 6cqmin rgba(255,255,255,0.45), 0 3cqmin 7cqmin rgba(0,0,0,0.28)",
        ...style,
      }}
    >
      {children}
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full select-none"
        aria-hidden="true"
      >
        <Eyes style={eyes} />
        <Nose style={appearance.nose} />
        <Mouth style={mouth} />
      </svg>
      {mood === "sleepy" && (
        <span
          className="absolute font-bold leading-none"
          style={{ top: "6%", right: "8%", fontSize: "9cqmin", color: "rgba(30,30,40,0.5)" }}
          aria-hidden="true"
        >
          z
        </span>
      )}
    </div>
  );
}

// Read the four appearance choices off a tile, falling back to defaults.
export function appearanceFromTile(tile: Tile): PetAppearance {
  const s = tile.tileSettings;
  return {
    bodyColor: s?.petBodyColor ?? DEFAULT_BODY_COLOR,
    eyes: (s?.petEyes as EyeStyle) ?? DEFAULT_EYES,
    nose: (s?.petNose as NoseStyle) ?? DEFAULT_NOSE,
    mouth: (s?.petMouth as MouthStyle) ?? DEFAULT_MOUTH,
  };
}

interface StatBarProps {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
}

// One labeled 0-100 stat meter. Sizes itself with container-query units so the
// whole pet + stats block scales to fill any tile dimension.
function StatBar({ label, value, color, icon }: StatBarProps) {
  const pct = Math.round(value);
  return (
    <div className="flex items-center gap-[2cqmin]" aria-label={`${label}: ${pct}%`}>
      <span
        className="flex items-center justify-center text-muted-foreground"
        style={{ width: "5cqmin", height: "5cqmin" }}
        title={label}
      >
        {icon}
      </span>
      <div
        className="relative flex-1 overflow-hidden rounded-full bg-muted"
        style={{ height: "3.2cqmin", minHeight: "5px" }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

interface TamagotchiTileProps {
  tile: Tile;
  // In edit (layout) mode the tile is a drag/resize target, so the care buttons
  // are disabled — the pet is interacted with in locked mode.
  editMode: boolean;
}

// A self-contained virtual-pet ("Tamagotchi") tile. The pet keeps living state
// (hunger / happiness / energy) that decays over real wall-clock time, so it
// feels alive across reloads and sessions. State is recomputed from a stored
// last-updated timestamp on mount and on a slow interval, and persisted back
// through the normal tile-update flow (debounced, preserving every other
// tileSettings key) — following the Note/Timer in-place persistence pattern.
export default function TamagotchiTile({ tile, editMode }: TamagotchiTileProps) {
  const queryClient = useQueryClient();
  const updateTile = useUpdateTile({
    mutation: {
      onSuccess: (updated) => {
        // Reconcile the saved pet into the tile list cache so a later refetch
        // doesn't clobber the live stats we just wrote.
        queryClient.setQueryData<Tile[]>(getGetTilesQueryKey(), (old) =>
          old?.map((t) => (t.id === updated.id ? updated : t)),
        );
      },
    },
  });

  // Local source of truth, seeded from the persisted tile with elapsed-time
  // decay already applied so a long-dormant pet shows its real current state.
  const [pet, setPet] = useState<PetState>(() =>
    decayTo(petStateFromTile(tile), Date.now()),
  );

  // Reset local state only when a different tile mounts in this slot — never on
  // every prop change — so an in-flight save round-trip can't overwrite the live
  // pet (same safeguard the note/timer use).
  const lastIdRef = useRef(tile.id);
  useEffect(() => {
    if (lastIdRef.current !== tile.id) {
      lastIdRef.current = tile.id;
      setPet(decayTo(petStateFromTile(tile), Date.now()));
    }
  }, [tile]);

  // Latest pet for the debounced / unmount flush, kept current via a ref.
  const petRef = useRef(pet);
  petRef.current = pet;
  const tileRef = useRef(tile);
  tileRef.current = tile;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The currently-playing interaction reaction (drives a short pet wiggle plus a
  // burst of floating icons). Cleared automatically after REACTION_MS.
  const [reaction, setReaction] = useState<CareKind | null>(null);
  // A monotonically increasing key so re-triggering the SAME action restarts the
  // CSS animation (changing the key remounts the floating-icon nodes).
  const [reactionKey, setReactionKey] = useState(0);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function triggerReaction(kind: CareKind) {
    setReaction(kind);
    setReactionKey((k) => k + 1);
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => {
      reactionTimer.current = null;
      setReaction(null);
    }, REACTION_MS);
  }

  useEffect(() => {
    return () => {
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
    };
  }, []);

  function persistNow(next: PetState) {
    const current = tileRef.current;
    // Preserve every other tileSettings key since a PUT replaces the whole blob.
    const settings: TileSettings = {
      ...(current.tileSettings ?? {}),
      petHunger: Math.round(next.hunger),
      petHappiness: Math.round(next.happiness),
      petEnergy: Math.round(next.energy),
      petUpdatedAt: next.updatedAt,
    };
    updateTile.mutate({ id: current.id, data: { tileSettings: settings } });
  }

  function scheduleSave(next: PetState) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      persistNow(next);
    }, SAVE_DEBOUNCE_MS);
  }

  // Anchor a brand-new pet to storage as soon as it mounts. Without this, a tile
  // that is never interacted with keeps re-defaulting its `petUpdatedAt` to "now"
  // on every load, so elapsed time between sessions is never captured and the pet
  // appears to reset. Writing the starting stats + timestamp once fixes the
  // wall-clock anchor from the moment the tile is added.
  const initedRef = useRef(false);
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    if (tileRef.current.tileSettings?.petUpdatedAt == null) {
      persistNow(petRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the current (decayed-to-now) state whenever the tile goes away or the
  // tab is hidden — not only after a care action. This is what makes passive
  // decay durable across reloads/sessions: the stored anchor + stats always
  // reflect the last moment the user saw the pet, so decayTo() on next mount
  // continues from the right point instead of starting over.
  useEffect(() => {
    function flush() {
      const hasPending = saveTimer.current != null;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const decayed = decayTo(petRef.current, Date.now());
      // decayTo returns the same reference when no time has elapsed; skip a
      // redundant write unless a debounced save was already pending.
      if (!hasPending && decayed === petRef.current) return;
      petRef.current = decayed;
      persistNow(decayed);
    }
    function onVisibility() {
      if (document.hidden) flush();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Slow decay tick: recompute from wall-clock time so the stats and mood drift
  // visibly while the tile is open. Stats are persisted via the save debounce
  // only when the user acts, so the tick itself stays storage-quiet.
  useEffect(() => {
    const id = setInterval(() => {
      setPet((prev) => decayTo(prev, Date.now()));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Apply a care action: decay up to now, restore the relevant stat(s), and
  // persist (debounced). Care is disabled while arranging the layout.
  function act(mutate: (cur: PetState) => PetState) {
    if (editMode) return;
    setPet((prev) => {
      const cur = decayTo(prev, Date.now());
      const next = { ...mutate(cur), updatedAt: Date.now() };
      scheduleSave(next);
      return next;
    });
  }

  function feed() {
    if (editMode) return;
    act((cur) => ({ ...cur, hunger: clamp(cur.hunger + FEED_HUNGER) }));
    triggerReaction("feed");
  }
  function play() {
    if (editMode) return;
    act((cur) => ({
      ...cur,
      happiness: clamp(cur.happiness + PLAY_HAPPINESS),
      energy: clamp(cur.energy - PLAY_ENERGY_COST),
    }));
    triggerReaction("play");
  }
  function rest() {
    if (editMode) return;
    act((cur) => ({
      ...cur,
      energy: clamp(cur.energy + REST_ENERGY),
      hunger: clamp(cur.hunger - REST_HUNGER_COST),
    }));
    triggerReaction("rest");
  }

  const mood = moodOf(pet);
  const isSleepy = mood === "sleepy";
  const readOnly = editMode;
  // Derived each render from the tile, so editor changes show up immediately.
  const appearance = appearanceFromTile(tile);

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden text-foreground"
      style={{ containerType: "size" }}
    >
      <style>{`
        @keyframes tamagotchi-bob {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-4%) rotate(-1.5deg); }
        }
        @keyframes tamagotchi-snooze {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-1.5%); }
        }
        @keyframes tamagotchi-munch {
          0%, 100% { transform: scale(1, 1); }
          25% { transform: scale(1.08, 0.9); }
          50% { transform: scale(0.92, 1.08); }
          75% { transform: scale(1.05, 0.95); }
        }
        @keyframes tamagotchi-bounce {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          30% { transform: translateY(-14%) rotate(6deg); }
          60% { transform: translateY(-6%) rotate(-6deg); }
        }
        @keyframes tamagotchi-rest {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(3%) scale(0.97); }
        }
        @keyframes tamagotchi-float {
          0% { opacity: 0; transform: translate(-50%, 0) scale(0.6); }
          15% { opacity: 1; }
          100% { opacity: 0; transform: translate(-50%, -150%) scale(1.15); }
        }
      `}</style>

      {/* The pet itself, centered and filling the available space above the
          stats + actions. The look (body color + eyes/nose/mouth) is whatever
          the user picked in the editor; mood only nudges the expression. */}
      <div className="relative flex flex-1 min-h-0 items-center justify-center px-[4cqmin] pt-[4cqmin]">
        <PetFace
          appearance={appearance}
          mood={mood}
          style={{
            width: "min(46cqw, 56cqh)",
            height: "min(46cqw, 56cqh)",
            // A care action briefly overrides the idle bob/snooze with its own
            // springy wiggle, then settles back once the reaction clears.
            animation: reaction
              ? `${REACTION_CONFIG[reaction].petAnim} ${REACTION_MS}ms ease-in-out`
              : isSleepy
                ? "tamagotchi-snooze 2.6s ease-in-out infinite"
                : "tamagotchi-bob 2.2s ease-in-out infinite",
          }}
        >
          {/* Floating-icon burst: a few emoji drift up and fade out over the pet
              on each interaction. Keyed on reactionKey so repeating the same
              action restarts the animation. */}
          {reaction && (
            <div
              key={reactionKey}
              className="pointer-events-none absolute inset-0 z-10 overflow-visible"
              aria-hidden="true"
            >
              {Array.from({ length: REACTION_CONFIG[reaction].count }).map((_, i, arr) => {
                const spread = arr.length > 1 ? i / (arr.length - 1) : 0.5;
                const left = 28 + spread * 44; // spread icons across the pet
                return (
                  <span
                    key={i}
                    className="absolute leading-none"
                    style={{
                      left: `${left}%`,
                      top: "38%",
                      fontSize: "9cqmin",
                      transform: "translate(-50%, 0)",
                      animation: `tamagotchi-float ${REACTION_MS}ms ease-out both`,
                      animationDelay: `${i * 90}ms`,
                    }}
                  >
                    {REACTION_CONFIG[reaction].emoji}
                  </span>
                );
              })}
            </div>
          )}
        </PetFace>
      </div>

      <div
        className="font-semibold uppercase tracking-widest text-center text-muted-foreground"
        style={{ fontSize: "4.5cqmin", paddingBlock: "1.5cqmin" }}
        aria-live="polite"
      >
        {MOOD_LABEL[mood]}
      </div>

      {/* Stat meters. */}
      <div className="flex flex-col gap-[1.6cqmin] px-[5cqmin]">
        <StatBar
          label="Hunger"
          value={pet.hunger}
          color="#f59e0b"
          icon={<Drumstick style={{ width: "100%", height: "100%" }} />}
        />
        <StatBar
          label="Happiness"
          value={pet.happiness}
          color="#ec4899"
          icon={<Gamepad2 style={{ width: "100%", height: "100%" }} />}
        />
        <StatBar
          label="Energy"
          value={pet.energy}
          color="#3b82f6"
          icon={<Moon style={{ width: "100%", height: "100%" }} />}
        />
      </div>

      {/* Care actions. */}
      <div className="flex items-stretch justify-center gap-[2cqmin] p-[4cqmin]">
        <CareButton
          label="Feed"
          disabled={readOnly}
          onClick={feed}
          icon={<Drumstick style={{ width: "100%", height: "100%" }} />}
        />
        <CareButton
          label="Play"
          disabled={readOnly}
          onClick={play}
          icon={<Gamepad2 style={{ width: "100%", height: "100%" }} />}
        />
        <CareButton
          label="Rest"
          disabled={readOnly}
          onClick={rest}
          icon={<Moon style={{ width: "100%", height: "100%" }} />}
        />
      </div>
    </div>
  );
}

interface CareButtonProps {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}

function CareButton({ label, icon, disabled, onClick }: CareButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex flex-1 flex-col items-center justify-center gap-[1cqmin] rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent disabled:opacity-40"
      style={{ paddingBlock: "2cqmin", maxWidth: "28cqmin" }}
    >
      <span style={{ width: "5.5cqmin", height: "5.5cqmin", minWidth: "12px", minHeight: "12px" }}>
        {icon}
      </span>
      <span className="font-semibold leading-none" style={{ fontSize: "3.6cqmin" }}>
        {label}
      </span>
    </button>
  );
}
