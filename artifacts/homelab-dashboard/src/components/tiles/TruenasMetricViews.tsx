import { ArrowDown, ArrowUp, HardDrive } from "lucide-react";
import type { TruenasMetrics } from "@workspace/api-client-react";
import type { TileDensity } from "./metrics";
import { filterTruenasPools } from "./metrics";

// Bespoke per-metric TrueNAS "live tile" views. Each TrueNAS metric variant
// (chosen via the integration picker's second pop-out and stored on the tile as
// tileSettings.truenasMetric) renders one of these dedicated, richer visuals
// instead of the combined multi-section TruenasTile view.

// ── Shared primitives ────────────────────────────────────────────────────────

function toneColor(pct: number): string {
  return pct > 85 ? "#ef4444" : pct > 65 ? "#f59e0b" : "#22c55e";
}

// A large radial gauge: a 270° arc with a value track, the percentage in the
// center, and an optional caption underneath. Sized to the available box.
function Gauge({
  value,
  size,
  label,
  caption,
  color,
}: {
  value: number;
  size: number;
  label: string;
  caption?: string;
  color?: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  const stroke = Math.max(6, Math.round(size * 0.09));
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  // 270° sweep, starting bottom-left (135°) going clockwise to bottom-right.
  const startAngle = 135;
  const sweep = 270;
  const circumference = 2 * Math.PI * r;
  const arcLen = (sweep / 360) * circumference;
  const dash = (pct / 100) * arcLen;
  const c = color ?? toneColor(pct);
  return (
    <div className="flex flex-col items-center justify-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        <g transform={`rotate(${startAngle} ${cx} ${cy})`}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="currentColor"
            className="text-muted"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLen} ${circumference}`}
          />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={c}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            className="transition-all duration-700"
          />
        </g>
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground font-semibold"
          style={{ fontSize: size * 0.26 }}
        >
          {pct.toFixed(0)}%
        </text>
      </svg>
      <span className="mt-1 text-sm font-medium text-foreground">{label}</span>
      {caption && (
        <span className="text-xs text-muted-foreground">{caption}</span>
      )}
    </div>
  );
}

// A prominent area sparkline used by the network and ARC views. Fills under each
// line with a faint wash so the trend reads at a glance on a larger canvas.
function AreaSparkline({
  lines,
  width,
  height,
}: {
  lines: { values: number[]; color: string }[];
  width: number;
  height: number;
}) {
  const all = lines.flatMap((l) => l.values);
  if (all.length < 2) return null;
  const min = Math.min(...all, 0);
  const max = Math.max(...all);
  const span = max - min || 1;
  const pad = 2;
  const usableH = height - pad * 2;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {lines.map((line, li) => {
        if (line.values.length < 2) return null;
        const stepX = width / (line.values.length - 1);
        const pts = line.values.map((v, i) => {
          const x = i * stepX;
          const y = pad + (1 - (v - min) / span) * usableH;
          return [x, y] as const;
        });
        const linePath = pts
          .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
          .join(" ");
        const areaPath =
          `${linePath} L${width.toFixed(1)},${height} L0,${height} Z`;
        return (
          <g key={li}>
            <path d={areaPath} fill={line.color} opacity={0.12} />
            <path
              d={linePath}
              fill="none"
              stroke={line.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}
    </svg>
  );
}

// A horizontal capacity bar with a label row, used by the pools view.
function CapacityBar({
  label,
  pct,
  right,
  rightColor,
}: {
  label: string;
  pct: number;
  right: string;
  rightColor?: string;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="truncate max-w-[55%] font-medium text-foreground">
          {label}
        </span>
        <span className={`font-medium ${rightColor ?? "text-muted-foreground"}`}>
          {right}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-sm bg-muted">
        <div
          className="h-full transition-all duration-700"
          style={{ width: `${clamped}%`, background: toneColor(clamped) }}
        />
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// ── Per-metric views ─────────────────────────────────────────────────────────

export function CpuRamView({
  data,
  density,
}: {
  data: TruenasMetrics;
  density: TileDensity;
}) {
  const memPct =
    data.memTotalGb > 0 ? (data.memUsedGb / data.memTotalGb) * 100 : 0;
  // Size the gauges to the smaller of half-width / available height so two sit
  // side by side without overflowing; cap so they stay tidy on huge tiles.
  const gaugeSize = Math.max(
    72,
    Math.min(180, Math.floor(Math.min(density.bodyWidth / 2 - 24, density.bodyHeight - 56))),
  );
  return (
    <div className="flex h-full w-full items-center justify-center gap-6 p-3">
      <Gauge
        value={data.cpuPercent}
        size={gaugeSize}
        label="CPU"
        caption={`${data.cpuPercent.toFixed(0)}% load`}
      />
      <Gauge
        value={memPct}
        size={gaugeSize}
        label="RAM"
        caption={`${data.memUsedGb.toFixed(1)} / ${data.memTotalGb.toFixed(1)} GB`}
      />
    </div>
  );
}

export function NetworkView({
  data,
  density,
}: {
  data: TruenasMetrics;
  density: TileDensity;
}) {
  const netIn = data.netInSeries ?? [];
  const netOut = data.netOutSeries ?? [];
  const hasSpark = netIn.length >= 2 || netOut.length >= 2;
  const chartH = Math.max(60, Math.min(220, density.bodyHeight - 120));
  return (
    <div className="flex h-full w-full flex-col gap-3 p-3">
      <div className="flex items-center justify-around">
        <div className="flex flex-col items-center">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowDown className="h-3.5 w-3.5 text-green-500" /> Download
          </span>
          <span className="text-2xl font-semibold text-foreground">
            {(data.netInMbps ?? 0).toFixed(1)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              Mbps
            </span>
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowUp className="h-3.5 w-3.5 text-blue-500" /> Upload
          </span>
          <span className="text-2xl font-semibold text-foreground">
            {(data.netOutMbps ?? 0).toFixed(1)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              Mbps
            </span>
          </span>
        </div>
      </div>
      {hasSpark ? (
        <div className="min-h-0 flex-1">
          <AreaSparkline
            lines={[
              { values: netIn, color: "rgb(34 197 94)" },
              { values: netOut, color: "rgb(59 130 246)" },
            ]}
            width={Math.max(120, Math.floor(density.bodyWidth - 24))}
            height={chartH}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          No throughput history available
        </div>
      )}
    </div>
  );
}

export function ArcView({
  data,
  density,
}: {
  data: TruenasMetrics;
  density: TileDensity;
}) {
  const hit = data.arcHitRatio;
  const series = data.arcHitSeries ?? [];
  const hasSpark = series.length >= 2;
  const gaugeSize = Math.max(
    80,
    Math.min(190, Math.floor(Math.min(density.bodyWidth - 48, density.bodyHeight - 80))),
  );
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-3">
      {hit != null ? (
        <Gauge
          value={hit}
          size={gaugeSize}
          label="ARC hit ratio"
          caption={data.arcSizeGb != null ? `${data.arcSizeGb.toFixed(1)} GB cache` : undefined}
          color={hit >= 90 ? "#22c55e" : hit >= 70 ? "#f59e0b" : "#ef4444"}
        />
      ) : (
        <div className="text-sm text-muted-foreground">
          ARC stats unavailable
        </div>
      )}
      {hasSpark && (
        <div className="w-full">
          <AreaSparkline
            lines={[{ values: series, color: "rgb(34 197 94)" }]}
            width={Math.max(120, Math.floor(density.bodyWidth - 24))}
            height={Math.max(40, Math.min(90, density.bodyHeight - gaugeSize - 80))}
          />
        </div>
      )}
    </div>
  );
}

export function PoolsView({
  data,
  selectedPools,
}: {
  data: TruenasMetrics;
  selectedPools?: string[] | null;
}) {
  const allPools = data.pools ?? [];
  if (allPools.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        No ZFS pools reported
      </div>
    );
  }
  const pools = filterTruenasPools(allPools, selectedPools);
  // The tile filters to specific volumes, but none of them are currently
  // reported (e.g. a chosen pool was renamed/removed) — say so rather than
  // showing an empty body.
  if (pools.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center px-3 text-center text-sm text-muted-foreground">
        None of the selected volumes are currently reported
      </div>
    );
  }
  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-3">
      {pools.map((pool) => {
        const pct =
          pool.totalBytes > 0 ? (pool.usedBytes / pool.totalBytes) * 100 : 0;
        const online = pool.status === "ONLINE";
        return (
          <div key={pool.name} className="space-y-1">
            <CapacityBar
              label={pool.name}
              pct={pct}
              right={`${pct.toFixed(0)}%`}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span
                className={`font-medium ${online ? "text-green-500" : "text-red-500"}`}
              >
                {pool.status}
              </span>
              <span>
                {formatBytes(pool.usedBytes)} / {formatBytes(pool.totalBytes)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DisksView({ data }: { data: TruenasMetrics }) {
  const disks = data.disks ?? [];
  if (disks.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
        <HardDrive className="h-5 w-5 opacity-50" />
        <span>No disks reported</span>
      </div>
    );
  }
  return (
    <div className="grid h-full w-full auto-rows-min gap-2 overflow-y-auto p-3 [grid-template-columns:repeat(auto-fill,minmax(120px,1fr))]">
      {disks.map((disk) => {
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
          <div
            key={disk.name}
            className="flex flex-col gap-1 rounded-md border border-border p-2"
          >
            <span className="flex items-center gap-1 truncate text-xs font-medium text-foreground">
              <HardDrive className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              {disk.name}
            </span>
            <div className="flex items-baseline justify-between">
              <span className={`text-lg font-semibold ${tempColor}`}>
                {disk.temperatureC != null
                  ? `${disk.temperatureC.toFixed(0)}°C`
                  : "—"}
              </span>
              <span className={`text-xs font-medium ${smartColor}`}>
                {smartLabel}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
