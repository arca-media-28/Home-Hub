import { useEffect, useState } from "react";

// Load the current track's album art as a canvas-safe image. The image is
// requested with crossOrigin="anonymous" so drawing it never taints the canvas
// (a tainted canvas would break nothing visually here, but keeps us honest and
// consistent should any renderer ever read pixels back). Sources that don't
// send CORS headers will fail the load — that failure resolves to `null`, and
// the renderers fall back to their generic label/disc design.
export function useAlbumArt(url: string | null | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    let cancelled = false;
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => {
      if (!cancelled) setImg(el);
    };
    el.onerror = () => {
      if (!cancelled) setImg(null);
    };
    el.src = url;
    return () => {
      cancelled = true;
      setImg(null);
    };
  }, [url]);

  return img;
}

// Draw `img` center-cropped ("cover" fit) into a circle of radius r at (cx, cy).
export function drawImageInCircle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  r: number,
): void {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (iw <= 0 || ih <= 0) return;
  const scale = (r * 2) / Math.min(iw, ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  ctx.restore();
}
