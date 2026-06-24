import { useEffect, useRef, useState } from "react";
import type { Tile, TileSettings } from "@workspace/api-client-react";
import { useUpdateTile, getGetTilesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Pause, RotateCcw } from "lucide-react";
import { playTimerChime, showTimerNotification } from "@/lib/timerAlert";

// Default countdown duration (5 minutes) when a countdown tile has none set.
export const DEFAULT_TIMER_DURATION_SECONDS = 5 * 60;

// Default pomodoro configuration, following the classic technique.
export const DEFAULT_POMODORO_FOCUS_MIN = 25;
export const DEFAULT_POMODORO_SHORT_BREAK_MIN = 5;
export const DEFAULT_POMODORO_LONG_BREAK_MIN = 15;
export const DEFAULT_POMODORO_SESSIONS = 4;

export type PomodoroPhase = "focus" | "shortBreak" | "longBreak";

const PHASE_LABEL: Record<PomodoroPhase, string> = {
  focus: "Focus",
  shortBreak: "Short Break",
  longBreak: "Long Break",
};

interface TimerTileProps {
  tile: Tile;
  // In edit (layout) mode the tile is a drag/resize target, so its controls are
  // disabled — the timer is operated in locked mode.
  editMode: boolean;
}

// The portion of the tile's settings the timer owns and mutates: a running flag
// plus an anchor timestamp and the elapsed time banked before it. For pomodoro
// mode it also tracks the current phase and the count of focus sessions done in
// the current cycle. Holding this in local state keeps the controls responsive
// (the dashboard's tile query is page-scoped, so a cache reconcile here can't
// drive re-renders) while still persisting so a running timer resumes after
// refresh/navigation.
interface RunState {
  running: boolean;
  startedAt: number | null;
  accumulatedMs: number;
  phase: PomodoroPhase;
  completedSessions: number;
}

function runStateFromTile(tile: Tile): RunState {
  return {
    running: tile.tileSettings?.timerRunning ?? false,
    startedAt: tile.tileSettings?.timerStartedAt ?? null,
    accumulatedMs: tile.tileSettings?.timerAccumulatedMs ?? 0,
    phase: (tile.tileSettings?.pomodoroPhase as PomodoroPhase) ?? "focus",
    completedSessions: tile.tileSettings?.pomodoroCompletedSessions ?? 0,
  };
}

// Compute the next pomodoro phase + completed-session count when the current
// phase finishes. A finished focus session increments the count and triggers a
// long break once it reaches the configured threshold; otherwise a short break.
// Any break returns to focus, and the long break also resets the cycle count.
function nextPomodoroState(
  phase: PomodoroPhase,
  completedSessions: number,
  sessionsBeforeLong: number,
): { phase: PomodoroPhase; completedSessions: number } {
  if (phase === "focus") {
    const completed = completedSessions + 1;
    if (completed >= sessionsBeforeLong) {
      return { phase: "longBreak", completedSessions: completed };
    }
    return { phase: "shortBreak", completedSessions: completed };
  }
  if (phase === "longBreak") {
    return { phase: "focus", completedSessions: 0 };
  }
  return { phase: "focus", completedSessions };
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

// A client-side stopwatch / countdown / pomodoro tile. It runs entirely in the
// browser (no network calls for data) but persists its run state — an anchor
// timestamp plus accumulated elapsed time (and, for pomodoro, the current phase
// and cycle count) — back to the server through the normal tile-update flow so
// a running timer keeps the correct time across refresh and page navigation.
// Mode and the durations come from the tile editor modal; Start / Pause / Reset
// are driven here in locked mode.
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
  const isPomodoro = mode === "pomodoro";
  const durationMs =
    (tile.tileSettings?.timerDuration ?? DEFAULT_TIMER_DURATION_SECONDS) * 1000;
  const alertEnabled = tile.tileSettings?.timerAlertEnabled ?? false;

  // Pomodoro configuration (minutes -> ms), with classic-technique defaults.
  const focusMs =
    (tile.tileSettings?.pomodoroFocusMinutes ?? DEFAULT_POMODORO_FOCUS_MIN) * 60_000;
  const shortBreakMs =
    (tile.tileSettings?.pomodoroShortBreakMinutes ?? DEFAULT_POMODORO_SHORT_BREAK_MIN) *
    60_000;
  const longBreakMs =
    (tile.tileSettings?.pomodoroLongBreakMinutes ?? DEFAULT_POMODORO_LONG_BREAK_MIN) *
    60_000;
  const sessionsBeforeLong = Math.max(
    1,
    tile.tileSettings?.pomodoroSessionsBeforeLongBreak ?? DEFAULT_POMODORO_SESSIONS,
  );

  function phaseDurationMs(phase: PomodoroPhase): number {
    switch (phase) {
      case "focus":
        return Math.max(1_000, focusMs);
      case "shortBreak":
        return Math.max(1_000, shortBreakMs);
      case "longBreak":
        return Math.max(1_000, longBreakMs);
    }
  }

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
  const propPhase = (tile.tileSettings?.pomodoroPhase as PomodoroPhase) ?? "focus";
  const propCompleted = tile.tileSettings?.pomodoroCompletedSessions ?? 0;
  useEffect(() => {
    const lp = lastPersistedRef.current;
    if (
      propRunning !== lp.running ||
      propStartedAt !== lp.startedAt ||
      propAccumulated !== lp.accumulatedMs ||
      propPhase !== lp.phase ||
      propCompleted !== lp.completedSessions
    ) {
      const next = {
        running: propRunning,
        startedAt: propStartedAt,
        accumulatedMs: propAccumulated,
        phase: propPhase,
        completedSessions: propCompleted,
      };
      lastPersistedRef.current = next;
      setRun(next);
    }
  }, [propRunning, propStartedAt, propAccumulated, propPhase, propCompleted]);

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

  // The active interval length: the current pomodoro phase, or the countdown
  // duration. (Count-up has no target.)
  const effectiveDurationMs = isPomodoro
    ? phaseDurationMs(run.phase)
    : durationMs;

  // What the big readout shows: remaining for countdown/pomodoro, elapsed for
  // count-up.
  const showRemaining = isCountdown || isPomodoro;
  const remainingMs = Math.max(0, effectiveDurationMs - elapsedMs);
  const finished = isCountdown && remainingMs <= 0;
  const displayMs = showRemaining ? remainingMs : elapsedMs;

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
      pomodoroPhase: next.phase,
      pomodoroCompletedSessions: next.completedSessions,
    };
    updateTile.mutate({ id: tile.id, data: { tileSettings: settings } });
  }

  // When a running countdown hits zero, bank the full duration and stop so the
  // tile settles into a finished/paused state instead of ticking past zero.
  const finishHandled = useRef(false);
  useEffect(() => {
    if (isPomodoro) return;
    if (finished && run.running) {
      if (finishHandled.current) return;
      finishHandled.current = true;
      // Alert the user (chime + browser notification) if enabled. This fires
      // for the running -> finished transition only, including when a refresh
      // resumes a timer that has already elapsed (it loads as running, then
      // this effect settles it to finished).
      if (alertEnabled) {
        playTimerChime();
        showTimerNotification(
          tile.name?.trim() ? tile.name : "Timer",
          "Your countdown has finished.",
        );
      }
      applyRun({
        running: false,
        startedAt: null,
        accumulatedMs: durationMs,
        phase: run.phase,
        completedSessions: run.completedSessions,
      });
    } else if (!finished) {
      finishHandled.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, run.running, isPomodoro]);

  // Pomodoro: when a running phase reaches zero, auto-advance to the next phase.
  // The transition is computed from elapsed time so it stays accurate across
  // refresh/navigation — any overflow past the phase boundary (e.g. the page
  // was hidden while several intervals elapsed) is carried into the new phase by
  // anchoring its start in the past, advancing through every fully-elapsed phase
  // in a single pass.
  const phaseAdvanceHandled = useRef(false);
  useEffect(() => {
    if (!isPomodoro) return;
    if (run.running && remainingMs <= 0) {
      if (phaseAdvanceHandled.current) return;
      phaseAdvanceHandled.current = true;
      let phase = run.phase;
      let completed = run.completedSessions;
      let overflow = Math.max(0, elapsedMs - effectiveDurationMs);
      // Walk forward through each elapsed phase, consuming its duration, until
      // the remaining overflow fits inside the current phase.
      for (let guard = 0; guard < 10_000; guard++) {
        const next = nextPomodoroState(phase, completed, sessionsBeforeLong);
        phase = next.phase;
        completed = next.completedSessions;
        const dur = phaseDurationMs(phase);
        if (overflow < dur) break;
        overflow -= dur;
      }
      applyRun({
        running: true,
        startedAt: Date.now() - overflow,
        accumulatedMs: 0,
        phase,
        completedSessions: completed,
      });
    } else if (remainingMs > 0) {
      phaseAdvanceHandled.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPomodoro, run.running, remainingMs]);

  function handleStart() {
    // Nothing to start when a countdown is already at zero.
    if (isCountdown && remainingMs <= 0) return;
    applyRun({
      running: true,
      startedAt: Date.now(),
      accumulatedMs: elapsedMs,
      phase: run.phase,
      completedSessions: run.completedSessions,
    });
  }

  function handlePause() {
    applyRun({
      running: false,
      startedAt: null,
      accumulatedMs: elapsedMs,
      phase: run.phase,
      completedSessions: run.completedSessions,
    });
  }

  function handleReset() {
    // Pomodoro resets to the start of a fresh focus cycle; the simpler modes
    // just rewind to zero.
    applyRun({
      running: false,
      startedAt: null,
      accumulatedMs: 0,
      phase: "focus",
      completedSessions: 0,
    });
  }

  const display = formatDuration(displayMs);
  const readOnly = editMode;

  // Scale the readout to the tile, width-bound by character count and
  // height-bound so it never overflows (same approach as the clock tile).
  const timeWidthCqw = 100 / (display.length * 0.62);
  const timeHeightCqh = isPomodoro ? 28 : 34;
  const timeFontSize = `min(${timeWidthCqw.toFixed(1)}cqw, ${timeHeightCqh}cqh)`;

  const canStart = !run.running && !(isCountdown && remainingMs <= 0);
  const isBreak = run.phase === "shortBreak" || run.phase === "longBreak";

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-[2.5cqh] px-2 overflow-hidden text-foreground"
      style={{ containerType: "size" }}
    >
      <span
        className={`font-bold leading-none tabular-nums tracking-tight whitespace-nowrap transition-colors ${
          finished ? "text-destructive" : isPomodoro && isBreak ? "text-emerald-500" : ""
        }`}
        style={{ fontSize: timeFontSize }}
      >
        {display}
      </span>

      {isPomodoro && (
        <div className="flex flex-col items-center gap-1.5">
          <span
            className={`text-[14px] font-semibold uppercase tracking-widest leading-none ${
              isBreak ? "text-emerald-500" : "text-primary"
            }`}
          >
            {PHASE_LABEL[run.phase]}
          </span>
          <div className="flex items-center gap-1" aria-label="Completed focus sessions">
            {Array.from({ length: sessionsBeforeLong }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  i < run.completedSessions ? "bg-primary" : "bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>
        </div>
      )}

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
          disabled={readOnly || (elapsedMs === 0 && !run.running && run.phase === "focus" && run.completedSessions === 0)}
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
