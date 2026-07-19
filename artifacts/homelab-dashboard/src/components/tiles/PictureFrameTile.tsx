import { useEffect, useMemo, useRef, useState } from "react";
import type { Tile } from "@workspace/api-client-react";
import {
  useGetPhotosWidget,
  getGetPhotosWidgetQueryKey,
} from "@workspace/api-client-react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";

// ---------------------------------------------------------------------------
// Picture Frame tile: a full-surface photo slideshow. Photos come from one of
// four sources chosen in the tile editor: uploaded images, pasted URLs, a
// Google Photos album, or an Immich album. The two album sources return
// authenticated API proxy paths (Google baseUrls expire and Immich needs its
// API key server-side), so those images are fetched as blobs with the bearer
// token and rendered via object URLs. When nothing is configured (or a
// server-backed source reports sample mode) the tile cycles built-in demo
// "photos" (inline SVG scenes) so it always shows something.
// Slides crossfade on a configurable interval; hovering reveals prev/next.
// ---------------------------------------------------------------------------

export const DEFAULT_PHOTO_INTERVAL = 30;
export const PHOTO_INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: 10, label: "10 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 300, label: "5 minutes" },
  { value: 0, label: "Off (manual)" },
];

export type FrameStyle = "none" | "wood" | "thin" | "gold" | "polaroid" | "custom";
export const FRAME_STYLE_OPTIONS: { value: FrameStyle; label: string }[] = [
  { value: "none", label: "None" },
  { value: "wood", label: "Wood" },
  { value: "thin", label: "Thin" },
  { value: "gold", label: "Gold" },
  { value: "polaroid", label: "Polaroid" },
  { value: "custom", label: "Custom" },
];
export const DEFAULT_FRAME_COLOR = "#8b5a2b";
export const DEFAULT_FRAME_WIDTH = 10;

// A tiny inline-SVG "photo" so the demo slideshow needs no network at all.
function demoSvg(id: string, sky: string, ground: string, accent: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'>` +
    `<rect width='800' height='600' fill='${sky}'/>` +
    `<circle cx='640' cy='120' r='60' fill='${accent}'/>` +
    `<path d='M0 420 L220 260 L400 400 L560 300 L800 430 L800 600 L0 600 Z' fill='${ground}'/>` +
    `<text x='24' y='576' font-family='sans-serif' font-size='28' fill='rgba(255,255,255,0.85)'>${id}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const DEMO_PHOTOS: { id: string; url: string }[] = [
  { id: "Mountains", url: demoSvg("Mountains", "#7ea8d8", "#4a6b4f", "#f7e8a4") },
  { id: "Sunset", url: demoSvg("Sunset", "#e8926b", "#5b4a68", "#f6d365") },
  { id: "Lakeside", url: demoSvg("Lakeside", "#6bb3c9", "#3f6d5a", "#f0f4f8") },
  { id: "Dunes", url: demoSvg("Dunes", "#d9c58a", "#b08b4f", "#fdf6e3") },
];

// Frame look → wrapper styling. The frame is drawn as padding + background on
// an outer div; the photo area is the inner overflow-hidden box.
function frameFor(
  style: FrameStyle,
  color: string,
  width: number,
): { pad: string; background?: string; boxShadow?: string } | null {
  switch (style) {
    case "wood":
      return {
        pad: "12px",
        background: "linear-gradient(135deg, #8b5a2b 0%, #6f4518 45%, #a0703c 100%)",
        boxShadow: "inset 0 0 6px rgba(0,0,0,0.5)",
      };
    case "thin":
      return { pad: "3px", background: "hsl(var(--border))" };
    case "gold":
      return {
        pad: "10px",
        background: "linear-gradient(135deg, #b8860b 0%, #ffd700 40%, #8b6914 100%)",
        boxShadow: "inset 0 0 4px rgba(0,0,0,0.4)",
      };
    case "polaroid":
      return {
        pad: "12px 12px 44px 12px",
        background: "#f5f2ea",
        boxShadow: "inset 0 0 3px rgba(0,0,0,0.15)",
      };
    case "custom":
      return { pad: `${Math.max(1, Math.min(48, width))}px`, background: color };
    default:
      return null;
  }
}

// Module-level object-URL cache for proxied album photos, so re-renders and
// slide loops don't refetch bytes. Keyed by the proxy path.
const blobCache = new Map<string, string>();

// Fetch an authenticated proxy path into an object URL (cached). Plain URLs
// (data:, http(s), uploads) render directly and skip this.
function needsAuthFetch(url: string): boolean {
  return url.startsWith("/api/widgets/photos/");
}

function useResolvedSrc(url: string | null): string | null {
  const [src, setSrc] = useState<string | null>(() =>
    url ? (needsAuthFetch(url) ? blobCache.get(url) ?? null : url) : null,
  );
  useEffect(() => {
    if (!url) {
      setSrc(null);
      return;
    }
    if (!needsAuthFetch(url)) {
      setSrc(url);
      return;
    }
    const cached = blobCache.get(url);
    if (cached) {
      setSrc(cached);
      return;
    }
    let cancelled = false;
    setSrc(null);
    fetch(url, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const obj = URL.createObjectURL(blob);
        blobCache.set(url, obj);
        if (!cancelled) setSrc(obj);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return src;
}

interface PictureFrameTileProps {
  tile: Tile;
  editMode: boolean;
}

export default function PictureFrameTile({ tile, editMode }: PictureFrameTileProps) {
  const s = tile.tileSettings ?? {};
  const source = s.photoSource ?? null;
  const albumId = s.photoAlbumId ?? null;
  const interval = s.photoInterval ?? DEFAULT_PHOTO_INTERVAL;
  const fit = s.photoFit === "contain" ? "contain" : "cover";
  const frameStyle = (s.frameStyle ?? "none") as FrameStyle;
  const frame = frameFor(
    frameStyle,
    s.frameColor ?? DEFAULT_FRAME_COLOR,
    s.frameWidth ?? DEFAULT_FRAME_WIDTH,
  );

  const isServerSource = source === "google" || source === "immich";
  const widgetQuery = useGetPhotosWidget(
    { source: source === "immich" ? "immich" : "google", albumId: albumId ?? undefined },
    {
      query: {
        queryKey: getGetPhotosWidgetQueryKey({
          source: source === "immich" ? "immich" : "google",
          albumId: albumId ?? undefined,
        }),
        enabled: isServerSource,
        refetchInterval: 10 * 60_000,
        staleTime: 5 * 60_000,
      },
    },
  );

  // Resolve the photo list for the chosen source. Empty/unconfigured → demo.
  const { photos, demo, failed } = useMemo(() => {
    if (source === "uploads") {
      const list = (s.photoUploadUrls ?? []).filter(Boolean);
      return list.length > 0
        ? { photos: list.map((url, i) => ({ id: `upload-${i}`, url })), demo: false, failed: false }
        : { photos: DEMO_PHOTOS, demo: true, failed: false };
    }
    if (source === "urls") {
      const list = (s.photoUrls ?? []).filter(Boolean);
      return list.length > 0
        ? { photos: list.map((url, i) => ({ id: `url-${i}`, url })), demo: false, failed: false }
        : { photos: DEMO_PHOTOS, demo: true, failed: false };
    }
    if (isServerSource) {
      if (widgetQuery.isError) return { photos: [], demo: false, failed: true };
      const data = widgetQuery.data;
      if (!data || data.sample || data.photos.length === 0) {
        return { photos: DEMO_PHOTOS, demo: true, failed: false };
      }
      return { photos: data.photos, demo: false, failed: false };
    }
    return { photos: DEMO_PHOTOS, demo: true, failed: false };
  }, [source, s.photoUploadUrls, s.photoUrls, isServerSource, widgetQuery.data, widgetQuery.isError]);

  const [index, setIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState<number | null>(null);
  const count = photos.length;
  const indexRef = useRef(index);
  indexRef.current = index;

  // Clamp when the list shrinks (e.g. settings changed).
  useEffect(() => {
    if (count > 0 && index >= count) {
      setIndex(0);
      setPrevIndex(null);
    }
  }, [count, index]);

  function goTo(next: number) {
    if (count < 2) return;
    setPrevIndex(indexRef.current);
    setIndex(((next % count) + count) % count);
  }

  // Auto-advance timer. interval 0 = manual only; paused in edit mode.
  useEffect(() => {
    if (interval <= 0 || count < 2 || editMode) return;
    const t = setInterval(() => goTo(indexRef.current + 1), interval * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval, count, editMode]);

  // Drop the fading-out layer once the crossfade finishes.
  useEffect(() => {
    if (prevIndex == null) return;
    const t = setTimeout(() => setPrevIndex(null), 800);
    return () => clearTimeout(t);
  }, [prevIndex, index]);

  const current = count > 0 ? photos[index % count] : null;
  const prev = prevIndex != null && count > 0 ? photos[prevIndex % count] : null;
  const currentSrc = useResolvedSrc(current?.url ?? null);
  const prevSrc = useResolvedSrc(prev?.url ?? null);

  const inner = failed ? (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground text-sm bg-card"
      data-testid="pictureframe-error"
    >
      <ImageOff className="w-5 h-5 opacity-50" />
      <span>Photos unavailable</span>
    </div>
  ) : (
    <div className="relative w-full h-full overflow-hidden bg-black/80 group">
      {/* Fading-out previous slide sits under the current one. */}
      {prevSrc && prev && (
        <img
          key={`prev-${prevIndex}`}
          src={prevSrc}
          alt=""
          className="absolute inset-0 w-full h-full pictureframe-fade-out"
          style={{ objectFit: fit }}
          draggable={false}
        />
      )}
      {currentSrc && current && (
        <img
          key={`cur-${index}`}
          src={currentSrc}
          alt=""
          data-testid="pictureframe-photo"
          data-photo-id={current.id}
          className="absolute inset-0 w-full h-full pictureframe-fade-in"
          style={{ objectFit: fit }}
          draggable={false}
        />
      )}
      {demo && (
        <span
          className="absolute top-1.5 right-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white/80"
          data-testid="pictureframe-demo-badge"
        >
          Demo
        </span>
      )}
      {!editMode && count > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            data-testid="pictureframe-prev"
            onClick={() => goTo(indexRef.current - 1)}
            className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/60"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            data-testid="pictureframe-next"
            onClick={() => goTo(indexRef.current + 1)}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/60"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );

  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-[inherit]"
      data-testid="pictureframe-tile"
    >
      {/* Crossfade keyframes: the incoming slide fades in over the outgoing one. */}
      <style>{`
        @keyframes pictureframe-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pictureframe-out { from { opacity: 1; } to { opacity: 0; } }
        .pictureframe-fade-in { animation: pictureframe-in 0.7s ease both; }
        .pictureframe-fade-out { animation: pictureframe-out 0.7s ease both; }
      `}</style>
      {frame ? (
        <div className="w-full h-full" style={{ padding: frame.pad, background: frame.background, boxShadow: frame.boxShadow }}>
          <div className="w-full h-full overflow-hidden">{inner}</div>
        </div>
      ) : (
        inner
      )}
    </div>
  );
}
