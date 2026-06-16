import { useState } from "react";
import { useGetTailscaleStatus, getGetTailscaleStatusQueryKey } from "@workspace/api-client-react";
import { Network, ArrowUpRight, Copy, Check } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";
import { tileBudget, STAT_ROW_PX, ROW_PX, SECTION_PX, TWO_LINE_ROW_PX } from "./metrics";

// The first tailnet IPv4 (100.x) address is what users almost always want to
// grab; fall back to the first address of any kind when no IPv4 is present.
function primaryAddress(addresses: string[] | undefined): string | null {
  if (!addresses || addresses.length === 0) return null;
  const v4 = addresses.find((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a));
  return v4 ?? addresses[0] ?? null;
}

// Compact "last seen" relative label, e.g. "3m", "2h", "5d".
function relativeLastSeen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function TailscaleTile({ enabled, density }: WidgetProps) {
  const { data, isLoading, isError } = useGetTailscaleStatus({
    query: { queryKey: getGetTailscaleStatusQueryKey(), refetchInterval: 30_000 },
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyAddress(id: string, address: string) {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // Clipboard API can be unavailable (e.g. non-secure context); ignore so
      // the tile never throws on a copy attempt.
      return;
    }
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((cur) => (cur === id ? null : cur));
    }, 1500);
  }

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
        <Network className="w-5 h-5 opacity-50" />
        <span>Tailscale unavailable</span>
      </div>
    );
  }

  // Reveal in catalog priority — device summary, then exit-node availability,
  // then the per-device list (which greedily fills whatever space remains).
  const budget = tileBudget(density);
  const showSummary = enabled.has("summary") && budget.block(STAT_ROW_PX);
  const showExitNodes = enabled.has("exitNodes") && budget.block(ROW_PX);
  const deviceRows = enabled.has("devices")
    ? budget.list(SECTION_PX, TWO_LINE_ROW_PX, data.devices.length)
    : 0;

  // Show online devices first so the most relevant rows survive truncation.
  const sortedDevices = [...data.devices].sort(
    (a, b) => Number(b.online) - Number(a.online),
  );
  const visibleDevices = sortedDevices.slice(0, deviceRows);

  return (
    <div className="w-full h-full p-3 flex flex-col gap-3">
      {showSummary && (
        <div className="flex items-center justify-around text-center">
          <div>
            <div className="text-lg font-bold tabular-nums text-foreground leading-none">
              {data.deviceCount}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
              Devices
            </div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums text-green-500 leading-none">
              {data.onlineCount}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
              Online
            </div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums text-muted-foreground leading-none">
              {data.offlineCount}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
              Offline
            </div>
          </div>
        </div>
      )}

      {showExitNodes && (
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <ArrowUpRight className="w-3.5 h-3.5" />
            Exit nodes
          </span>
          <span className="font-semibold tabular-nums text-foreground">
            {data.exitNodeCount} available
          </span>
        </div>
      )}

      {deviceRows > 0 && (
        <div className="flex-1 min-h-0 flex flex-col gap-1.5 overflow-hidden">
          {visibleDevices.map((d) => {
            const ip = primaryAddress(d.addresses);
            const copied = copiedId === d.id;
            return (
              <div key={d.id} className="flex items-center gap-2">
                <span
                  className={`flex-shrink-0 h-2 w-2 rounded-full ${
                    d.online ? "bg-green-500" : "bg-muted-foreground/40"
                  }`}
                  title={d.online ? "Online" : "Offline"}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground truncate">
                      {d.name}
                    </span>
                    {d.exitNode && (
                      <span className="flex-shrink-0 text-[9px] uppercase tracking-wide font-semibold text-primary border border-primary/40 rounded px-1 leading-tight">
                        Exit
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {d.os} · {d.online ? "online" : relativeLastSeen(d.lastSeen)}
                  </div>
                </div>
                {ip && (
                  <button
                    type="button"
                    onClick={() => copyAddress(d.id, ip)}
                    title={copied ? "Copied!" : `Copy ${ip}`}
                    aria-label={copied ? `Copied ${ip}` : `Copy ${d.name} IP ${ip}`}
                    className="group flex-shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <span className="hidden sm:inline truncate max-w-[88px]">{ip}</span>
                    {copied ? (
                      <Check className="w-3 h-3 text-green-500" />
                    ) : (
                      <Copy className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!showSummary && !showExitNodes && deviceRows === 0 && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
          No metrics selected
        </div>
      )}
    </div>
  );
}
