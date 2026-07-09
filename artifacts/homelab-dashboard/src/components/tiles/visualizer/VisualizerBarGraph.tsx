import { useEffect, useRef } from "react";
import type { VisualizerSample } from "@/lib/useVisualizer";
import { rgbTriplet } from "@/lib/useVisualizer";

interface Props {
  sample: (binCount: number) => VisualizerSample;
  primary: string;
  background: string;
  width: number;
  height: number;
}

// A sharp vertical-bar spectrum. Each bar is filled with a gradient from the
// primary color at the top fading toward transparent near the base, drawn on the
// background color — the monochrome music-video look. Bars use a light peak-hold
// so tops fall back smoothly rather than flickering.
export default function VisualizerBarGraph({ sample, primary, background, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<Float32Array>(new Float32Array(0));
  // Latest colors kept in a ref so the (single, long-lived) rAF loop always
  // paints with the current palette without being torn down on every edit.
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

    const barCount = Math.max(12, Math.min(64, Math.floor(width / 9)));
    if (peaksRef.current.length !== barCount) peaksRef.current = new Float32Array(barCount);

    let raf = 0;
    const draw = () => {
      const { primary: pc, background: bg } = paletteRef.current;
      const trip = rgbTriplet(pc);
      const { bins } = sampleRef.current(barCount);
      const peaks = peaksRef.current;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const gap = Math.max(1, width / barCount * 0.22);
      const barW = (width - gap * (barCount - 1)) / barCount;
      const baseY = height;
      const maxH = height * 0.94;

      ctx.shadowColor = `rgba(${trip}, 0.55)`;

      for (let i = 0; i < barCount; i++) {
        const v = bins[i] ?? 0;
        // Peak-hold: rise instantly, fall back slowly.
        peaks[i] = v > peaks[i] ? v : peaks[i] * 0.9 + v * 0.1;
        const h = Math.max(2, peaks[i] * maxH);
        const x = i * (barW + gap);
        const y = baseY - h;

        const grad = ctx.createLinearGradient(0, y, 0, baseY);
        grad.addColorStop(0, `rgba(${trip}, 1)`);
        grad.addColorStop(0.6, `rgba(${trip}, 0.75)`);
        grad.addColorStop(1, `rgba(${trip}, 0.05)`);
        ctx.fillStyle = grad;
        ctx.shadowBlur = Math.min(18, h * 0.25);
        ctx.fillRect(x, y, barW, h);

        // Bright cap line at the top of each bar for a crisp edge.
        ctx.shadowBlur = 0;
        ctx.fillStyle = `rgba(${trip}, 1)`;
        ctx.fillRect(x, y, barW, Math.max(1.5, height * 0.006));
      }
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return <canvas ref={canvasRef} style={{ width, height, display: "block" }} />;
}
