// Single source of display metadata (icon + one-line description) for every
// integration a tile can attach. Names live with the INTEGRATIONS list in the
// tile editor and the category grouping lives in integrationCategories; this
// file only adds the icon and blurb each integration card needs in the
// app-store style picker. Keyed by TileIntegration value, plus a "none" entry.

import {
  AppWindow,
  Clapperboard,
  Film,
  Tv,
  Disc3,
  Download,
  Server,
  ShieldBan,
  Network,
  Search,
  Waypoints,
  Radio,
  Music,
  Clock,
  Timer,
  CloudSun,
  Trophy,
  Shirt,
  Newspaper,
  TrendingUp,
  CircleHelp,
  Dices,
  Coins,
  Cookie,
  PawPrint,
  Sprout,
  StickyNote,
  SquareDashed,
  Heading,
  type LucideIcon,
} from "lucide-react";
import { TileIntegration } from "@workspace/api-client-react";

export const NONE = "none";

export interface IntegrationMeta {
  icon: LucideIcon;
  description: string;
}

// Icon + short description for each integration value. Labels come from the
// INTEGRATIONS list (the tile editor) so there is no duplicate name vocabulary.
export const INTEGRATION_META: Record<string, IntegrationMeta> = {
  [NONE]: {
    icon: AppWindow,
    description: "A plain app shortcut with no live data.",
  },
  [TileIntegration.media]: {
    icon: Clapperboard,
    description: "Now playing and recently added on Plex.",
  },
  [TileIntegration.jellyfin]: {
    icon: Film,
    description: "Now playing and recently added on Jellyfin.",
  },
  [TileIntegration.sonarr]: {
    icon: Tv,
    description: "TV show downloads and upcoming episodes.",
  },
  [TileIntegration.radarr]: {
    icon: Clapperboard,
    description: "Movie downloads and upcoming releases.",
  },
  [TileIntegration.lidarr]: {
    icon: Disc3,
    description: "Music downloads and recent additions.",
  },
  [TileIntegration.qbittorrent]: {
    icon: Download,
    description: "Active torrents and transfer speeds.",
  },
  [TileIntegration.truenas]: {
    icon: Server,
    description: "Storage pools, disks, and system health.",
  },
  [TileIntegration.pihole]: {
    icon: ShieldBan,
    description: "DNS queries blocked and allowed.",
  },
  [TileIntegration["nginx-proxy-manager"]]: {
    icon: Network,
    description: "Reverse proxy hosts and SSL status.",
  },
  [TileIntegration.prowlarr]: {
    icon: Search,
    description: "Indexer health and recent grabs.",
  },
  [TileIntegration.tailscale]: {
    icon: Waypoints,
    description: "Your tailnet devices and their status.",
  },
  [TileIntegration.ersatztv]: {
    icon: Radio,
    description: "Your custom IPTV channels and what's on.",
  },
  [TileIntegration.audioplayer]: {
    icon: Music,
    description: "Stream music from your media server.",
  },
  [TileIntegration.clock]: {
    icon: Clock,
    description: "Current local time and date.",
  },
  [TileIntegration.timer]: {
    icon: Timer,
    description: "Countdown, stopwatch, or Pomodoro timer.",
  },
  [TileIntegration.weather]: {
    icon: CloudSun,
    description: "Current conditions and forecast.",
  },
  [TileIntegration.sports]: {
    icon: Trophy,
    description: "Live scores and schedules for your teams.",
  },
  [TileIntegration.sleeper]: {
    icon: Shirt,
    description: "Your fantasy matchups and scores.",
  },
  [TileIntegration.news]: {
    icon: Newspaper,
    description: "Latest headlines from your feeds.",
  },
  [TileIntegration.stocks]: {
    icon: TrendingUp,
    description: "Track stock and crypto prices.",
  },
  [TileIntegration.eightball]: {
    icon: CircleHelp,
    description: "Ask a yes/no question, get an answer.",
  },
  [TileIntegration.dice]: {
    icon: Dices,
    description: "Roll a handful of virtual dice.",
  },
  [TileIntegration.coinflip]: {
    icon: Coins,
    description: "Flip a coin: heads or tails.",
  },
  [TileIntegration.fortune]: {
    icon: Cookie,
    description: "A random fortune cookie message.",
  },
  [TileIntegration.tamagotchi]: {
    icon: PawPrint,
    description: "Care for a virtual pet.",
  },
  [TileIntegration.bonsai]: {
    icon: Sprout,
    description: "Grow and tend a living bonsai tree.",
  },
  [TileIntegration.note]: {
    icon: StickyNote,
    description: "A sticky note for reminders or lists.",
  },
  [TileIntegration.spacer]: {
    icon: SquareDashed,
    description: "An invisible gap to shape your layout.",
  },
  [TileIntegration.divider]: {
    icon: Heading,
    description: "A section heading to group tiles.",
  },
};

// Look up an integration's display metadata, falling back to the generic app
// shortcut look so a newly added integration always renders something.
export function integrationMeta(value: string): IntegrationMeta {
  return INTEGRATION_META[value] ?? INTEGRATION_META[NONE];
}

// Maps a tile integration value to the service-connection key whose
// reachability status applies to it. Only integrations backed by a saved
// connection appear here; everything else has no reachability to show.
export const INTEGRATION_SERVICE: Record<string, string> = {
  [TileIntegration.truenas]: "truenas",
  [TileIntegration.media]: "plex",
  [TileIntegration.sonarr]: "sonarr",
  [TileIntegration.radarr]: "radarr",
  [TileIntegration.qbittorrent]: "qbittorrent",
  [TileIntegration.pihole]: "pihole",
  [TileIntegration["nginx-proxy-manager"]]: "nginx-proxy-manager",
};
