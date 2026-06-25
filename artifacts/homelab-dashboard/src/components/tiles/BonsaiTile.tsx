import { useEffect, useRef, useState } from "react";
import type { Tile, TileSettings } from "@workspace/api-client-react";
import { useUpdateTile, getGetTilesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Droplets, Scissors, AlertTriangle } from "lucide-react";

// Hydration and tidiness both live on a 0-100 scale: 0 is the worst (parched /
// wildly overgrown) and 100 is the best (well watered / freshly pruned). A new
// tree starts healthy but with a little room to care for it right away.
const STAT_MAX = 100;
const STAT_MIN = 0;
const DEFAULT_HYDRATION = 72;
// Overgrowth runs the other way: 0 = freshly pruned/tidy, 100 = wild. Stored as
// overgrowth, but shown to the user as "tidiness" (100 - overgrowth).
const DEFAULT_OVERGROWTH = 22;
const DEFAULT_GROWTH = 0;

// Growth progress (0-100) drives the visible stage. It accrues while the tree is
// healthy and slowly regresses when it is neglected.
const GROWTH_MAX = 100;

// At/below this hydration the soil is "bone dry" and the tree visibly wilts and
// asks for water; at/above (100 - this) overgrowth it is "overgrown" and asks
// for a prune. Shared by the attention cue and the condition label so the visual
// and the text always agree.
const CRITICAL = 25;

// A tree counts as "healthy enough to grow" at or above this overall health.
const HEALTHY_THRESHOLD = 55;

// Per-hour rates (points/hour). Tuned around a gentle once-a-day care rhythm: a
// freshly tended tree slides toward needing attention over roughly a day, and a
// tree kept healthy reaches the mature stage after several days of care.
const HYDRATION_DECAY_PER_HOUR = 2.4; // topped-up soil drifts to its trough over ~a day
const OVERGROWTH_GAIN_PER_HOUR = 2.0; // tidy -> shaggy over ~a day
const GROWTH_PER_HOUR_HEALTHY = 0.6; // ~a week of daily care to reach mature
const GROWTH_REGRESS_PER_HOUR = 0.5; // slow backslide when neglected

// How much each care action restores. Watering refills the soil; pruning cuts
// the canopy back to tidy. Sized so once-a-day care keeps the tree healthy for
// most of the day and lets it grow, while a missed day visibly strains it.
const WATER_AMOUNT = 60;
const PRUNE_AMOUNT = 65;

const SAVE_DEBOUNCE_MS = 800;
// Recompute decay on a slow interval while mounted so the tree drifts visibly
// without the persistence churn of a per-second tick.
const TICK_MS = 15_000;
// How long a care reaction (sway + floating icons) plays before settling.
const REACTION_MS = 1000;

// Integration step for the wall-clock decay. Hydration, overgrowth and growth
// are integrated together in small steps because growth depends on health, which
// itself changes as hydration drops and overgrowth rises across a long absence.
const DECAY_STEP_HOURS = 0.5;
const DECAY_MAX_STEPS = 4000;

interface TreeState {
  hydration: number;
  overgrowth: number;
  growth: number;
  updatedAt: number;
}

type CareKind = "water" | "prune";

// Per-action reaction styling: the emoji that floats up over the tree, how many
// copies spawn, and which short animation the tree plays.
const REACTION_CONFIG: Record<
  CareKind,
  { emoji: string; count: number; treeAnim: string }
> = {
  water: { emoji: "💧", count: 4, treeAnim: "bonsai-drink" },
  prune: { emoji: "✂️", count: 3, treeAnim: "bonsai-trim" },
};

function clamp(n: number): number {
  return Math.max(STAT_MIN, Math.min(STAT_MAX, n));
}

function treeStateFromTile(tile: Tile): TreeState {
  const s = tile.tileSettings;
  return {
    hydration: clamp(s?.bonsaiHydration ?? DEFAULT_HYDRATION),
    overgrowth: clamp(s?.bonsaiOvergrowth ?? DEFAULT_OVERGROWTH),
    growth: Math.max(0, Math.min(GROWTH_MAX, s?.bonsaiGrowth ?? DEFAULT_GROWTH)),
    updatedAt: s?.bonsaiUpdatedAt ?? Date.now(),
  };
}

// Overall health blends hydration with tidiness (100 - overgrowth) — both need
// to be reasonable for the tree to thrive.
function healthOf(state: TreeState): number {
  return (state.hydration + (STAT_MAX - state.overgrowth)) / 2;
}

// Apply real-elapsed-time decay from the tree's last-updated anchor up to `now`.
// This is what keeps the tree alive across reloads/sessions: hydration drops,
// overgrowth rises, and growth advances or regresses based on the health it had
// across the interval — all recomputed from wall-clock time, not just while the
// tab was open. Integrated in small steps so growth tracks the changing health,
// with an early exit once the tree has fully bottomed out.
function decayTo(state: TreeState, now: number): TreeState {
  let elapsedH = (now - state.updatedAt) / 3_600_000;
  if (elapsedH <= 0) return state;

  let hydration = state.hydration;
  let overgrowth = state.overgrowth;
  let growth = state.growth;

  for (let step = 0; step < DECAY_MAX_STEPS && elapsedH > 0; step++) {
    const dt = Math.min(DECAY_STEP_HOURS, elapsedH);
    elapsedH -= dt;
    hydration = clamp(hydration - HYDRATION_DECAY_PER_HOUR * dt);
    overgrowth = clamp(overgrowth + OVERGROWTH_GAIN_PER_HOUR * dt);
    const health = (hydration + (STAT_MAX - overgrowth)) / 2;
    if (health >= HEALTHY_THRESHOLD) {
      growth = Math.min(GROWTH_MAX, growth + GROWTH_PER_HOUR_HEALTHY * dt);
    } else {
      growth = Math.max(0, growth - GROWTH_REGRESS_PER_HOUR * dt);
    }
    // Once everything has bottomed out, further time changes nothing — stop
    // early so a tree dormant for months doesn't loop needlessly.
    if (hydration <= STAT_MIN && overgrowth >= STAT_MAX && growth <= 0) break;
  }

  return { hydration, overgrowth, growth, updatedAt: now };
}

type Stage = "sapling" | "young" | "mature";

const STAGE_LABEL: Record<Stage, string> = {
  sapling: "Sapling",
  young: "Young",
  mature: "Mature",
};

function stageOf(growth: number): Stage {
  if (growth >= 67) return "mature";
  if (growth >= 34) return "young";
  return "sapling";
}

type Condition = "thirsty" | "overgrown" | "thriving" | "healthy" | "struggling";

// The tree's headline condition, picking the most urgent problem first so the
// label and the attention cue always name the same thing.
function conditionOf(state: TreeState): Condition {
  if (state.hydration <= CRITICAL) return "thirsty";
  if (state.overgrowth >= STAT_MAX - CRITICAL) return "overgrown";
  const health = healthOf(state);
  if (health >= 75) return "thriving";
  if (health >= HEALTHY_THRESHOLD) return "healthy";
  return "struggling";
}

const CONDITION_LABEL: Record<Condition, string> = {
  thirsty: "Thirsty",
  overgrown: "Overgrown",
  thriving: "Thriving",
  healthy: "Healthy",
  struggling: "Struggling",
};

// The single most urgent care need, only when something is critically off —
// drives the pulsing "needs attention" badge. Null when the tree is fine.
type NeedKind = "water" | "prune";

function urgentNeed(state: TreeState): NeedKind | null {
  if (state.hydration <= CRITICAL) return "water";
  if (state.overgrowth >= STAT_MAX - CRITICAL) return "prune";
  return null;
}

const NEED_BADGE: Record<NeedKind, string> = {
  water: "Needs water",
  prune: "Needs pruning",
};

// Linear interpolate between two #rrggbb hex colors at t in [0,1].
function lerpHex(a: string, b: string, t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i]! - v) * x));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// A lush, healthy canopy green and the dry, wilted tone a parched tree fades to.
const LEAF_LUSH = "#4ea832";
const LEAF_DRY = "#a98a3c";

// Canopy layout per stage: the trunk's top height and the foliage blobs (cx, cy,
// r on the 0-100 viewBox). Higher stages have a taller trunk and a fuller,
// wider canopy so growth is clearly visible.
interface Blob {
  cx: number;
  cy: number;
  r: number;
}

const STAGE_BLOBS: Record<Stage, Blob[]> = {
  sapling: [
    { cx: 50, cy: 44, r: 14 },
    { cx: 42, cy: 50, r: 10 },
    { cx: 58, cy: 50, r: 10 },
  ],
  young: [
    { cx: 50, cy: 34, r: 17 },
    { cx: 36, cy: 44, r: 14 },
    { cx: 64, cy: 44, r: 14 },
    { cx: 50, cy: 50, r: 13 },
  ],
  mature: [
    { cx: 50, cy: 26, r: 19 },
    { cx: 31, cy: 38, r: 16 },
    { cx: 69, cy: 38, r: 16 },
    { cx: 40, cy: 50, r: 15 },
    { cx: 60, cy: 50, r: 15 },
  ],
};

// Trunk top y per stage (where the canopy sits / the trunk fork reaches).
const STAGE_TRUNK_TOP: Record<Stage, number> = {
  sapling: 48,
  young: 40,
  mature: 32,
};

// Scraggly offshoots that poke beyond a tidy canopy when the tree gets
// overgrown. Each is a short line from a base point outward. Their opacity is
// driven by how overgrown the tree is, so they fade in gradually.
const SPRIGS: { x1: number; y1: number; x2: number; y2: number }[] = [
  { x1: 34, y1: 40, x2: 24, y2: 30 },
  { x1: 66, y1: 40, x2: 76, y2: 31 },
  { x1: 50, y1: 26, x2: 50, y2: 12 },
  { x1: 40, y1: 50, x2: 30, y2: 56 },
  { x1: 60, y1: 50, x2: 71, y2: 55 },
  { x1: 44, y1: 34, x2: 38, y2: 22 },
];

interface BonsaiTreeProps {
  stage: Stage;
  hydration: number;
  overgrowth: number;
}

// The bonsai itself — a pot, a curved trunk, and a stage-sized canopy drawn on a
// 0-100 SVG viewBox so it scales to any tile size via the container. Hydration
// tints the foliage (lush green -> dry tan) and droops it when low; overgrowth
// fades in scraggly offshoots beyond the tidy canopy.
function BonsaiTree({ stage, hydration, overgrowth }: BonsaiTreeProps) {
  const blobs = STAGE_BLOBS[stage];
  const trunkTop = STAGE_TRUNK_TOP[stage];
  // Drier soil = wilted tone + a slight downward droop of the canopy.
  const dryness = 1 - hydration / 100;
  const leaf = lerpHex(LEAF_LUSH, LEAF_DRY, dryness);
  const leafDark = lerpHex("#3a7d24", "#7d6526", dryness);
  const droop = dryness * 6; // px on the viewBox
  // Scraggly offshoots fade in as overgrowth climbs past tidy.
  const sprigOpacity = Math.max(0, Math.min(0.9, (overgrowth - 35) / 65));

  return (
    <svg
      viewBox="0 0 100 100"
      className="h-full w-full select-none overflow-visible"
      aria-hidden="true"
    >
      {/* Pot */}
      <path
        d="M30 80 L70 80 L65 96 L35 96 Z"
        fill="#9c5a33"
      />
      <path d="M28 78 L72 78 L70 83 L30 83 Z" fill="#b87142" />
      {/* Soil — darkens when well watered, pales when dry. */}
      <ellipse
        cx={50}
        cy={79}
        rx={19}
        ry={3.2}
        fill={lerpHex("#7a5230", "#3f2a16", hydration / 100)}
      />

      {/* Trunk: a gently curved path from the soil up to the canopy fork. */}
      <path
        d={`M50 80 C46 ${72} 54 ${64} 49 ${trunkTop + 10} C46 ${trunkTop + 4} 52 ${trunkTop + 2} 50 ${trunkTop}`}
        stroke="#7a4a28"
        strokeWidth={stage === "mature" ? 6 : stage === "young" ? 5 : 4}
        strokeLinecap="round"
        fill="none"
      />

      {/* Scraggly overgrowth offshoots (behind the canopy blobs). */}
      {sprigOpacity > 0.02 && (
        <g stroke={leafDark} strokeWidth={1.6} strokeLinecap="round" opacity={sprigOpacity}>
          {SPRIGS.map((s, i) => (
            <line key={i} x1={s.x1} y1={s.y1 + droop} x2={s.x2} y2={s.y2 + droop} />
          ))}
        </g>
      )}

      {/* Canopy: overlapping foliage blobs sized by stage. */}
      <g transform={`translate(0 ${droop})`}>
        {blobs.map((b, i) => (
          <circle key={`d${i}`} cx={b.cx} cy={b.cy + 1.5} r={b.r} fill={leafDark} />
        ))}
        {blobs.map((b, i) => (
          <circle key={`l${i}`} cx={b.cx} cy={b.cy} r={b.r} fill={leaf} />
        ))}
        {/* A soft highlight on the main canopy blob for a little depth. */}
        <circle
          cx={blobs[0]!.cx - blobs[0]!.r * 0.3}
          cy={blobs[0]!.cy - blobs[0]!.r * 0.35}
          r={blobs[0]!.r * 0.4}
          fill="rgba(255,255,255,0.22)"
        />
      </g>
    </svg>
  );
}

interface StatBarProps {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
}

// One labeled 0-100 meter, sized with container-query units so the whole
// tree + stats block scales to fill any tile dimension.
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
      className="flex flex-1 flex-col items-center justify-center gap-[1cqmin] rounded-md border border-border bg-card py-[2cqmin] text-foreground transition-colors hover:bg-accent disabled:opacity-40"
    >
      <span style={{ width: "5cqmin", height: "5cqmin", minWidth: "12px", minHeight: "12px" }}>
        {icon}
      </span>
      <span className="font-medium leading-none" style={{ fontSize: "3.4cqmin" }}>
        {label}
      </span>
    </button>
  );
}

interface BonsaiTileProps {
  tile: Tile;
  // In edit (layout) mode the tile is a drag/resize target, so the care buttons
  // are disabled — the tree is tended in locked mode.
  editMode: boolean;
}

// A self-contained bonsai-tree toy tile. It keeps living state (soil hydration,
// overgrowth, and growth progress) that changes over real wall-clock time, so it
// feels alive across reloads and sessions: hydration drops, the canopy gets
// shaggy, and the tree grows through stages while kept healthy (and stalls or
// regresses when neglected). State is recomputed from a stored last-updated
// timestamp on mount and on a slow interval, and persisted back through the
// normal tile-update flow (debounced, preserving every other tileSettings key)
// — following the Tamagotchi/Note/Timer in-place persistence pattern.
export default function BonsaiTile({ tile, editMode }: BonsaiTileProps) {
  const queryClient = useQueryClient();
  const updateTile = useUpdateTile({
    mutation: {
      onSuccess: (updated) => {
        // Reconcile the saved tree into the tile list cache so a later refetch
        // doesn't clobber the live state we just wrote.
        queryClient.setQueryData<Tile[]>(getGetTilesQueryKey(), (old) =>
          old?.map((t) => (t.id === updated.id ? updated : t)),
        );
      },
    },
  });

  // Local source of truth, seeded from the persisted tile with elapsed-time
  // decay already applied so a long-dormant tree shows its real current state.
  const [tree, setTree] = useState<TreeState>(() =>
    decayTo(treeStateFromTile(tile), Date.now()),
  );

  // Reset local state only when a different tile mounts in this slot — never on
  // every prop change — so an in-flight save round-trip can't overwrite the live
  // tree (same safeguard the tamagotchi/note/timer use).
  const lastIdRef = useRef(tile.id);
  useEffect(() => {
    if (lastIdRef.current !== tile.id) {
      lastIdRef.current = tile.id;
      setTree(decayTo(treeStateFromTile(tile), Date.now()));
    }
  }, [tile]);

  // Latest values for the debounced / unmount flush, kept current via refs.
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const tileRef = useRef(tile);
  tileRef.current = tile;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The currently-playing care reaction (drives a short tree sway plus floating
  // icons). Cleared automatically after REACTION_MS.
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

  function persistNow(next: TreeState) {
    const current = tileRef.current;
    // Preserve every other tileSettings key since a PUT replaces the whole blob.
    const settings: TileSettings = {
      ...(current.tileSettings ?? {}),
      bonsaiHydration: Math.round(next.hydration),
      bonsaiOvergrowth: Math.round(next.overgrowth),
      bonsaiGrowth: Math.round(next.growth),
      bonsaiUpdatedAt: next.updatedAt,
    };
    updateTile.mutate({ id: current.id, data: { tileSettings: settings } });
  }

  function scheduleSave(next: TreeState) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      persistNow(next);
    }, SAVE_DEBOUNCE_MS);
  }

  // Anchor a brand-new tree to storage as soon as it mounts. Without this, a tile
  // that is never tended keeps re-defaulting its bonsaiUpdatedAt to "now" on
  // every load, so elapsed time between sessions is never captured and the tree
  // appears to reset. Writing the starting state + timestamp once fixes the
  // wall-clock anchor from the moment the tile is added.
  const initedRef = useRef(false);
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    if (tileRef.current.tileSettings?.bonsaiUpdatedAt == null) {
      persistNow(treeRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the current (decayed-to-now) state whenever the tile goes away or the
  // tab is hidden — not only after a care action. This is what makes passive
  // decay/growth durable across reloads/sessions: the stored anchor + state
  // always reflect the last moment the user saw the tree, so decayTo() on next
  // mount continues from the right point instead of starting over.
  useEffect(() => {
    function flush() {
      const hasPending = saveTimer.current != null;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const decayed = decayTo(treeRef.current, Date.now());
      // decayTo returns the same reference when no time has elapsed; skip a
      // redundant write unless a debounced save was already pending.
      if (!hasPending && decayed === treeRef.current) return;
      treeRef.current = decayed;
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

  // Slow decay tick: recompute from wall-clock time so the tree drifts visibly
  // while the tile is open. State is persisted via the save debounce only when
  // the user acts, so the tick itself stays storage-quiet.
  useEffect(() => {
    const id = setInterval(() => {
      setTree((prev) => decayTo(prev, Date.now()));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Apply a care action: decay up to now, restore the relevant stat, and persist
  // (debounced). Care is disabled while arranging the layout.
  function act(mutate: (cur: TreeState) => TreeState) {
    if (editMode) return;
    setTree((prev) => {
      const cur = decayTo(prev, Date.now());
      const next = { ...mutate(cur), updatedAt: Date.now() };
      scheduleSave(next);
      return next;
    });
  }

  function water() {
    if (editMode) return;
    act((cur) => ({ ...cur, hydration: clamp(cur.hydration + WATER_AMOUNT) }));
    triggerReaction("water");
  }
  function prune() {
    if (editMode) return;
    act((cur) => ({ ...cur, overgrowth: clamp(cur.overgrowth - PRUNE_AMOUNT) }));
    triggerReaction("prune");
  }

  const stage = stageOf(tree.growth);
  const condition = conditionOf(tree);
  const need = urgentNeed(tree);
  const readOnly = editMode;
  const tidiness = STAT_MAX - tree.overgrowth;

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden text-foreground"
      style={{ containerType: "size" }}
    >
      <style>{`
        @keyframes bonsai-sway {
          0%, 100% { transform: rotate(0deg); }
          50% { transform: rotate(1.6deg); }
        }
        @keyframes bonsai-drink {
          0%, 100% { transform: translateY(0) scale(1, 1); }
          40% { transform: translateY(1.5%) scale(1.03, 0.97); }
          70% { transform: translateY(-1%) scale(0.99, 1.02); }
        }
        @keyframes bonsai-trim {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-2.5deg); }
          60% { transform: rotate(2deg); }
        }
        @keyframes bonsai-float {
          0% { opacity: 0; transform: translate(-50%, 0) scale(0.6); }
          15% { opacity: 1; }
          100% { opacity: 0; transform: translate(-50%, -150%) scale(1.15); }
        }
        @keyframes bonsai-attention {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.07); }
        }
        @keyframes bonsai-attention-ring {
          0% { opacity: 0.55; transform: scale(1); }
          70%, 100% { opacity: 0; transform: scale(1.6); }
        }
      `}</style>

      {/* The tree itself, centered and filling the space above the stats. */}
      <div className="relative flex flex-1 min-h-0 items-center justify-center px-[4cqmin] pt-[4cqmin]">
        {/* "Needs attention" cue: a pulsing badge naming the most urgent care
            need whenever the tree is critically thirsty or overgrown. It is
            derived from the current state, so caring for the tree makes it
            disappear on the next render. */}
        {need && (
          <div
            className="absolute z-20 flex items-center rounded-full bg-destructive text-destructive-foreground shadow-md"
            style={{
              top: "3cqmin",
              right: "3cqmin",
              gap: "1.4cqmin",
              paddingInline: "2.6cqmin",
              paddingBlock: "1.2cqmin",
              fontSize: "3.6cqmin",
              animation: "bonsai-attention 1.4s ease-in-out infinite",
            }}
            role="status"
            aria-label={`Needs attention: ${NEED_BADGE[need]}`}
            title={NEED_BADGE[need]}
          >
            <span
              className="pointer-events-none absolute inset-0 rounded-full bg-destructive"
              style={{ animation: "bonsai-attention-ring 1.4s ease-out infinite" }}
              aria-hidden="true"
            />
            <AlertTriangle
              style={{ width: "4cqmin", height: "4cqmin", minWidth: "10px", minHeight: "10px" }}
            />
            <span className="font-semibold leading-none whitespace-nowrap">
              {NEED_BADGE[need]}
            </span>
          </div>
        )}

        <div
          className="relative flex items-center justify-center"
          style={{
            width: "min(60cqw, 64cqh)",
            height: "min(60cqw, 64cqh)",
            transformOrigin: "50% 90%",
            animation: reaction
              ? `${REACTION_CONFIG[reaction].treeAnim} ${REACTION_MS}ms ease-in-out`
              : "bonsai-sway 4s ease-in-out infinite",
          }}
        >
          <BonsaiTree stage={stage} hydration={tree.hydration} overgrowth={tree.overgrowth} />

          {/* Floating-icon burst on each care action. Keyed on reactionKey so
              repeating the same action restarts the animation. */}
          {reaction && (
            <div
              key={reactionKey}
              className="pointer-events-none absolute inset-0 z-10 overflow-visible"
              aria-hidden="true"
            >
              {Array.from({ length: REACTION_CONFIG[reaction].count }).map((_, i, arr) => {
                const spread = arr.length > 1 ? i / (arr.length - 1) : 0.5;
                const left = 28 + spread * 44;
                return (
                  <span
                    key={i}
                    className="absolute leading-none"
                    style={{
                      left: `${left}%`,
                      top: "30%",
                      fontSize: "9cqmin",
                      transform: "translate(-50%, 0)",
                      animation: `bonsai-float ${REACTION_MS}ms ease-out both`,
                      animationDelay: `${i * 90}ms`,
                    }}
                  >
                    {REACTION_CONFIG[reaction].emoji}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Stage + condition headline. */}
      <div
        className="font-semibold uppercase tracking-widest text-center text-muted-foreground"
        style={{ fontSize: "4cqmin", paddingBlock: "1.4cqmin" }}
        aria-live="polite"
      >
        {STAGE_LABEL[stage]} · {CONDITION_LABEL[condition]}
      </div>

      {/* Stat meters: hydration + tidiness. */}
      <div className="flex flex-col gap-[1.6cqmin] px-[5cqmin]">
        <StatBar
          label="Hydration"
          value={tree.hydration}
          color="#38bdf8"
          icon={<Droplets style={{ width: "100%", height: "100%" }} />}
        />
        <StatBar
          label="Tidiness"
          value={tidiness}
          color="#4ea832"
          icon={<Scissors style={{ width: "100%", height: "100%" }} />}
        />
      </div>

      {/* Care actions. */}
      <div className="flex items-stretch justify-center gap-[2cqmin] p-[4cqmin]">
        <CareButton
          label="Water"
          disabled={readOnly}
          onClick={water}
          icon={<Droplets style={{ width: "100%", height: "100%" }} />}
        />
        <CareButton
          label="Prune"
          disabled={readOnly}
          onClick={prune}
          icon={<Scissors style={{ width: "100%", height: "100%" }} />}
        />
      </div>
    </div>
  );
}
