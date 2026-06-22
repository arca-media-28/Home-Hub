// Single source of truth that groups every integration into a category, shared
// by the tile edit panel (keyed by TileIntegration values) and the Settings
// page (keyed by service-connection keys). Keys from both vocabularies are
// listed here — e.g. the Plex tile uses "media" while its connection uses
// "plex", and both map to the Media category. Anything not listed falls back to
// "Other" so nothing is ever hidden.

export const CATEGORY_ORDER = [
  "News",
  "Media",
  "Downloads",
  "Server",
  "Organization",
  "Other",
] as const;

export type Category = (typeof CATEGORY_ORDER)[number];

const CATEGORY_BY_KEY: Record<string, Category> = {
  // News
  clock: "News",
  weather: "News",
  news: "News",
  sports: "News",
  sleeper: "News",
  stocks: "News",
  // Media
  media: "Media",
  plex: "Media",
  jellyfin: "Media",
  ersatztv: "Media",
  audioplayer: "Media",
  spotify: "Media",
  subsonic: "Media",
  // Downloads
  qbittorrent: "Downloads",
  sonarr: "Downloads",
  radarr: "Downloads",
  lidarr: "Downloads",
  prowlarr: "Downloads",
  // Server
  truenas: "Server",
  "nginx-proxy-manager": "Server",
  tailscale: "Server",
  pihole: "Server",
  // Layout / organization helpers
  spacer: "Organization",
  divider: "Organization",
};

// The category for a given integration / service key. Unmapped keys land in
// "Other" so a new integration is always visible somewhere.
export function categoryOf(key: string): Category {
  return CATEGORY_BY_KEY[key] ?? "Other";
}

// Group an ordered list of items by category, returning sections in
// CATEGORY_ORDER. Within each category the items keep their original order, and
// empty categories are omitted so headings only appear when they have content.
export function groupByCategory<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): { category: Category; items: T[] }[] {
  const buckets = new Map<Category, T[]>();
  for (const item of items) {
    const cat = categoryOf(keyOf(item));
    const list = buckets.get(cat);
    if (list) list.push(item);
    else buckets.set(cat, [item]);
  }
  return CATEGORY_ORDER.filter((c) => buckets.has(c)).map((category) => ({
    category,
    items: buckets.get(category)!,
  }));
}
