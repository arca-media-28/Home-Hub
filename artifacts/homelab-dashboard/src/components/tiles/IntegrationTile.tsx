import type { Tile, ServiceStatus } from "@workspace/api-client-react";
import { TileIntegration } from "@workspace/api-client-react";
import { ExternalLink } from "lucide-react";
import TruenasTile from "./TruenasTile";
import MediaTile from "./MediaTile";
import SonarrTile from "./SonarrTile";
import RadarrTile from "./RadarrTile";
import QbittorrentTile from "./QbittorrentTile";

export const INTEGRATION_LABELS: Record<string, string> = {
  [TileIntegration.truenas]: "TrueNAS",
  [TileIntegration.media]: "Media Server",
  [TileIntegration.sonarr]: "Sonarr",
  [TileIntegration.radarr]: "Radarr",
  [TileIntegration.qbittorrent]: "qBittorrent",
};

function renderStatusView(integration: string) {
  switch (integration) {
    case TileIntegration.truenas:
      return <TruenasTile />;
    case TileIntegration.media:
      return <MediaTile />;
    case TileIntegration.sonarr:
      return <SonarrTile />;
    case TileIntegration.radarr:
      return <RadarrTile />;
    case TileIntegration.qbittorrent:
      return <QbittorrentTile />;
    default:
      return null;
  }
}

interface IntegrationTileProps {
  tile: Tile;
  status?: ServiceStatus;
}

export default function IntegrationTile({ tile, status }: IntegrationTileProps) {
  const integration = tile.integration!;
  const hasImage = Boolean(tile.imageUrl);
  const bg = tile.bgColor || "hsl(240 6% 12%)";
  const label = tile.name || INTEGRATION_LABELS[integration] || "App";

  const imageFitClass = (() => {
    switch (tile.imageFit) {
      case "cover": return "object-cover";
      case "contain": return "object-contain";
      case "center": return "object-none object-center";
      case "top-left": return "object-none object-left-top";
      default: return "object-cover";
    }
  })();

  // A small reachability dot in the header. Only shown once a connection has
  // been saved for the backing service.
  const showDot = Boolean(status?.configured);
  const dotColor = status?.ok ? "bg-green-500" : "bg-red-500";

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Styled header carrying the tile's custom name, background and image. */}
      <div
        className="relative h-11 flex-shrink-0 overflow-hidden flex items-center px-3 gap-1.5 group/header select-none"
        style={{ background: hasImage ? undefined : bg }}
        onClick={() => tile.url && window.open(tile.url, "_blank", "noopener,noreferrer")}
        role={tile.url ? "link" : undefined}
        title={tile.url || undefined}
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      >
        {hasImage && (
          <img
            src={tile.imageUrl!}
            alt={tile.name || "tile"}
            className={`absolute inset-0 w-full h-full ${imageFitClass}`}
            draggable={false}
          />
        )}
        <div className="absolute inset-0 bg-black/20 group-hover/header:bg-black/30 transition-colors" />

        {showDot && (
          <span className="relative z-10 flex h-2 w-2 flex-shrink-0">
            {status?.ok && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500/60" />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${dotColor}`} />
          </span>
        )}

        <span
          className="relative z-10 font-bold text-sm leading-tight tracking-wide truncate drop-shadow-sm"
          style={{ color: hasImage ? "#fff" : "inherit" }}
        >
          {label}
        </span>

        {tile.url && (
          <ExternalLink
            className="relative z-10 w-3 h-3 flex-shrink-0 opacity-0 group-hover/header:opacity-70 transition-opacity"
            style={{ color: hasImage ? "#fff" : "inherit" }}
          />
        )}
      </div>

      {/* Compact live-status section sourced from the integration. */}
      <div className="flex-1 min-h-0 overflow-hidden border-t border-border">
        {renderStatusView(integration)}
      </div>
    </div>
  );
}
