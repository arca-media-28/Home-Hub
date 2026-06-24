---
name: Timer tile pomodoro mode
description: How the Timer tile's pomodoro mode tracks phase/cycle state and persists it
---
# Timer tile pomodoro mode

Pomodoro is a third `timerMode` (alongside countup/countdown) on the single Timer tile, not a separate tile.

- Config keys: `pomodoroFocusMinutes` (25), `pomodoroShortBreakMinutes` (5), `pomodoroLongBreakMinutes` (15), `pomodoroSessionsBeforeLongBreak` (4). Run-state keys: `pomodoroPhase` ("focus"|"shortBreak"|"longBreak"), `pomodoroCompletedSessions`.
- Reuses the countdown anchor approach (timerRunning/timerStartedAt/timerAccumulatedMs) per-phase: remaining = phaseDuration(phase) - elapsed.
- Phase machine: focus completion increments completedSessions; >= sessionsBeforeLong → longBreak else shortBreak; any break → focus; longBreak also resets completedSessions to 0.
- Auto-advance effect carries OVERFLOW past the phase boundary into the new phase (startedAt = now - overflow) and walks through every fully-elapsed phase in one pass (for-loop), so transitions stay accurate even if the page was hidden across multiple intervals — no mutation storm.
- **Why:** task required accuracy across refresh/navigation using the same anchor-timestamp approach as the other modes.
- applyRun now always persists pomodoroPhase + pomodoroCompletedSessions (harmless for countup/countdown). Editing config in the modal resets the cycle to focus/0, like the existing run-state reset.
- Whitelist: new keys MUST be added to pickTileSettings() in api-server routes/tiles.ts or saves silently drop them (see tile-settings-whitelist memory).
