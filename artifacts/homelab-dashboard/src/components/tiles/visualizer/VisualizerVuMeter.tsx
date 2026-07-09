import { useEffect, useRef } from "react";
import type { VisualizerSample } from "@/lib/useVisualizer";
import { hexToRgb, rgbTriplet } from "@/lib/useVisualizer";

interface Props {
  sample: (binCount: number) => VisualizerSample;
  primary: string;
  background: string;
  width: number;
  height: number;
}

// A retro pair of analog VU meters — a left and a right dial, each with a swept
// arc scale, a spring-loaded needle (fast attack, slow release, the classic
// ballistic feel), and a row of LED segments underneath that light up to the
// current level. Left channel = low band, right channel = high band.
export default function VisualizerVuMeter({ sample, primary, background, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const needlesRef = useRef<[number, number]>([0, 0]);
  const paletteRef = useRef({ primary, background });
  paletteRef.current = { primary, background };
  const sampleRef = useRef(sample);
  sampleRef.current = sample;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);

    const drawDial = (
      cx: number,
      cyArea: number,
      dialW: number,
      dialH: number,
      value: number,
      label: string,
      trip: string,
      rgb: [number, number, number],
    ) => {
      const pivotY = cyArea + dialH * 0.86;
      const radius = Math.min(dialW * 0.42, dialH * 0.72);
      const minA = -Math.PI * 0.72;
      const maxA = -Math.PI * 0.28;

      // Arc scale.
      ctx.lineWidth = Math.max(1.5, radius * 0.03);
      ctx.strokeStyle = `rgba(${trip}, 0.4)`;
      ctx.beginPath();
      ctx.arc(cx, pivotY, radius, minA, maxA);
      ctx.stroke();

      // Tick marks; the last third turns "hot" (full primary) like a real VU red zone.
      const ticks = 11;
      for (let i = 0; i < ticks; i++) {
        const f = i / (ticks - 1);
        const a = minA + (maxA - minA) * f;
        const inner = radius * (f > 0.66 ? 0.82 : 0.88);
        const x1 = cx + Math.cos(a) * inner;
        const y1 = pivotY + Math.sin(a) * inner;
        const x2 = cx + Math.cos(a) * radius;
        const y2 = pivotY + Math.sin(a) * radius;
        ctx.lineWidth = f > 0.66 ? Math.max(1.5, radius * 0.03) : Math.max(1, radius * 0.018);
        ctx.strokeStyle = f > 0.66 ? `rgba(${trip}, 0.95)` : `rgba(${trip}, 0.55)`;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Needle.
      const a = minA + (maxA - minA) * Math.max(0, Math.min(1, value));
      const nx = cx + Math.cos(a) * radius * 0.98;
      const ny = pivotY + Math.sin(a) * radius * 0.98;
      ctx.shadowColor = `rgba(${trip}, 0.8)`;
      ctx.shadowBlur = radius * 0.12;
      ctx.strokeStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      ctx.lineWidth = Math.max(1.5, radius * 0.035);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx, pivotY);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Pivot hub.
      ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      ctx.beginPath();
      ctx.arc(cx, pivotY, Math.max(2, radius * 0.05), 0, Math.PI * 2);
      ctx.fill();

      // LED segment row beneath the dial.
      const segCount = 12;
      const segGap = dialW * 0.02;
      const rowW = dialW * 0.8;
      const segW = (rowW - segGap * (segCount - 1)) / segCount;
      const segH = Math.max(3, dialH * 0.08);
      const rowX = cx - rowW / 2;
      const rowY = pivotY + radius * 0.16;
      const lit = Math.round(value * segCount);
      for (let i = 0; i < segCount; i++) {
        const on = i < lit;
        ctx.fillStyle = on ? `rgba(${trip}, ${i > segCount * 0.75 ? 1 : 0.85})` : `rgba(${trip}, 0.12)`;
        ctx.fillRect(rowX + i * (segW + segGap), rowY, segW, segH);
      }

      // Channel label.
      ctx.fillStyle = `rgba(${trip}, 0.75)`;
      ctx.font = `600 ${Math.max(9, Math.round(radius * 0.18))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx, rowY + segH + Math.max(8, radius * 0.16));
    };

    let raf = 0;
    const draw = () => {
      const { primary: pc, background: bg } = paletteRef.current;
      const trip = rgbTriplet(pc);
      const rgb = hexToRgb(pc);
      const { bins } = sampleRef.current(16);

      // Left = low band average, right = high band average.
      let lo = 0;
      let hi = 0;
      const half = bins.length / 2;
      for (let i = 0; i < bins.length; i++) (i < half ? (lo += bins[i]) : (hi += bins[i]));
      const targetL = Math.min(1, (lo / half) * 1.1);
      const targetR = Math.min(1, (hi / half) * 1.3);

      // Ballistic smoothing: quick attack, slow release.
      const [pl, pr] = needlesRef.current;
      const smooth = (prev: number, tgt: number) =>
        tgt > prev ? prev + (tgt - prev) * 0.4 : prev + (tgt - prev) * 0.08;
      needlesRef.current = [smooth(pl, targetL), smooth(pr, targetR)];

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      drawDial(width * 0.25, 0, width * 0.5, height, needlesRef.current[0], "L", trip, rgb);
      drawDial(width * 0.75, 0, width * 0.5, height, needlesRef.current[1], "R", trip, rgb);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return <canvas ref={canvasRef} style={{ width, height, display: "block" }} />;
}
