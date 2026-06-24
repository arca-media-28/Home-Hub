import { useEffect, useRef, useState } from "react";
import type { Tile, TileSettings } from "@workspace/api-client-react";
import { useUpdateTile, getGetTilesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Pause, RotateCcw } from "lucide-react";

// Default countdown duration (5 minutes) when a countdown tile has none set.
export const DEFAULT_TIMER_DURATION_SECONDS = 5 * 60;

interface TimerTileProps {
  tile: Tile;
  // In edit (layout) mode the tile is a drag/resize target, so its controls are
  // disabled — the timer is operated in locked mode.
  editMode: boolean;
}

// The portion of the tile's settings the timer owns and mutates: a running flag
// plus an anchor timestamp and the elapsed time banked before it. Holding this
// in local state keeps the controls responsive (the dashboard's tile query is
// page-scoped, so a cache reconcile here can't drive re-renders) while still
// persisting so a running timer resumes after refresh/navigation.
interface RunState {
  running: boolean;
  startedAt: number | null;
  accumulatedMs: number;
}

function runStateFromTile(tile: Tile): RunState {
  return {
    running: tile.tileSettings?.timerRunning ?? false,
    startedAt: tile.tileSettings?.timerStartedAt ?? null,
    accumulatedMs: tile.tileSettings?.timerAccumulatedMs ?? 0,
  };
}

// Format a non-negative millisecond count as H:MM:SS (hours dropped when zero,
// so short timers read MM:SS). Always pads minutes/seconds to two digits.
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

// A client-side stopwatch / countdown tile. It runs entirely in the browser (no
// network calls for data) but persists its run state — an anchor timestamp plus
// accumulated elapsed time — back to the server through the normal tile-update
// flow so a running timer keeps the correct time across refresh and page
// navigation. Mode (count up / count down) and the countdown duration come from
// the tile editor modal; Start / Pause / Reset are driven here in locked mode.
export default function TimerTile({ tile, editMode }: TimerTileProps) {
  const queryClient = useQueryClient();
  const updateTile = useUpdateTile({
    mutation: {
      onSuccess: (updated) => {
        // Reconcile the saved tile into the list cache so a later refetch keeps
        // the run state we just wrote.
        queryClient.setQueryData<Tile[]>(getGetTilesQueryKey(), (old) =>
          old?.map((t) => (t.id === updated.id ? updated : t)),
        );
      },
    },
  });

  const mode = tile.tileSettings?.timerMode ?? "countup";
  const isCountdown = mode === "countdown";
  const durationMs =
    (tile.tileSettings?.timerDuration ?? DEFAULT_TIMER_DURATION_SECONDS) * 1000;

  // Local source of truth for the run state, seeded from the persisted tile.
  const [run, setRun] = useState<RunState>(() => runStateFromTile(tile));

  // The last run-state we know is persisted, so we can tell our own saves
  // (which round-trip back through props) apart from external changes — e.g. the
  // editor modal resetting the timer when its config is edited. When props bring
  // a run-state we did not initiate, adopt it.
  const lastPersistedRef = useRef<RunState>(runStateFromTile(tile));
  const propRunning = tile.tileSettings?.timerRunning ?? false;
  const propStartedAt = tile.tileSettings?.timerStartedAt ?? null;
  const propAccumulated = tile.tileSettings?.timerAccumulatedMs ?? 0;
  useEffect(() => {
    const lp = lastPersistedRef.current;
    if (
      propRunning !== lp.running ||
      propStartedAt !== lp.startedAt ||
      propAccumulated !== lp.accumulatedMs
    ) {
      const next = {
        running: propRunning,
        startedAt: propStartedAt,
        accumulatedMs: propAccumulated,
      };
      lastPersistedRef.current = next;
      setRun(next);
    }
  }, [propRunning, propStartedAt, propAccumulated]);

  // A ticking clock that re-renders the live display while the timer runs.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!run.running || run.startedAt == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [run.running, run.startedAt]);

  // Elapsed time = what was banked before this run segment + the live segment.
  const elapsedMs =
    run.accumulatedMs +
    (run.running && run.startedAt != null ? Math.max(0, now - run.startedAt) : 0);

  // What the big readout shows: elapsed for count-up, remaining for countdown.
  const remainingMs = Math.max(0, durationMs - elapsedMs);
  const finished = isCountdown && remainingMs <= 0;
  const displayMs = isCountdown ? remainingMs : elapsedMs;

  // Apply a new run state both locally (instant UI) and to the server (so it
  // survives refresh). Preserve every other tileSettings key — a PUT replaces
  // the whole settings blob.
  function applyRun(next: RunState) {
    lastPersistedRef.current = next;
    setRun(next);
    const settings: TileSettings = {
      ...(tile.tileSettings ?? {}),
      timerRunning: next.running,
      timerStartedAt: next.startedAt,
      timerAccumulatedMs: next.accumulatedMs,
    };
    updateTile.mutate({ id: tile.id, data: { tileSettings: settings } });
  }

  // When a running countdown hits zero, bank the full duration and stop so the
  // tile settles into a finished/paused state instead of ticking past zero.
  const finishHandled = useRef(false);
  useEffect(() => {
    if (finished && run.running) {
      if (finishHandled.current) return;
      finishHandled.current = true;
      applyRun({ running: false, startedAt: null, accumulatedMs: durationMs });
    } else if (!finished) {
      finishHandled.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, run.running]);

  function handleStart() {
    // Nothing to start when a countdown is already at zero.
    if (isCountdown && remainingMs <= 0) return;
    applyRun({ running: true, startedAt: Date.now(), accumulatedMs: elapsedMs });
  }

  function handlePause() {
    applyRun({ running: false, startedAt: null, accumulatedMs: elapsedMs });
  }

  function handleReset() {
    applyRun({ running: false, startedAt: null, accumulatedMs: 0 });
  }

  const display = formatDuration(displayMs);
  const readOnly = editMode;

  // Scale the readout to the tile, width-bound by character count and
  // height-bound so it never overflows (same approach as the clock tile).
  const timeWidthCqw = 100 / (display.length * 0.62);
  const timeFontSize = `min(${timeWidthCqw.toFixed(1)}cqw, 34cqh)`;

  const canStart = !run.running && !(isCountdown && remainingMs <= 0);

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-[3cqh] px-2 overflow-hidden text-foreground"
      style={{ containerType: "size" }}
    >
      <span
        className={`font-bold leading-none tabular-nums tracking-tight whitespace-nowrap transition-colors ${
          finished ? "text-destructive" : ""
        }`}
        style={{ fontSize: timeFontSize }}
      >
        {display}
      </span>

      <div className="flex items-center gap-2">
        {run.running ? (
          <button
            type="button"
            onClick={handlePause}
            disabled={readOnly}
            aria-label="Pause timer"
            title="Pause"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Pause className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStart}
            disabled={readOnly || !canStart}
            aria-label="Start timer"
            title="Start"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={handleReset}
          disabled={readOnly || (elapsedMs === 0 && !run.running)}
          aria-label="Reset timer"
          title="Reset"
          className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-accent disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      {finished && (
        <span className="text-[10px] font-semibold uppercase tracking-widest text-destructive">
          Time's up
        </span>
      )}
    </div>
  );
}
