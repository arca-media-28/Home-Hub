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
  // Canvas-safe album art for the disc face; null = generic disc design.
  art: HTMLImageElement | null;
  isPlaying: boolean;
}

// A top-down open CD player: a rounded deck with a circular tray recess, a
// spinning disc whose face is the current album cover (with the classic clear
// inner ring, center hole, and a rotating iridescent sheen), and a row of
// level-reactive LEDs on the deck. Disc spins while music plays, coasts to a
// stop otherwise.
export default function VisualizerCdPlayer({ sample, primary, background, width, height, art, isPlaying }: Props) {
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

    // CDs spin fast; a stylized ~120rpm keeps the motion readable, not a blur.
    const PLAY_SPEED = (120 / 60) * Math.PI * 2 * 0.5;

    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { primary: pc, background: bg } = paletteRef.current;
      const trip = rgbTriplet(pc);
      const [br, bgc, bb] = hexToRgb(bg, [15, 15, 26]);
      const { bins, level, idle } = sampleRef.current(8);

      const target = playingRef.current ? PLAY_SPEED : 0;
      speedRef.current += (target - speedRef.current) * Math.min(1, dt * 2.5);
      angleRef.current += speedRef.current * dt;
      const angle = angleRef.current;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const R = Math.min(width, height) * 0.36; // disc radius
      const deckPad = R * 0.28;

      // Deck (player body): a rounded plate slightly lighter than the background.
      const deckW = Math.min(width - 8, R * 2 + deckPad * 2.6);
      const deckH = Math.min(height - 8, R * 2 + deckPad * 1.6);
      const dx = cx - deckW / 2;
      const dy = cy - deckH / 2;
      const lift = (c: number, f: number) => Math.min(255, Math.round(c * f + 14));
      ctx.fillStyle = `rgb(${lift(br, 1.25)}, ${lift(bgc, 1.25)}, ${lift(bb, 1.3)})`;
      ctx.beginPath();
      ctx.roundRect(dx, dy, deckW, deckH, Math.min(18, R * 0.25));
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${trip}, 0.25)`;
      ctx.stroke();

      // Tray recess under the disc.
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
      ctx.fill();

      // Disc face: album art or a generic tinted disc.
      const img = artRef.current;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      if (img) {
        drawImageInCircle(ctx, img, 0, 0, R);
      } else {
        const [pr, pg, pb] = hexToRgb(pc);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
        g.addColorStop(0, "#d8d8e0");
        g.addColorStop(0.55, `rgb(${Math.round(pr * 0.6 + 90)}, ${Math.round(pg * 0.6 + 90)}, ${Math.round(pb * 0.6 + 90)})`);
        g.addColorStop(1, "#b8b8c4");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Iridescent sheen: rotating rainbow-ish wedges, intensity rides the level.
      const sheen = idle ? 0.10 : 0.10 + Math.min(0.35, level * 0.5);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      const wedges = 6;
      for (let i = 0; i < wedges; i++) {
        const a0 = angle * 0.7 + (i / wedges) * Math.PI * 2;
        const hue = (i * 60 + now * 0.01) % 360;
        const grad = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R);
        grad.addColorStop(0, `hsla(${hue}, 80%, 70%, 0)`);
        grad.addColorStop(1, `hsla(${hue}, 80%, 70%, ${sheen})`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a0 + (Math.PI * 2) / wedges / 1.6);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Clear inner ring + hub + center hole (the CD signature).
      const innerR = R * 0.32;
      ctx.fillStyle = `rgba(${lift(br, 1.1)}, ${lift(bgc, 1.1)}, ${lift(bb, 1.15)}, 1)`;
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1, R * 0.02);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Disc edge highlight.
      ctx.lineWidth = Math.max(1, R * 0.015);
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      // Deck LEDs: a short level-reactive row on the bottom edge of the deck,
      // plus a power dot that pulses with the beat.
      const ledCount = 6;
      const ledW = Math.max(4, deckW * 0.035);
      const ledH = Math.max(2.5, deckH * 0.02);
      const rowW = ledCount * ledW + (ledCount - 1) * ledW * 0.5;
      const rowX = cx - rowW / 2;
      const rowY = dy + deckH - Math.max(8, deckH * 0.07);
      const lit = idle ? 1 : Math.round(Math.min(1, level * 1.4) * ledCount);
      for (let i = 0; i < ledCount; i++) {
        const on = i < lit;
        const v = bins[Math.min(bins.length - 1, i)] ?? 0;
        ctx.fillStyle = on
          ? `rgba(${trip}, ${0.5 + Math.min(0.5, v)})`
          : `rgba(${trip}, 0.12)`;
        ctx.fillRect(rowX + i * ledW * 1.5, rowY, ledW, ledH);
      }
      // Power dot (top-left of deck) — steady green-ish when playing.
      const powerOn = playingRef.current || speedRef.current > 0.05;
      ctx.fillStyle = powerOn ? `rgba(${trip}, 0.95)` : `rgba(${trip}, 0.25)`;
      ctx.beginPath();
      ctx.arc(dx + Math.max(10, deckW * 0.05), dy + Math.max(10, deckH * 0.08), Math.max(2, R * 0.035), 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return <canvas ref={canvasRef} style={{ width, height, display: "block" }} />;
}
