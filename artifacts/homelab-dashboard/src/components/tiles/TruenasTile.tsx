import { useGetTruenasMetrics, getGetTruenasMetricsQueryKey } from "@workspace/api-client-react";
import { HardDrive, ArrowDown, ArrowUp } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";
import { tileBudget, BAR_PX, ROW_PX, SECTION_PX, listColumnClass, listColumnStyle } from "./metrics";
import {
  CpuRamView,
  NetworkView,
  ArcView,
  PoolsView,
  DisksView,
} from "./TruenasMetricViews";

// Compact inline sparkline. Draws one polyline per series sharing a single
// min/max scale so multiple lines (e.g. network in/out) are comparable. Purely
// decorative, so it is hidden from assistive tech.
function Sparkline({
  lines,
  width = 52,
  height = 16,
}: {
  lines: { values: number[]; color: string }[];
  width?: number;
  height?: number;
}) {
  const all = lines.flatMap((l) => l.values);
  if (all.length < 2) return null;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const pad = 1;
  const usableH = height - pad * 2;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="flex-shrink-0"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {lines.map((line, li) => {
        if (line.values.length < 2) return null;
        const stepX = width / (line.values.length - 1);
        const points = line.values
          .map((v, i) => {
            const x = i * stepX;
            const y = pad + (1 - (v - min) / span) * usableH;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ");
        return (
          <polyline
            key={li}
            points={points}
            fill="none"
            stroke={line.color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}

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

export default function TruenasTile({ enabled, density, tileSettings }: WidgetProps) {
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

  // When this tile is one of the bespoke per-metric variants (chosen via the
  // integration picker's second pop-out), render its dedicated richer view.
  // Otherwise fall through to the combined multi-section view below.
  switch (tileSettings?.truenasMetric) {
    case "cpuram":
      return <CpuRamView data={data} density={density} />;
    case "network":
      return <NetworkView data={data} density={density} />;
    case "arc":
      return <ArcView data={data} density={density} />;
    case "pools":
      return <PoolsView data={data} />;
    case "disks":
      return <DisksView data={data} />;
  }

  const memPct = data.memTotalGb > 0 ? (data.memUsedGb / data.memTotalGb) * 100 : 0;

  // Reveal CPU, then RAM, then the ZFS pool list in priority order, showing as
  // many as fit the measured body height. Each section is hidden entirely once
  // the budget runs out — the body never scrolls.
  const budget = tileBudget(density);
  const showCpu = enabled.has("cpu") && budget.block(BAR_PX);
  const showRam = enabled.has("ram") && budget.block(BAR_PX);

  // Network throughput and ARC are best-effort extras: only revealed when the
  // metric is enabled, the upstream actually returned a value (not null), and
  // the body still has room. Each is one compact text row.
  const hasNet = data.netInMbps != null || data.netOutMbps != null;
  const showNetwork = enabled.has("network") && hasNet && budget.block(ROW_PX);
  const hasArc = data.arcHitRatio != null || data.arcSizeGb != null;
  const showArc = enabled.has("arc") && hasArc && budget.block(ROW_PX);

  // Inline sparklines only when the body is wide enough to fit one without
  // crowding the values. They live inside the existing net/ARC rows, so they
  // cost no extra vertical budget.
  const wide = density.bodyWidth >= 240;
  const netInSeries = data.netInSeries ?? [];
  const netOutSeries = data.netOutSeries ?? [];
  const showNetSpark = wide && (netInSeries.length >= 2 || netOutSeries.length >= 2);
  const arcHitSeries = data.arcHitSeries ?? [];
  const showArcSpark = wide && arcHitSeries.length >= 2;

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
        {showNetwork && (
          <div className="flex items-center justify-between text-xs gap-2">
            <span className="text-muted-foreground">Network</span>
            <span className="flex items-center gap-2 font-medium text-foreground">
              {showNetSpark && (
                <Sparkline
                  lines={[
                    { values: netInSeries, color: "rgb(34 197 94)" },
                    { values: netOutSeries, color: "rgb(59 130 246)" },
                  ]}
                />
              )}
              <span className="flex items-center gap-0.5">
                <ArrowDown className="w-3 h-3 text-green-500" />
                {(data.netInMbps ?? 0).toFixed(1)}
              </span>
              <span className="flex items-center gap-0.5">
                <ArrowUp className="w-3 h-3 text-blue-500" />
                {(data.netOutMbps ?? 0).toFixed(1)}
              </span>
              <span className="text-muted-foreground">Mbps</span>
            </span>
          </div>
        )}
        {showArc && (
          <div className="flex items-center justify-between text-xs gap-2">
            <span className="text-muted-foreground">ARC</span>
            <span className="flex items-center gap-2 font-medium text-foreground">
              {showArcSpark && (
                <Sparkline lines={[{ values: arcHitSeries, color: "rgb(34 197 94)" }]} />
              )}
              {data.arcHitRatio != null && (
                <span className={data.arcHitRatio >= 90 ? "text-green-500" : data.arcHitRatio >= 70 ? "text-amber-500" : "text-red-500"}>
                  {data.arcHitRatio.toFixed(1)}% hit
                </span>
              )}
              {data.arcSizeGb != null && <span>{data.arcSizeGb.toFixed(1)} GB</span>}
            </span>
          </div>
        )}
      </div>
      {showPools && (
        <div
          className={`${listColumnClass(budget.columns, "space-y-1")} border-t border-border pt-2 mt-auto`}
          style={listColumnStyle(budget.columns)}
        >
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
        <div
          className={`${listColumnClass(budget.columns, "space-y-1")} border-t border-border pt-2 ${showPools ? "" : "mt-auto"}`}
          style={listColumnStyle(budget.columns)}
        >
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
