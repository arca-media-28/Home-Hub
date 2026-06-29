// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Tile, TileSettings } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Coverage for the Timer tile's alert behavior. The alerting lives in the
// component's effects (a countdown-finished alert and a pomodoro phase-advance
// alert) and must fire exactly once per zero-crossing, honor the per-tile
// alert toggle, and — when a resumed timer has elapsed past several pomodoro
// phases at once — fire only a single alert for the destination phase rather
// than one per skipped phase.
//
// We mock the sound + notification helpers and the data hooks, then render the
// real tile with run-state (anchor timestamp + accumulated ms) that places the
// active interval already past zero, so the settling effect runs on mount.
// ---------------------------------------------------------------------------

// Hoisted so the mock factory can wire these in and the tests can assert on them.
const { playTimerSound, showTimerNotification } = vi.hoisted(() => ({
  playTimerSound: vi.fn(),
  showTimerNotification: vi.fn(),
}));

vi.mock("@/lib/timerAlert", () => ({
  playTimerSound,
  showTimerNotification,
  DEFAULT_TIMER_ALERT_SOUND: "chime",
}));

// The tile persists run-state through useUpdateTile; we don't care about the
// network here, only that the alert effects run. Capture mutate so saves don't
// throw.
const updateMutate = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useUpdateTile: () => ({ mutate: updateMutate }),
  getGetTilesQueryKey: () => ["/api/tiles"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: vi.fn() }),
}));

import TimerTile from "./TimerTile";

// A fixed "now" so run-state timestamps are deterministic. Fake timers also
// keep the tile's 250ms display interval from firing extra re-renders.
const NOW = new Date("2026-01-01T00:00:00Z").getTime();

function makeTile(settings: TileSettings): Tile {
  return {
    id: 1,
    userId: 1,
    type: "integration",
    integration: "timer",
    name: "",
    gridX: 0,
    gridY: 0,
    gridW: 4,
    gridH: 4,
    tileSettings: settings,
  } as Tile;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("TimerTile alerts", () => {
  it("fires the countdown-finished alert once when enabled", () => {
    render(
      <TimerTile
        editMode={false}
        tile={makeTile({
          timerMode: "countdown",
          timerDuration: 60,
          timerAlertEnabled: true,
          timerAlertSound: "bell",
          timerRunning: true,
          // Started 61s ago for a 60s countdown: already past zero.
          timerStartedAt: NOW - 61_000,
          timerAccumulatedMs: 0,
        })}
      />,
    );

    expect(playTimerSound).toHaveBeenCalledTimes(1);
    expect(playTimerSound).toHaveBeenCalledWith("bell");
    expect(showTimerNotification).toHaveBeenCalledTimes(1);
    expect(showTimerNotification).toHaveBeenCalledWith(
      "Timer",
      "Your countdown has finished.",
    );
  });

  it("does not alert on countdown finish when the toggle is off", () => {
    render(
      <TimerTile
        editMode={false}
        tile={makeTile({
          timerMode: "countdown",
          timerDuration: 60,
          timerAlertEnabled: false,
          timerRunning: true,
          timerStartedAt: NOW - 61_000,
          timerAccumulatedMs: 0,
        })}
      />,
    );

    expect(playTimerSound).not.toHaveBeenCalled();
    expect(showTimerNotification).not.toHaveBeenCalled();
  });

  it("fires a single alert naming the new phase when a pomodoro phase advances", () => {
    render(
      <TimerTile
        editMode={false}
        tile={makeTile({
          timerMode: "pomodoro",
          pomodoroFocusMinutes: 1,
          pomodoroShortBreakMinutes: 1,
          pomodoroSessionsBeforeLongBreak: 4,
          timerAlertEnabled: true,
          timerAlertSound: "chime",
          timerRunning: true,
          // 61s into a 1-minute focus phase: the focus interval just ended, so
          // the next phase is a short break.
          timerStartedAt: NOW - 61_000,
          timerAccumulatedMs: 0,
          pomodoroPhase: "focus",
          pomodoroCompletedSessions: 0,
        })}
      />,
    );

    expect(playTimerSound).toHaveBeenCalledTimes(1);
    expect(playTimerSound).toHaveBeenCalledWith("chime");
    expect(showTimerNotification).toHaveBeenCalledTimes(1);
    expect(showTimerNotification).toHaveBeenCalledWith(
      "Pomodoro",
      "Time for a short break.",
    );
  });

  it("fires only one alert when a resumed pomodoro has elapsed past several phases", () => {
    render(
      <TimerTile
        editMode={false}
        tile={makeTile({
          timerMode: "pomodoro",
          pomodoroFocusMinutes: 1,
          pomodoroShortBreakMinutes: 1,
          pomodoroSessionsBeforeLongBreak: 4,
          timerAlertEnabled: true,
          timerAlertSound: "chime",
          timerRunning: true,
          // 2.5 minutes elapsed from the start of a focus phase spans the
          // focus interval and the following short break, landing back in
          // focus — but only the destination phase should alert, just once.
          timerStartedAt: NOW - 150_000,
          timerAccumulatedMs: 0,
          pomodoroPhase: "focus",
          pomodoroCompletedSessions: 0,
        })}
      />,
    );

    expect(playTimerSound).toHaveBeenCalledTimes(1);
    expect(showTimerNotification).toHaveBeenCalledTimes(1);
    expect(showTimerNotification).toHaveBeenCalledWith(
      "Pomodoro",
      "Break's over — back to focus.",
    );
  });

  it("does not alert when a pomodoro advances but the toggle is off", () => {
    render(
      <TimerTile
        editMode={false}
        tile={makeTile({
          timerMode: "pomodoro",
          pomodoroFocusMinutes: 1,
          pomodoroShortBreakMinutes: 1,
          pomodoroSessionsBeforeLongBreak: 4,
          timerAlertEnabled: false,
          timerRunning: true,
          timerStartedAt: NOW - 61_000,
          timerAccumulatedMs: 0,
          pomodoroPhase: "focus",
          pomodoroCompletedSessions: 0,
        })}
      />,
    );

    expect(playTimerSound).not.toHaveBeenCalled();
    expect(showTimerNotification).not.toHaveBeenCalled();
  });
});
