import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Ensure a tile URL points at an absolute destination. URLs entered without a
// scheme (e.g. "radarr.coruh.online") would otherwise be treated as relative to
// the dashboard's own address, so we prepend a default scheme. URLs that already
// specify a scheme (http://, https://, etc.) are left untouched.
export function normalizeTileUrl(url: string): string {
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(url)) {
    return url;
  }
  return `https://${url}`;
}

// Open a tile's URL in a new tab, normalizing scheme-less URLs first.
export function openTileUrl(url: string | null | undefined): void {
  if (!url) return;
  window.open(normalizeTileUrl(url), "_blank", "noopener,noreferrer");
}
