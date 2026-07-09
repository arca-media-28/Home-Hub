import { useCallback, useRef } from "react";

// Live frequency data for the Audio Visualizer tiles. The hook is fed the shared
// AnalyserNode (from the app-level audio player) and the current isPlaying flag,
// and hands back a `sample(binCount)` function each renderer calls inside its own
// requestAnimationFrame draw loop. When audio is actually playing it reads real
// frequency data via getByteFrequencyData; otherwise it synthesizes a slow,
// low-amplitude drifting signal so the tile still shows a calm idle animation
// instead of a dead flat line.

export interface VisualizerSample {
  // Normalized magnitudes in 0..1, length === the requested binCount.
  bins: Float32Array;
  // Overall loudness, 0..1.
  level: number;
  // Low-frequency (bass) energy, 0..1 — drives beat-reactive effects.
  bass: number;
  // True when the data is the synthetic idle signal (paused / no live data).
  idle: boolean;
}

// Parse a #rgb / #rrggbb string into [r,g,b]. Falls back to the given default on
// any malformed input so a bad saved color can never crash a renderer.
export function hexToRgb(hex: string, fallback: [number, number, number] = [124, 58, 237]): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Build an "r,g,b" fragment for use in `rgba(<frag>, a)` templates.
export function rgbTriplet(hex: string, fallback?: [number, number, number]): string {
  const [r, g, b] = hexToRgb(hex, fallback);
  return `${r}, ${g}, ${b}`;
}

export function useVisualizer(analyser: AnalyserNode | null, isPlaying: boolean) {
  // Reused buffers so the per-frame sampler never allocates.
  const rawRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const outRef = useRef<Float32Array>(new Float32Array(0));
  const startRef = useRef<number>(
    typeof performance !== "undefined" ? performance.now() : 0,
  );

  const sample = useCallback(
    (binCount: number): VisualizerSample => {
      const n = Math.max(1, Math.floor(binCount));
      if (outRef.current.length !== n) outRef.current = new Float32Array(n);
      const out = outRef.current;

      if (analyser && isPlaying) {
        const len = analyser.frequencyBinCount;
        if (!rawRef.current || rawRef.current.length !== len) {
          rawRef.current = new Uint8Array(new ArrayBuffer(len));
        }
        const raw = rawRef.current;
        analyser.getByteFrequencyData(raw);

        let sum = 0;
        for (let i = 0; i < len; i++) sum += raw[i];
        // Real, non-silent data. (A cross-origin stream without CORS routes as
        // silence — sum stays 0 — so we fall through to the idle animation.)
        if (sum > 0) {
          // The upper ~30% of bins carry almost no musical energy; concentrate
          // the visible range on the lower band so bars/needles stay lively.
          const usable = Math.max(1, Math.floor(len * 0.7));
          for (let i = 0; i < n; i++) {
            const start = Math.floor((i / n) * usable);
            const end = Math.max(start + 1, Math.floor(((i + 1) / n) * usable));
            let acc = 0;
            for (let j = start; j < end; j++) acc += raw[j];
            out[i] = Math.min(1, acc / (end - start) / 255);
          }
          const bassBins = Math.max(1, Math.floor(len * 0.12));
          let bass = 0;
          for (let i = 0; i < bassBins; i++) bass += raw[i];
          bass = Math.min(1, (bass / bassBins / 255) * 1.4);
          const level = Math.min(1, (sum / len / 255) * 2.4);
          return { bins: out, level, bass, idle: false };
        }
      }

      // Idle: gentle multi-sine drift, kept low-amplitude and slightly domed so
      // the center is a touch taller than the edges.
      const t = ((typeof performance !== "undefined" ? performance.now() : 0) - startRef.current) / 1000;
      for (let i = 0; i < n; i++) {
        const p = n > 1 ? i / (n - 1) : 0.5;
        const dome = 0.12 * (0.5 - Math.abs(p - 0.5));
        const v =
          0.1 +
          0.06 * Math.sin(t * 0.9 + p * Math.PI * 2) +
          0.05 * Math.sin(t * 1.7 + p * Math.PI * 4 + 1.3) +
          0.03 * Math.sin(t * 2.6 + p * Math.PI * 6);
        out[i] = Math.max(0.02, Math.min(0.4, v + dome));
      }
      const level = 0.14 + 0.06 * (Math.sin(t * 1.1) * 0.5 + 0.5);
      const bass = 0.12 + 0.08 * (Math.sin(t * 0.7) * 0.5 + 0.5);
      return { bins: out, level, bass, idle: true };
    },
    [analyser, isPlaying],
  );

  return sample;
}
