// Helpers for alerting the user when a countdown Timer tile reaches zero: a
// short synthesized chime (Web Audio, no asset file) plus an optional browser
// notification. Both are best-effort — they swallow errors so a failed alert
// never breaks the tile.

// Play a short two-note chime using the Web Audio API. The AudioContext is
// created lazily and reused. Browsers may keep the context suspended until a
// user gesture; we try to resume it, but if the timer expired without one the
// chime may be silently skipped (the notification still fires).
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

export function playTimerChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    const now = ctx.currentTime;
    // Two gentle beeps a major third apart.
    const notes: Array<{ freq: number; start: number; duration: number }> = [
      { freq: 880, start: 0, duration: 0.18 },
      { freq: 1108.73, start: 0.22, duration: 0.28 },
    ];
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = note.freq;
      const startAt = now + note.start;
      const endAt = startAt + note.duration;
      // Quick attack then exponential decay so it reads as a chime, not a tone.
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.02);
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
