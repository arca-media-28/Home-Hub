import { useGetQbittorrentStatus, getGetQbittorrentStatusQueryKey } from "@workspace/api-client-react";
import { Download, Upload, ArrowDownToLine } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";
import { tileBudget, SECTION_PX, ROW_PX, TWO_LINE_ROW_PX } from "./metrics";

function formatSpeed(bytesPerSec: number | null | undefined): string {
  const b = bytesPerSec ?? 0;
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB/s`;
  if (b > 1e3) return `${(b / 1e3).toFixed(0)} KB/s`;
  return `${b} B/s`;
}

interface Torrent {
  name: string;
  state: string;
  progress: number;
  category: string;
}

// A single torrent row: name, optional category chip, state, and a progress
// bar. The category chip is hidden when rows are already grouped under a header.
function TorrentRow({ torrent, showCategory }: { torrent: Torrent; showCategory: boolean }) {
  const t = torrent;
  return (
    <div className="min-w-0">
      <div className="flex justify-between items-center gap-1">
        <span className="text-xs font-medium truncate max-w-[55%]">{t.name}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {showCategory && t.category && (
            <span className="text-[10px] leading-none px-1 py-0.5 rounded-sm bg-secondary text-secondary-foreground max-w-[80px] truncate">
              {t.category}
            </span>
          )}
          <span className="text-xs text-muted-foreground capitalize">{t.state}</span>
        </div>
      </div>
      <div className="h-1 bg-muted overflow-hidden mt-0.5">
        <div
          className="h-full bg-primary transition-all duration-700"
          style={{ width: `${Math.min(100, Math.max(0, t.progress))}%` }}
        />
      </div>
    </div>
  );
}

export default function QbittorrentTile({ enabled, density, tileSettings }: WidgetProps) {
  const { data, isLoading, isError } = useGetQbittorrentStatus({
    query: { queryKey: getGetQbittorrentStatusQueryKey(), refetchInterval: 10_000 },
  });

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-1">
        <ArrowDownToLine className="w-5 h-5 opacity-50" />
        <span>qBittorrent unavailable</span>
      </div>
    );
  }

  const showSpeeds = enabled.has("speeds");
  const showTorrents = enabled.has("torrents");

  // A null/undefined categoryFilter means "show all categories". An explicit
  // array narrows the list to only torrents whose category is in the allow-list.
  const categoryFilter = tileSettings?.categoryFilter ?? null;
  const filterActive = Array.isArray(categoryFilter);
  const torrents = (data.torrents ?? []).filter((t) =>
    filterActive ? categoryFilter!.includes(t.category) : true,
  );

  // Reveal the global speeds line first (priority), then as many torrent rows as
  // the measured body allows. Anything that doesn't fit is hidden — no scroll.
  const budget = tileBudget(density);
  const speedsVisible = showSpeeds && budget.block(ROW_PX);

  // Group torrents under category headers when the per-tile toggle is on and
  // more than one distinct category is present (a single category reads better
  // as a flat list).
  const groupByCategory = tileSettings?.groupByCategory ?? false;
  const distinctCategories = new Set(
    torrents.map((t) => (t.category && t.category.length > 0 ? t.category : "Uncategorized")),
  );
  const grouped = showTorrents && groupByCategory && distinctCategories.size > 1;

  // Build ordered groups (alphabetical, with "Uncategorized" last), each a list
  // section that reveals only the rows that fit the remaining budget. Groups
  // that don't fit at all are dropped.
  function buildGroups() {
    const map = new Map<string, typeof torrents>();
    for (const t of torrents) {
      const cat = t.category && t.category.length > 0 ? t.category : "Uncategorized";
      const list = map.get(cat) ?? [];
      list.push(t);
      map.set(cat, list);
    }
    const names = Array.from(map.keys()).sort((a, b) => {
      if (a === "Uncategorized") return 1;
      if (b === "Uncategorized") return -1;
      return a.localeCompare(b);
    });
    const result: { category: string; items: typeof torrents }[] = [];
    for (const name of names) {
      const items = map.get(name)!;
      const n = budget.list(SECTION_PX, TWO_LINE_ROW_PX, items.length);
      if (n === 0) break;
      result.push({ category: name, items: items.slice(0, n) });
    }
    return result;
  }
  const groups = grouped ? buildGroups() : [];

  // Flat list: how many rows fit (no section header).
  const flatCount =
    !grouped && showTorrents ? budget.list(0, TWO_LINE_ROW_PX, torrents.length) : 0;
  const hasTorrents = grouped ? groups.length > 0 : flatCount > 0;

  return (
    <div className="w-full h-full p-3 flex flex-col gap-2">
      {speedsVisible && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <span className="flex items-center gap-0.5 text-green-500">
            <Download className="w-3 h-3" />
            {formatSpeed(data.downloadSpeed)}
          </span>
          <span className="flex items-center gap-0.5 text-blue-400">
            <Upload className="w-3 h-3" />
            {formatSpeed(data.uploadSpeed)}
          </span>
        </div>
      )}

      {hasTorrents ? (
        grouped ? (
          <div className="flex-1 space-y-2">
            {groups.map((g) => (
              <div key={g.category} className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
                  {g.category}
                </div>
                <div className="space-y-1.5">
                  {g.items.map((t, i) => (
                    <TorrentRow key={`${t.name}-${i}`} torrent={t} showCategory={false} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 space-y-1.5">
            {torrents.slice(0, flatCount).map((t, i) => (
              <TorrentRow key={`${t.name}-${i}`} torrent={t} showCategory={filterActive} />
            ))}
          </div>
        )
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
          {showTorrents
            ? "No active torrents"
            : showSpeeds
              ? ""
              : "No metrics selected"}
        </div>
      )}
    </div>
  );
}
