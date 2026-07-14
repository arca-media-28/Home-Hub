import { useEffect, useRef, useState } from "react";
import type { Tile } from "@workspace/api-client-react";
import { useAudioPlayer } from "@/lib/audioPlayer";
import { useVisualizer } from "@/lib/useVisualizer";
import {
  useVisualizerThemeDefaults,
  FALLBACK_VISUALIZER_PRIMARY,
  FALLBACK_VISUALIZER_BACKGROUND,
} from "@/lib/themeColors";
import VisualizerBarGraph from "./visualizer/VisualizerBarGraph";
import VisualizerLavaLamp from "./visualizer/VisualizerLavaLamp";
import VisualizerVuMeter from "./visualizer/VisualizerVuMeter";

// ── Shared style/color contract (imported by the tile editor too) ─────────────
export type VisualizerStyle = "bars" | "lava" | "vu";
export const DEFAULT_VISUALIZER_STYLE: VisualizerStyle = "bars";
// Last-resort hex fallbacks; the real defaults are theme-derived at runtime
// (see lib/themeColors.ts) so an unconfigured visualizer follows the theme.
export const DEFAULT_VISUALIZER_PRIMARY = FALLBACK_VISUALIZER_PRIMARY;
export const DEFAULT_VISUALIZER_BACKGROUND = FALLBACK_VISUALIZER_BACKGROUND;

export const VISUALIZER_STYLE_OPTIONS: {
  value: VisualizerStyle;
  label: string;
  description: string;
}[] = [
  { value: "bars", label: "Bar Graph", description: "Sharp frequency bars" },
  { value: "lava", label: "Lava Lamp", description: "Morphing glow blobs" },
  { value: "vu", label: "VU Meter", description: "Retro needle dials" },
];

export function normalizeVisualizerStyle(v: string | null | undefined): VisualizerStyle {
  return v === "lava" || v === "vu" || v === "bars" ? v : DEFAULT_VISUALIZER_STYLE;
}

interface Props {
  tile: Tile;
  editMode: boolean;
}

// A self-contained Audio Visualizer toy tile. It taps the app's own audio player
// (via enableVisualizer / the shared analyser) and paints one of three live
// canvas visualizations that react to whatever is playing — or a calm idle
// animation when nothing is. Like the Bonsai/Tamagotchi it renders its own
// surface, bypassing the standard integration header.
export default function VisualizerTile({ tile }: Props) {
  const { analyser, isPlaying, enableVisualizer } = useAudioPlayer();

  // Ask the player to build its analyser graph once this tile exists. Lazy on
  // purpose — see audioPlayer.tsx for why the graph isn't always-on.
  useEffect(() => {
    enableVisualizer();
  }, [enableVisualizer]);

  const sample = useVisualizer(analyser, isPlaying);

  // Theme-derived defaults: an unconfigured visualizer follows the active
  // theme (and re-colors live on theme switch); explicit settings always win.
  const themeDefaults = useVisualizerThemeDefaults();
  const settings = tile.tileSettings ?? undefined;
  const style = normalizeVisualizerStyle(settings?.visualizerStyle);
  const primary = settings?.visualizerPrimary || themeDefaults.primary;
  const background = settings?.visualizerBackground || themeDefaults.background;

  // Measure the tile so the canvas can be sized in device pixels.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 overflow-hidden rounded-[inherit]"
      style={{ background }}
    >
      {size.w > 0 && size.h > 0 && (
        <>
          {style === "bars" && (
            <VisualizerBarGraph sample={sample} primary={primary} background={background} width={size.w} height={size.h} />
          )}
          {style === "lava" && (
            <VisualizerLavaLamp sample={sample} primary={primary} background={background} width={size.w} height={size.h} />
          )}
          {style === "vu" && (
            <VisualizerVuMeter sample={sample} primary={primary} background={background} width={size.w} height={size.h} />
          )}
        </>
      )}
    </div>
  );
}
