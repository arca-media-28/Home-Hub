import { useGetPiholeMetrics, getGetPiholeMetricsQueryKey } from "@workspace/api-client-react";
import { ApiError } from "@workspace/api-client-react";
import { Shield, ShieldCheck, ShieldOff } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";

function formatCount(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

export default function PiholeTile({ enabled, density }: WidgetProps) {
  const { data, isLoading, isError, error } = useGetPiholeMetrics({
    query: { queryKey: getGetPiholeMetricsQueryKey(), refetchInterval: 30_000 },
  });

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  if (isError || !data) {
    // 503 means the service has no saved connection yet — show a distinct
    // "not configured" placeholder rather than an error, matching the pattern
    // where unconfigured services prompt the user to set them up.
    const notConfigured = error instanceof ApiError && error.status === 503;
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-1">
        <Shield className="w-5 h-5 opacity-50" />
        <span>{notConfigured ? "Pi-hole not configured" : "Pi-hole unavailable"}</span>
      </div>
    );
  }

  const showQueries = enabled.has("queries");
  const showBlocked = enabled.has("blocked");
  const showStatus = enabled.has("status");

  const pct = Math.min(100, Math.max(0, data.adsPercentage));
  const isEnabled = data.status === "enabled";

  return (
    <div className="w-full h-full p-3 flex flex-col gap-3">
      {showStatus && (
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Status
          </span>
          <span
            className={`flex items-center gap-1 text-xs font-semibold ${
              isEnabled ? "text-green-500" : "text-red-500"
            }`}
          >
            {isEnabled ? (
              <ShieldCheck className="w-3.5 h-3.5" />
            ) : (
              <ShieldOff className="w-3.5 h-3.5" />
            )}
            {isEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>
      )}

      <div className="flex-1 flex flex-col justify-center gap-3">
        {showQueries && (
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">DNS queries today</span>
              <span className="text-lg font-bold tabular-nums text-foreground">
                {formatCount(data.queriesTotal)}
              </span>
            </div>
            {density.expanded && (
              <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
                <span>On blocklist</span>
                <span className="tabular-nums">{formatCount(data.domainsBlocked)}</span>
              </div>
            )}
          </div>
        )}

        {showBlocked && (
          <div className="space-y-0.5">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Ads blocked today</span>
              <span className="font-bold tabular-nums text-foreground">
                {formatCount(data.adsBlocked)}
              </span>
            </div>
            <div className="h-1.5 bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-end text-xs text-muted-foreground">
              {pct.toFixed(1)}% blocked
            </div>
          </div>
        )}

        {!showQueries && !showBlocked && !showStatus && (
          <div className="flex items-center justify-center text-muted-foreground text-xs">
            No metrics selected
          </div>
        )}
      </div>
    </div>
  );
}
