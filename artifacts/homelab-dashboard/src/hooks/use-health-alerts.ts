import { useEffect, useRef } from "react";
import {
  useGetConnectionHealth,
  getGetConnectionHealthQueryKey,
  type ConnectionHealth,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const SERVICE_NAMES: Record<string, string> = {
  truenas: "TrueNAS",
  plex: "Plex",
  sonarr: "Sonarr",
  radarr: "Radarr",
  qbittorrent: "qBittorrent",
};

function displayName(service: string): string {
  return SERVICE_NAMES[service] ?? service;
}

const POLL_INTERVAL_MS = 30_000;

// Polls the background health endpoint and raises a toast when a service that
// was previously reachable becomes unreachable (and a quieter one when it
// recovers). The first poll only seeds the baseline so a stale-on-load failure
// doesn't fire an alert the moment the dashboard opens.
export function useHealthAlerts(enabled: boolean) {
  const { toast } = useToast();
  const previous = useRef<Map<string, boolean> | null>(null);

  const { data } = useGetConnectionHealth({
    query: {
      queryKey: getGetConnectionHealthQueryKey(),
      enabled,
      refetchInterval: POLL_INTERVAL_MS,
    },
  });

  useEffect(() => {
    if (!data) return;

    const current = new Map<string, boolean>(
      data.map((h: ConnectionHealth) => [h.service, h.ok]),
    );

    // First successful poll just establishes the baseline.
    if (previous.current === null) {
      previous.current = current;
      return;
    }

    const prev = previous.current;
    for (const h of data) {
      const wasOk = prev.get(h.service);
      if (wasOk === undefined) continue;

      if (wasOk && !h.ok) {
        toast({
          title: `${displayName(h.service)} is down`,
          description: h.message,
          variant: "destructive",
        });
      } else if (!wasOk && h.ok) {
        toast({
          title: `${displayName(h.service)} is back online`,
        });
      }
    }

    previous.current = current;
  }, [data, toast]);
}
