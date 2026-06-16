import {
  useGetProwlarrWidget,
  getGetProwlarrWidgetQueryKey,
} from "@workspace/api-client-react";
import { Radar, AlertTriangle } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";
import { resolveProwlarrLayout } from "./prowlarrLayout";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 min-w-0">
      <span className="text-lg font-bold tabular-nums leading-none text-foreground">{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1 text-center">
        {label}
      </span>
    </div>
  );
}

export default function ProwlarrTile({ enabled, density }: WidgetProps) {
  const { data, isLoading, isError } = useGetProwlarrWidget({
    query: { queryKey: getGetProwlarrWidgetQueryKey(), refetchInterval: 60_000 },
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
        <Radar className="w-5 h-5 opacity-50" />
        <span>Prowlarr unavailable</span>
      </div>
    );
  }

  const layout = resolveProwlarrLayout(density.level, enabled);

  // Healthy = enabled AND reachable. Disabled indexers are intentionally off, so
  // they don't count toward "online".
  const total = data.indexers.length;
  const healthy = data.indexers.filter((ix) => ix.enabled && ix.status === "ok").length;

  const issues = data.healthIssues;
  const showHealthSection = layout.showHealth && issues.length > 0;
  const nothingToShow = !layout.showStats && !layout.showIndexerList && !showHealthSection;

  if (nothingToShow) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
        No metrics selected
      </div>
    );
  }

  return (
    <div className="w-full h-full p-3 flex flex-col gap-2 min-h-0">
      {layout.showStats && (
        <div className="flex items-stretch gap-1 flex-shrink-0">
          {layout.showSummary && <Stat label="Online" value={`${healthy} / ${total}`} />}
          {layout.showGrabs && <Stat label="Grabs 24h" value={String(data.grabCount24h)} />}
        </div>
      )}

      {layout.showIndexerList && (
        // Larger tiles show the full per-indexer list; it scrolls if it can't
        // all fit so no indexer is ever silently dropped.
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1 border-t border-border pt-2">
          {data.indexers.map((ix) => {
            const dot = !ix.enabled
              ? "bg-muted-foreground"
              : ix.status === "ok"
                ? "bg-green-500"
                : "bg-red-500";
            return (
              <div key={ix.id} className="flex items-center justify-between gap-1.5 text-xs">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${dot}`} />
                  <span className="truncate">{ix.name}</span>
                </span>
                {!ix.enabled ? (
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex-shrink-0">
                    Disabled
                  </span>
                ) : ix.status === "failing" ? (
                  <span className="text-[10px] uppercase tracking-wider text-red-500 flex-shrink-0">
                    Failing
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {showHealthSection && (
        <div className="space-y-1 border-t border-border pt-2 flex-shrink-0">
          {issues.map((issue, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-amber-500">
              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span className="min-w-0 leading-tight">{issue.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
