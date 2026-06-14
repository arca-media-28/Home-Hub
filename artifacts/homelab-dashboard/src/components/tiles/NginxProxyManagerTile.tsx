import {
  useGetNginxProxyManagerData,
  getGetNginxProxyManagerDataQueryKey,
} from "@workspace/api-client-react";
import { Network, Lock, LockOpen, ShieldAlert } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "warn" | "danger";
}) {
  const color =
    tone === "danger" && value > 0
      ? "text-red-500"
      : tone === "warn" && value > 0
        ? "text-amber-500"
        : "text-foreground";
  return (
    <div className="flex flex-col items-center justify-center flex-1 min-w-0">
      <span className={`text-lg font-bold tabular-nums leading-none ${color}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1 text-center">
        {label}
      </span>
    </div>
  );
}

export default function NginxProxyManagerTile({ enabled, density }: WidgetProps) {
  const { data, isLoading, isError } = useGetNginxProxyManagerData({
    query: { queryKey: getGetNginxProxyManagerDataQueryKey(), refetchInterval: 60_000 },
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
        <Network className="w-5 h-5 opacity-50" />
        <span>Nginx Proxy Manager unavailable</span>
      </div>
    );
  }

  const showHosts = enabled.has("hosts");
  const showDead = enabled.has("dead");
  const showSsl = enabled.has("ssl");
  const anyMetric = showHosts || showDead || showSsl;

  // The host list is the verbose section: reveal it once the tile has grown.
  const showList = showHosts && density.expanded && data.proxyHosts.length > 0;
  const hosts = showList ? data.proxyHosts.slice(0, density.listLimit) : [];

  return (
    <div className="w-full h-full p-3 flex flex-col gap-2">
      {anyMetric ? (
        <div className="flex items-stretch gap-1">
          {showHosts && <Stat label="Enabled" value={data.enabled} tone="default" />}
          {showDead && <Stat label="Offline" value={data.offline + data.deadHostsCount} tone="danger" />}
          {showSsl && <Stat label="SSL warn" value={data.expiringCertsCount} tone="warn" />}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-xs">
          No metrics selected
        </div>
      )}

      {showList && (
        <div className="space-y-1 border-t border-border pt-2 mt-auto overflow-y-auto">
          {hosts.map((host) => {
            const domain = host.domainNames[0] ?? `Host #${host.id}`;
            return (
              <div key={host.id} className="flex items-center justify-between gap-1.5 text-xs">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                      !host.enabled ? "bg-muted-foreground" : host.online ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <span className="truncate">{domain}</span>
                </span>
                {host.ssl ? (
                  host.sslExpiring ? (
                    <ShieldAlert className="w-3 h-3 flex-shrink-0 text-amber-500" />
                  ) : (
                    <Lock className="w-3 h-3 flex-shrink-0 text-green-500" />
                  )
                ) : (
                  <LockOpen className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
