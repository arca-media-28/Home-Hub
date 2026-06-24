import { useEffect, useRef, useState } from "react";
import type { Tile, ServiceStatus, TileSettings } from "@workspace/api-client-react";
import { TileIntegration } from "@workspace/api-client-react";
import { ExternalLink } from "lucide-react";
import TruenasTile from "./TruenasTile";
import MediaTile from "./MediaTile";
import SonarrTile from "./SonarrTile";
import RadarrTile from "./RadarrTile";
import LidarrTile from "./LidarrTile";
import QbittorrentTile from "./QbittorrentTile";
import PiholeTile from "./PiholeTile";
import NginxProxyManagerTile from "./NginxProxyManagerTile";
import ProwlarrTile from "./ProwlarrTile";
import TailscaleTile from "./TailscaleTile";
import ErsatztvTile from "./ErsatztvTile";
import ClockTile from "./ClockTile";
import WeatherTile from "./WeatherTile";
import SportsTile from "./SportsTile";
import NewsTile from "./NewsTile";
import StocksTile from "./StocksTile";
import SleeperTile from "./SleeperTile";
import AudioPlayerTile from "./AudioPlayerTile";
import { resolveEnabledMetrics, tileDensity, type TileDensity } from "./metrics";
import { resolveImageStyle } from "./imageStyle";
import { openTileUrl } from "@/lib/utils";

export const INTEGRATION_LABELS: Record<string, string> = {
  [TileIntegration.truenas]: "TrueNAS",
  [TileIntegration.media]: "Plex",
  [TileIntegration.jellyfin]: "Jellyfin",
  [TileIntegration.sonarr]: "Sonarr",
  [TileIntegration.radarr]: "Radarr",
  [TileIntegration.lidarr]: "Lidarr",
  [TileIntegration.qbittorrent]: "qBittorrent",
  [TileIntegration.pihole]: "Pi-hole",
  [TileIntegration["nginx-proxy-manager"]]: "Nginx Proxy Manager",
  [TileIntegration.prowlarr]: "Prowlarr",
  [TileIntegration.tailscale]: "Tailscale",
  [TileIntegration.ersatztv]: "ErsatzTV",
  [TileIntegration.clock]: "Local Time",
  [TileIntegration.timer]: "Timer",
  [TileIntegration.weather]: "Weather",
  [TileIntegration.sports]: "Sports",
  [TileIntegration.news]: "News",
  [TileIntegration.stocks]: "Stocks",
  [TileIntegration.sleeper]: "Fantasy",
  [TileIntegration.audioplayer]: "Audio Player",
};

// Props every integration widget receives: the resolved set of enabled metric
// keys and the size-derived density.
export interface WidgetProps {
  enabled: Set<string>;
  density: TileDensity;
  // Per-tile extra config. Only qBittorrent uses it (category filter) for now;
  // other widgets ignore it.
  tileSettings?: TileSettings | null;
  // The tile's integration value. MediaTile uses it to pick the backing media
  // server (Plex vs Jellyfin); other widgets ignore it.
  integration: string;
}

function renderStatusView(integration: string, props: WidgetProps) {
  switch (integration) {
    case TileIntegration.truenas:
      return <TruenasTile {...props} />;
    case TileIntegration.media:
    case TileIntegration.jellyfin:
      return <MediaTile {...props} />;
    case TileIntegration.sonarr:
      return <SonarrTile {...props} />;
    case TileIntegration.radarr:
      return <RadarrTile {...props} />;
    case TileIntegration.lidarr:
      return <LidarrTile {...props} />;
    case TileIntegration.qbittorrent:
      return <QbittorrentTile {...props} />;
    case TileIntegration.pihole:
      return <PiholeTile {...props} />;
    case TileIntegration["nginx-proxy-manager"]:
      return <NginxProxyManagerTile {...props} />;
    case TileIntegration.prowlarr:
      return <ProwlarrTile {...props} />;
    case TileIntegration.tailscale:
      return <TailscaleTile {...props} />;
    case TileIntegration.ersatztv:
      return <ErsatztvTile {...props} />;
    case TileIntegration.clock:
      return <ClockTile {...props} />;
    case TileIntegration.weather:
      return <WeatherTile {...props} />;
    case TileIntegration.sports:
      return <SportsTile {...props} />;
    case TileIntegration.news:
      return <NewsTile {...props} />;
    case TileIntegration.stocks:
      return <StocksTile {...props} />;
    case TileIntegration.sleeper:
      return <SleeperTile {...props} />;
    case TileIntegration.audioplayer:
      return <AudioPlayerTile {...props} />;
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
  // No explicit per-tile color → follow the active theme's card surface.
  const bg = tile.bgColor || "hsl(var(--card))";
  const label = tile.name || INTEGRATION_LABELS[integration] || "App";

  const image = resolveImageStyle(tile);

  // A small reachability dot in the header. Only shown once a connection has
  // been saved for the backing service.
  const showDot = Boolean(status?.configured);
  const dotColor = status?.ok ? "bg-green-500" : "bg-red-500";

  // Resolve which metrics this tile shows.
  const enabled = resolveEnabledMetrics(integration, tile.metrics);

  // Measure the live-status body's real pixel size so reveal decisions are based
  // on the room content actually has, not a grid-unit approximation. The grid
  // dimensions seed the first paint before the observer reports a measurement.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setMeasured({ width: cr.width, height: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The reachability dot, shared between the header and the collapsed-header
  // overlay so the indicator survives hiding the title.
  const statusDot = showDot ? (
    <span className="flex h-2 w-2 flex-shrink-0">
      {status?.ok && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500/60" />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${dotColor}`} />
    </span>
  ) : null;

  // With the title hidden the header only earns its fixed height when the tile
  // image fills it (the image becomes the icon). Without an image the header
  // would be an empty colored bar — an awkward gap — so we drop it and float
  // the status dot / open-link affordance over the widget body instead.
  const showHeader = !tile.hideTitle || hasImage;

  // When enabled, the live-status body scrolls instead of clipping overflowing
  // content. The header (and its image background) stay fixed and clipped.
  const scrollable = Boolean(tile.tileSettings?.scrollable);

  // Density from the measured body (or grid-seeded for first paint). The seed
  // needs to know whether the header occupies space; `scrollable` makes reveal
  // budgets unbounded so widgets render everything for the body to scroll.
  const density = tileDensity(tile.gridW, tile.gridH, measured, showHeader, scrollable);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Styled header carrying the tile's custom name, background and image. */}
      {showHeader && (
        <div
          className="relative h-11 flex-shrink-0 overflow-hidden flex items-center px-3 gap-1.5 group/header select-none"
          style={{ background: bg }}
          onClick={() => openTileUrl(tile.url)}
          role={tile.url ? "link" : undefined}
          title={tile.url || undefined}
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        >
          {hasImage && (
            <div className={image.wrapperClassName} style={image.wrapperStyle}>
              <img
                src={tile.imageUrl!}
                alt={tile.name || "tile"}
                className={image.className}
                style={image.style}
                draggable={false}
              />
            </div>
          )}
          <div className="absolute inset-0 bg-black/20 group-hover/header:bg-black/30 transition-colors" />

          {statusDot && <span className="relative z-10">{statusDot}</span>}

          {!tile.hideTitle && (
            <span
              className="relative z-10 font-bold text-sm leading-tight tracking-wide truncate drop-shadow-sm"
              style={{ color: hasImage ? "#fff" : "inherit" }}
            >
              {label}
            </span>
          )}

          {tile.url && (
            <ExternalLink
              className="relative z-10 w-3 h-3 flex-shrink-0 opacity-0 group-hover/header:opacity-70 transition-opacity"
              style={{ color: hasImage ? "#fff" : "inherit" }}
            />
          )}
        </div>
      )}

      {/* Live-status section sourced from the integration. Size + the user's
          metric selection drive how much detail is shown. When the header is
          collapsed, the status dot / open-link float here so neither is lost. */}
      <div
        ref={bodyRef}
        className={`relative flex-1 min-h-0 ${scrollable ? "overflow-auto" : "overflow-hidden"} ${showHeader ? "border-t border-border" : ""}`}
      >
        {!showHeader && (statusDot || tile.url) && (
          <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1.5">
            {statusDot}
            {tile.url && (
              <button
                type="button"
                onClick={() => openTileUrl(tile.url)}
                title={tile.url}
                aria-label="Open"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
        {scrollable ? (
          // The widget roots are `h-full`; inside this auto-height wrapper that
          // resolves to their content height, so they grow past the body (which
          // scrolls) instead of pinning to it and clipping. `min-h-full` keeps a
          // short widget filling the body as before.
          <div className="min-h-full">
            {renderStatusView(integration, { enabled, density, tileSettings: tile.tileSettings, integration })}
          </div>
        ) : (
          renderStatusView(integration, { enabled, density, tileSettings: tile.tileSettings, integration })
        )}
      </div>
    </div>
  );
}
