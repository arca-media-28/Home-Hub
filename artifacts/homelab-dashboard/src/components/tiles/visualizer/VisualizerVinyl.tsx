import { useEffect, useRef } from "react";
import type { VisualizerSample } from "@/lib/useVisualizer";
import { hexToRgb, rgbTriplet } from "@/lib/useVisualizer";
import { drawImageInCircle } from "./albumArt";

interface Props {
  sample: (binCount: number) => VisualizerSample;
  primary: string;
  background: string;
  width: number;
  height: number;
  // Canvas-safe album art for the record label; null = generic label design.
  art: HTMLImageElement | null;
  isPlaying: boolean;
}

// A top-down spinning vinyl record. The record spins at ~33rpm while music
// plays (and coasts to a stop otherwise), the current album cover fills the
// center label, a tonearm rests over the grooves, and bass energy drives a
// platter glow plus a subtle groove shimmer so it feels alive with the music.
export default function VisualizerVinyl({ sample, primary, background, width, height, art, isPlaying }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const angleRef = useRef(0);
  const speedRef = useRef(0);
  const paletteRef = useRef({ primary, background });
  paletteRef.current = { primary, background };
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  const artRef = useRef(art);
  artRef.current = art;
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);

    // ~33⅓ rpm in radians/second.
    const PLAY_SPEED = (33.33 / 60) * Math.PI * 2;

    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { primary: pc, background: bg } = paletteRef.current;
      const trip = rgbTriplet(pc);
      const [pr, pg, pb] = hexToRgb(pc);
      const { level, bass, idle } = sampleRef.current(16);

      // Spin up / coast down smoothly instead of snapping. When idle the
      // record keeps a barely-perceptible drift so the tile never looks frozen.
      const IDLE_DRIFT = 0.06;
      const target = playingRef.current ? PLAY_SPEED : IDLE_DRIFT;
      speedRef.current += (target - speedRef.current) * Math.min(1, dt * 2.2);
      angleRef.current += speedRef.current * dt;
      const angle = angleRef.current;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const R = Math.min(width, height) * 0.44; // record radius
      const labelR = R * 0.36;
      const holeR = Math.max(2, R * 0.035);

      // Platter glow driven by bass — the audio-reactive halo under the record.
      // Gentle breathing pulse when idle (bass drifts sinusoidally in idle).
      const glow = idle ? bass * 0.9 : Math.min(1, bass * 1.2);
      const halo = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.22);
      halo.addColorStop(0, `rgba(${trip}, ${0.05 + glow * 0.3})`);
      halo.addColorStop(1, `rgba(${trip}, 0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.25, 0, Math.PI * 2);
      ctx.fill();

      // Record body.
      const vinyl = ctx.createRadialGradient(cx, cy, labelR, cx, cy, R);
      vinyl.addColorStop(0, "#181818");
      vinyl.addColorStop(0.85, "#0c0c0c");
      vinyl.addColorStop(1, "#1c1c1c");
      ctx.fillStyle = vinyl;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, R * 0.012);
      ctx.strokeStyle = `rgba(${trip}, 0.35)`;
      ctx.stroke();

      // Grooves — concentric rings; a couple shimmer with the level.
      const grooves = 14;
      for (let i = 0; i < grooves; i++) {
        const f = i / (grooves - 1);
        const gr = labelR * 1.12 + (R * 0.94 - labelR * 1.12) * f;
        const shimmer = !idle && (i + Math.floor(now / 120)) % 5 === 0 ? level * 0.25 : 0;
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.045 + shimmer})`;
        ctx.beginPath();
        ctx.arc(cx, cy, gr, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Rotating light sheen across the grooves so the spin reads even from
      // directly above (two soft radial wedges opposite each other).
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle * 0.5);
      for (const off of [0, Math.PI]) {
        const grad = ctx.createLinearGradient(-R, 0, R, 0);
        grad.addColorStop(0.35, "rgba(255,255,255,0)");
        grad.addColorStop(0.5, "rgba(255,255,255,0.06)");
        grad.addColorStop(0.65, "rgba(255,255,255,0)");
        ctx.save();
        ctx.rotate(off + 0.6);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.96, -0.5, 0.5);
        ctx.arc(0, 0, labelR * 1.1, 0.5, -0.5, true);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();

      // Label: album art (rotating with the record) or a generic two-tone label.
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      const img = artRef.current;
      if (img) {
        drawImageInCircle(ctx, img, 0, 0, labelR);
      } else {
        const lg = ctx.createRadialGradient(0, 0, 0, 0, 0, labelR);
        lg.addColorStop(0, `rgb(${Math.min(255, pr + 40)}, ${Math.min(255, pg + 40)}, ${Math.min(255, pb + 40)})`);
        lg.addColorStop(1, `rgb(${Math.round(pr * 0.55)}, ${Math.round(pg * 0.55)}, ${Math.round(pb * 0.55)})`);
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.arc(0, 0, labelR, 0, Math.PI * 2);
        ctx.fill();
        // Generic label detail: a ring and a bar, like a pressing stamp.
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = Math.max(1, labelR * 0.05);
        ctx.beginPath();
        ctx.arc(0, 0, labelR * 0.62, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.fillRect(-labelR * 0.4, -labelR * 0.06, labelR * 0.8, labelR * 0.12);
      }
      ctx.restore();
      // Label rim + spindle hole (drawn unrotated — they're centered anyway).
      ctx.lineWidth = Math.max(1, R * 0.01);
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath();
      ctx.arc(cx, cy, labelR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(cx, cy, holeR, 0, Math.PI * 2);
      ctx.fill();

      // Tonearm: pivot near the top-right corner, arm reaching onto the grooves.
      // While playing it sits mid-groove and quivers slightly with the level.
      const px = cx + R * 1.02;
      const py = cy - R * 0.98;
      const restA = Math.PI * 0.62;
      const playA = Math.PI * 0.74 + (idle ? 0 : level * 0.02);
      const armA = playingRef.current || speedRef.current > 0.05 ? playA : restA;
      const armLen = R * 1.18;
      const hx = px + Math.cos(armA) * armLen;
      const hy = py + Math.sin(armA) * armLen;
      ctx.strokeStyle = "rgba(210, 210, 220, 0.9)";
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(2, R * 0.035);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      // Headshell.
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(armA + Math.PI / 2);
      ctx.fillStyle = `rgba(${trip}, 0.9)`;
      ctx.fillRect(-R * 0.035, -R * 0.02, R * 0.07, R * 0.11);
      ctx.restore();
      // Pivot base.
      ctx.fillStyle = "rgba(160, 160, 170, 0.95)";
      ctx.beginPath();
      ctx.arc(px, py, Math.max(3, R * 0.07), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${trip}, ${0.35 + glow * 0.5})`;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.5, R * 0.03), 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return <canvas ref={canvasRef} style={{ width, height, display: "block" }} />;
}
