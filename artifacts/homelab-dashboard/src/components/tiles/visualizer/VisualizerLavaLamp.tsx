import { useEffect, useRef } from "react";
import type { VisualizerSample } from "@/lib/useVisualizer";
import { hexToRgb } from "@/lib/useVisualizer";

interface Props {
  sample: (binCount: number) => VisualizerSample;
  primary: string;
  background: string;
  width: number;
  height: number;
}

interface Blob {
  x: number;
  phase: number;
  speed: number;
  radius: number;
  wobble: number;
}

// A lava-lamp field of soft, glowing blobs. Blobs drift slowly upward and back
// down, using additive ("lighter") compositing so overlapping blobs merge into
// gooey shapes. Overall energy (bass/level) inflates the blobs and speeds their
// drift, so the lamp bubbles harder to a beat and idles gently otherwise.
export default function VisualizerLavaLamp({ sample, primary, background, width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const blobsRef = useRef<Blob[]>([]);
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

    const count = Math.max(4, Math.min(9, Math.floor((width * height) / 9000)));
    blobsRef.current = Array.from({ length: count }, (_, i) => ({
      x: ((i + 0.5) / count) * width + (Math.random() - 0.5) * width * 0.15,
      phase: Math.random() * Math.PI * 2,
      speed: 0.12 + Math.random() * 0.18,
      radius: Math.min(width, height) * (0.16 + Math.random() * 0.14),
      wobble: 0.6 + Math.random() * 0.9,
    }));

    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { primary: pc, background: bg } = paletteRef.current;
      const [r, g, b] = hexToRgb(pc);
      const { level, bass } = sampleRef.current(16);
      const energy = Math.max(level, bass);

      // Background with a subtle vertical darkening for depth.
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      const [br, bgc, bb] = hexToRgb(bg, [15, 15, 26]);
      bgGrad.addColorStop(0, `rgb(${Math.round(br * 1.15)}, ${Math.round(bgc * 1.15)}, ${Math.round(bb * 1.2)})`);
      bgGrad.addColorStop(1, `rgb(${br}, ${bgc}, ${bb})`);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = "lighter";
      for (const blob of blobsRef.current) {
        blob.phase += dt * blob.speed * (0.6 + energy * 1.8) * blob.wobble;
        const y = height * 0.5 + Math.sin(blob.phase) * height * 0.42;
        const x = blob.x + Math.cos(blob.phase * 0.6) * width * 0.05;
        const rad = blob.radius * (0.85 + energy * 0.5 + 0.1 * Math.sin(blob.phase * 1.7));

        const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.9)`);
        grad.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, 0.35)`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return <canvas ref={canvasRef} style={{ width, height, display: "block" }} />;
}
