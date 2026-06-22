import type { AudioTrack } from "@workspace/api-client-react";
import { Music } from "lucide-react";

// Shared helpers for the Audio Player tiles (Plex stream engine + Spotify), kept
// in one place so both sources render now-playing identically.

// Format milliseconds (backend) or seconds (player) as m:ss. Pass `unit` to pick.
export function fmtTime(value: number, unit: "ms" | "s"): string {
  const totalSec = unit === "ms" ? value / 1000 : value;
  if (!Number.isFinite(totalSec) || totalSec < 0) return "0:00";
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Album-art square. Falls back to a music glyph when a track has no artwork (or
// for demo data, which carries none).
export function Artwork({ track, size }: { track: AudioTrack | null; size: number }) {
  const style = { width: size, height: size };
  if (track?.artwork) {
    return (
      <img
        src={track.artwork}
        alt=""
        style={style}
        className="flex-shrink-0 rounded object-cover bg-muted"
      />
    );
  }
  return (
    <div
      style={style}
      className="flex flex-shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
    >
      <Music size={Math.round(size * 0.4)} aria-hidden="true" />
    </div>
  );
}
