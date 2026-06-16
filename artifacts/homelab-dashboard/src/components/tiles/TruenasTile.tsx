import { useGetTruenasMetrics, getGetTruenasMetricsQueryKey } from "@workspace/api-client-react";
import { HardDrive } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";
import { tileBudget, BAR_PX, ROW_PX, SECTION_PX } from "./metrics";

function Bar({ value, label }: { value: number; label: string }) {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct > 85 ? "#ef4444" : pct > 65 ? "#f59e0b" : "#22c55e";
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-medium text-foreground">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-muted overflow-hidden">
        <div
          className="h-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default function TruenasTile({ enabled, density }: WidgetProps) {
  const { data, isLoading, isError } = useGetTruenasMetrics({
    query: { queryKey: getGetTruenasMetricsQueryKey(), refetchInterval: 30_000 },
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
        <HardDrive className="w-5 h-5 opacity-50" />
        <span>TrueNAS unavailable</span>
      </div>
    );
  }

  const memPct = data.memTotalGb > 0 ? (data.memUsedGb / data.memTotalGb) * 100 : 0;

  // Reveal CPU, then RAM, then the ZFS pool list in priority order, showing as
  // many as fit the measured body height. Each section is hidden entirely once
  // the budget runs out — the body never scrolls.
  const budget = tileBudget(density);
  const showCpu = enabled.has("cpu") && budget.block(BAR_PX);
  const showRam = enabled.has("ram") && budget.block(BAR_PX);
  const poolCount =
    enabled.has("pools") && data.pools.length > 0
      ? budget.list(SECTION_PX, ROW_PX, data.pools.length)
      : 0;
  const showPools = poolCount > 0;
  const pools = data.pools.slice(0, poolCount);

  const allDisks = data.disks ?? [];
  const diskCount =
    enabled.has("disks") && allDisks.length > 0
      ? budget.list(SECTION_PX, ROW_PX, allDisks.length)
      : 0;
  const showDisks = diskCount > 0;
  const disks = allDisks.slice(0, diskCount);

  return (
    <div className="w-full h-full p-3 flex flex-col gap-2">
      <div className="space-y-2 flex-1">
        {showCpu && <Bar value={data.cpuPercent} label="CPU" />}
        {showRam && (
          <Bar
            value={memPct}
            label={`RAM  ${data.memUsedGb.toFixed(1)}/${data.memTotalGb.toFixed(1)} GB`}
          />
        )}
      </div>
      {showPools && (
        <div className="space-y-1 border-t border-border pt-2 mt-auto">
          {pools.map((pool) => {
            const pct = (pool.usedBytes / pool.totalBytes) * 100;
            return (
              <div key={pool.name} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate max-w-[55%]">{pool.name}</span>
                <span className={`font-medium ${pool.status === "ONLINE" ? "text-green-500" : "text-red-500"}`}>
                  {pool.status} &middot; {pct.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
      {showDisks && (
        <div className={`space-y-1 border-t border-border pt-2 ${showPools ? "" : "mt-auto"}`}>
          {disks.map((disk) => {
            // A drive is degraded when SMART reports failure or it runs hot
            // (≥50°C). Hot-but-passing reads as a warning; a SMART failure is an
            // error — mirroring the pool ONLINE/offline color cues.
            const hot = disk.temperatureC != null && disk.temperatureC >= 50;
            const failed = disk.smartPassed === false;
            const tempColor = failed
              ? "text-red-500"
              : hot
                ? "text-amber-500"
                : "text-foreground";
            const smartLabel =
              disk.smartPassed == null ? "—" : disk.smartPassed ? "OK" : "FAIL";
            const smartColor =
              disk.smartPassed == null
                ? "text-muted-foreground"
                : disk.smartPassed
                  ? "text-green-500"
                  : "text-red-500";
            return (
              <div key={disk.name} className="flex items-center justify-between text-xs gap-2">
                <span className="text-muted-foreground truncate max-w-[45%]">{disk.name}</span>
                <span className="flex items-center gap-2 font-medium">
                  <span className={tempColor}>
                    {disk.temperatureC != null ? `${disk.temperatureC.toFixed(0)}°C` : "—"}
                  </span>
                  <span className={smartColor}>{smartLabel}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
