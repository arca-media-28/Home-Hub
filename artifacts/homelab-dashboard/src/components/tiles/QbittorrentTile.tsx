import { useGetQbittorrentStatus, getGetQbittorrentStatusQueryKey } from "@workspace/api-client-react";
import { Download, Upload, ArrowDownToLine } from "lucide-react";

function formatSpeed(bytesPerSec: number | null | undefined): string {
  const b = bytesPerSec ?? 0;
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB/s`;
  if (b > 1e3) return `${(b / 1e3).toFixed(0)} KB/s`;
  return `${b} B/s`;
}

export default function QbittorrentTile() {
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

  const hasTorrents = data.torrents && data.torrents.length > 0;

  return (
    <div className="w-full h-full p-3 flex flex-col gap-2 overflow-hidden">
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

      {hasTorrents ? (
        <div className="flex-1 overflow-hidden space-y-1.5">
          {data.torrents.slice(0, 5).map((t, i) => (
            <div key={`${t.name}-${i}`} className="min-w-0">
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium truncate max-w-[70%]">{t.name}</span>
                <span className="text-xs text-muted-foreground capitalize">{t.state}</span>
              </div>
              <div className="h-1 bg-muted overflow-hidden mt-0.5">
                <div
                  className="h-full bg-primary transition-all duration-700"
                  style={{ width: `${Math.min(100, Math.max(0, t.progress))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
          No active torrents
        </div>
      )}
    </div>
  );
}
