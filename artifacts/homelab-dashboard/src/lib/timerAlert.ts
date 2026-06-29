// Helpers for alerting the user when a Timer tile finishes a countdown or
// advances a pomodoro phase: a short synthesized sound (Web Audio, no asset
// file) plus an optional browser notification. Both are best-effort — they
// swallow errors so a failed alert never breaks the tile.

// The alert sounds the user can pick from in the tile editor. "none" means the
// browser notification fires but no sound plays.
export type TimerAlertSound = "chime" | "bell" | "beep" | "digital" | "none";

export const DEFAULT_TIMER_ALERT_SOUND: TimerAlertSound = "chime";

// User-facing options for the editor's sound picker (label + value).
export const TIMER_ALERT_SOUND_OPTIONS: ReadonlyArray<{
  value: TimerAlertSound;
  label: string;
}> = [
  { value: "chime", label: "Chime" },
  { value: "bell", label: "Bell" },
  { value: "beep", label: "Beep" },
  { value: "digital", label: "Digital" },
  { value: "none", label: "None (notification only)" },
];

// A single tone in a synthesized sound: when it starts (relative to the sound),
// how long it lasts, its pitch, oscillator shape, and peak loudness.
interface AlertNote {
  freq: number;
  start: number;
  duration: number;
  type: OscillatorType;
  peak: number;
}

// Note recipes for each playable sound. "none" has no notes (silent).
const SOUND_NOTES: Record<Exclude<TimerAlertSound, "none">, AlertNote[]> = {
  // Two gentle sine beeps a major third apart — the original, calm default.
  chime: [
    { freq: 880, start: 0, duration: 0.18, type: "sine", peak: 0.25 },
    { freq: 1108.73, start: 0.22, duration: 0.28, type: "sine", peak: 0.25 },
  ],
  // A single struck-bell tone: fundamental plus two quieter harmonics with a
  // long decay so it rings out.
  bell: [
    { freq: 660, start: 0, duration: 1.2, type: "sine", peak: 0.3 },
    { freq: 990, start: 0, duration: 0.9, type: "sine", peak: 0.12 },
    { freq: 1320, start: 0, duration: 0.6, type: "sine", peak: 0.08 },
  ],
  // Three short, even square-wave pulses — a classic alarm beep.
  beep: [
    { freq: 1000, start: 0, duration: 0.12, type: "square", peak: 0.18 },
    { freq: 1000, start: 0.2, duration: 0.12, type: "square", peak: 0.18 },
    { freq: 1000, start: 0.4, duration: 0.12, type: "square", peak: 0.18 },
  ],
  // A quick rising triangle-wave arpeggio for an upbeat, electronic feel.
  digital: [
    { freq: 784, start: 0, duration: 0.1, type: "triangle", peak: 0.2 },
    { freq: 988, start: 0.1, duration: 0.1, type: "triangle", peak: 0.2 },
    { freq: 1319, start: 0.2, duration: 0.2, type: "triangle", peak: 0.22 },
  ],
};

// The AudioContext is created lazily and reused. Browsers may keep the context
// suspended until a user gesture; we try to resume it, but if the timer expired
// without one the sound may be silently skipped (the notification still fires).
let sharedContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (sharedContext == null) {
    sharedContext = new Ctor();
  }
  return sharedContext;
}

// Play the chosen alert sound using the Web Audio API. "none" (or an unknown
// value) plays nothing. Best-effort: any audio failure is swallowed.
export function playTimerSound(
  sound: TimerAlertSound = DEFAULT_TIMER_ALERT_SOUND,
): void {
  try {
    if (sound === "none") return;
    const notes = SOUND_NOTES[sound] ?? SOUND_NOTES.chime;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    const now = ctx.currentTime;
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type;
      osc.frequency.value = note.freq;
      const startAt = now + note.start;
      const endAt = startAt + note.duration;
      // Quick attack then exponential decay so it reads as a hit, not a tone.
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(note.peak, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(endAt + 0.02);
    }
  } catch {
    // Best-effort: ignore audio failures.
  }
}

// Fire a browser notification if the user has granted permission. Does nothing
// when notifications are unsupported or not yet/never permitted.
export function showTimerNotification(title: string, body: string): void {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    new Notification(title, { body });
  } catch {
    // Best-effort: ignore notification failures.
  }
}
