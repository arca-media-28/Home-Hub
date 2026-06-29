import { useState, useEffect, useRef } from "react";
import { HexColorPicker } from "react-colorful";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import IntegrationPicker from "@/components/IntegrationPicker";
import { integrationMeta } from "@/lib/integrationMeta";
import {
  METRIC_CATALOG,
  allMetricKeys,
  TRUENAS_METRIC_VARIANTS,
  truenasMetricVariant,
  filterTruenasPools,
} from "@/components/tiles/metrics";
import {
  resolveImageStyle,
  resolveTitleStyle,
  normalizePlacement,
  isPan,
  parsePan,
  formatPan,
  FIT_OPTIONS,
  POSITION_OPTIONS,
  DEFAULT_NEW_FIT,
  DEFAULT_PAN,
  DEFAULT_SCALE,
  MIN_SCALE,
  MAX_SCALE,
  TITLE_SIZE_OPTIONS,
  DEFAULT_TITLE_SIZE,
  DEFAULT_TITLE_POSITION,
  type FitValue,
  type PositionKey,
  type TitleSize,
} from "@/components/tiles/imageStyle";
import {
  NOTE_PRESET_COLORS,
  NOTE_FONT_SIZES,
  DEFAULT_NOTE_COLOR,
  DEFAULT_NOTE_TEXT_COLOR,
  type NoteFontSize,
} from "@/components/tiles/NoteTile";
import {
  DEFAULT_TIMER_DURATION_SECONDS,
  DEFAULT_POMODORO_FOCUS_MIN,
  DEFAULT_POMODORO_SHORT_BREAK_MIN,
  DEFAULT_POMODORO_LONG_BREAK_MIN,
  DEFAULT_POMODORO_SESSIONS,
} from "@/components/tiles/TimerTile";
import {
  TIMER_ALERT_SOUND_OPTIONS,
  DEFAULT_TIMER_ALERT_SOUND,
  playTimerSound,
  type TimerAlertSound,
} from "@/lib/timerAlert";
import {
  DICE_TYPES,
  DEFAULT_DICE_TYPE,
  DEFAULT_DICE_COUNT,
  MIN_DICE_COUNT,
  MAX_DICE_COUNT,
  type DiceType,
} from "@/components/tiles/DiceTile";
import {
  PET_BODY_COLORS,
  PET_EYES_OPTIONS,
  PET_NOSE_OPTIONS,
  PET_MOUTH_OPTIONS,
  DEFAULT_BODY_COLOR,
  DEFAULT_EYES,
  DEFAULT_NOSE,
  DEFAULT_MOUTH,
  PetFace,
  type EyeStyle,
  type NoseStyle,
  type MouthStyle,
} from "@/components/tiles/TamagotchiTile";
import {
  BONSAI_POT_COLORS,
  BONSAI_LEAF_COLORS,
  BONSAI_BLOSSOM_COLORS,
  BONSAI_STYLE_OPTIONS,
  DEFAULT_POT_COLOR,
  DEFAULT_LEAF_COLOR,
  DEFAULT_BLOSSOM,
  DEFAULT_STYLE,
  BonsaiPreview,
  type BonsaiStyle,
} from "@/components/tiles/BonsaiTile";
import { SPORTS_LEAGUES, getLeagueTeams } from "@/lib/sports";
import {
  fetchSleeperUser,
  fetchUserLeagues,
  SLEEPER_SPORTS,
  type SleeperLeague,
} from "@/lib/sleeper";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateTile,
  useUpdateTile,
  useDeleteTile,
  useListUploads,
  useDeleteUpload,
  useGetQbittorrentStatus,
  getListUploadsQueryKey,
  getGetQbittorrentStatusQueryKey,
  useSearchStocks,
  getSearchStocksQueryKey,
  getNewsWidget,
  useGetConnectionsStatus,
  getGetConnectionsStatusQueryKey,
  useGetTruenasMetrics,
  getGetTruenasMetricsQueryKey,
  TileType,
  TileIntegration,
  type Tile,
  type TileSettings,
  type StockWatchEntry,
  type NewsItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, X, Pipette, RotateCcw, ChevronUp, ChevronDown } from "lucide-react";

export type EditMode = "create" | "edit";

interface TileEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tile?: Tile;
  mode: EditMode;
  // Grid slot a brand-new tile should occupy. Computed by the dashboard from the
  // first empty cell that fits the default tile size; only used when creating.
  defaultGridPos?: { x: number; y: number };
  // The page a brand-new tile should be created on (the active page). Only used
  // when creating; edits keep the tile on its existing page.
  pageId?: number | null;
}

const NONE = "none";

// CSS value used to preview a theme-default tile background. When a tile has no
// explicit per-tile bgColor it follows the active theme's card surface, so the
// editor swatch/preview shows the same token instead of a baked-in hex.
const THEME_BG_PREVIEW = "hsl(var(--card))";
// Neutral starting point for the color picker when opening it on a theme-default
// tile (the first drag turns the background into an explicit color). A mid-gray
// avoids accidentally committing near-black when the user just grazes the picker.
const PICKER_FALLBACK = "#888888";

// Optional integrations a tile can attach. "None" keeps the tile a plain
// app/link shortcut.
// Selectable integrations (excluding "None"), grouped into categories at render
// time. Order within this list is the within-category order shown in the
// dropdown.
const INTEGRATIONS = [
  { value: TileIntegration.media, label: "Plex" },
  { value: TileIntegration.jellyfin, label: "Jellyfin" },
  { value: TileIntegration.sonarr, label: "Sonarr" },
  { value: TileIntegration.radarr, label: "Radarr" },
  { value: TileIntegration.lidarr, label: "Lidarr" },
  { value: TileIntegration.qbittorrent, label: "qBittorrent" },
  { value: TileIntegration.truenas, label: "TrueNAS" },
  { value: TileIntegration.pihole, label: "Pi-hole" },
  { value: TileIntegration["nginx-proxy-manager"], label: "Nginx Proxy Manager" },
  { value: TileIntegration.prowlarr, label: "Prowlarr" },
  { value: TileIntegration.tailscale, label: "Tailscale" },
  { value: TileIntegration.ersatztv, label: "ErsatzTV" },
  { value: TileIntegration.audioplayer, label: "Audio Player" },
  { value: TileIntegration.clock, label: "Local Time" },
  { value: TileIntegration.timer, label: "Timer" },
  { value: TileIntegration.weather, label: "Weather" },
  { value: TileIntegration.sports, label: "Sports" },
  { value: TileIntegration.sleeper, label: "Fantasy" },
  { value: TileIntegration.news, label: "News" },
  { value: TileIntegration.stocks, label: "Stocks" },
  { value: TileIntegration.eightball, label: "Magic Eight Ball" },
  { value: TileIntegration.dice, label: "Dice Roller" },
  { value: TileIntegration.coinflip, label: "Coin Flip" },
  { value: TileIntegration.fortune, label: "Fortune" },
  { value: TileIntegration.tamagotchi, label: "Tamagotchi" },
  { value: TileIntegration.bonsai, label: "Bonsai" },
  { value: TileIntegration.note, label: "Note" },
  { value: TileIntegration.spacer, label: "Spacer" },
  { value: TileIntegration.divider, label: "Section Label" },
] as const;

type ImageSource = "upload" | "library" | "url";

export default function TileEditModal({ open, onOpenChange, tile, mode, defaultGridPos, pageId }: TileEditModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const initialPlacement = normalizePlacement(tile ?? {});

  const [integration, setIntegration] = useState<string>(tile?.integration ?? NONE);
  // Controls the app-store style integration picker pop-out.
  const [pickerOpen, setPickerOpen] = useState(false);
  // Service reachability, used to draw a status dot on integration cards in the
  // picker. Only fetched while the picker is open to avoid background polling.
  const { data: connectionStatuses } = useGetConnectionsStatus({
    query: {
      queryKey: getGetConnectionsStatusQueryKey(),
      enabled: open && pickerOpen,
    },
  });
  const [name, setName] = useState(tile?.name ?? "");
  const [url, setUrl] = useState(tile?.url ?? "");
  // null = follow the active theme's card surface; an explicit value overrides it.
  const [bgColor, setBgColor] = useState<string | null>(tile?.bgColor ?? null);
  const [imageUrl, setImageUrl] = useState(tile?.imageUrl ?? "");
  const [imageFit, setImageFit] = useState<FitValue>(initialPlacement.fit);
  const [imagePosition, setImagePosition] = useState<string>(initialPlacement.position);
  const [imageScale, setImageScale] = useState<number>(initialPlacement.scale);
  const [imageSource, setImageSource] = useState<ImageSource>("upload");
  const [titleSize, setTitleSize] = useState<TitleSize>(
    (tile?.titleSize as TitleSize) ?? DEFAULT_TITLE_SIZE,
  );
  const [titlePosition, setTitlePosition] = useState<PositionKey>(
    (tile?.titlePosition as PositionKey) ?? DEFAULT_TITLE_POSITION,
  );
  // null = automatic title color (white over image, theme color otherwise).
  const [titleColor, setTitleColor] = useState<string | null>(tile?.titleColor ?? null);
  // When true, the tile renders without its title text (icon-only look).
  const [hideTitle, setHideTitle] = useState<boolean>(tile?.hideTitle ?? false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showTitleColorPicker, setShowTitleColorPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Selected metric keys for the active integration. null = "show all"
  // (backward-compatible default); an explicit array (incl. empty) is honored.
  const [metrics, setMetrics] = useState<string[] | null>(tile?.metrics ?? null);
  // Which single TrueNAS metric this tile renders (its bespoke "live tile"
  // variant). null = the combined multi-section TrueNAS view (legacy default).
  const [truenasMetric, setTruenasMetric] = useState<
    NonNullable<TileSettings>["truenasMetric"]
  >(tile?.tileSettings?.truenasMetric ?? null);
  // TrueNAS volume (ZFS pool) allow-list. null/empty = "show all volumes"; an
  // explicit array narrows both the dedicated ZFS Pools view and the pools
  // section of the combined view to those volumes.
  const [truenasPools, setTruenasPools] = useState<string[] | null>(
    tile?.tileSettings?.truenasPools ?? null,
  );
  // Explicit display order of TrueNAS volumes (ZFS pools). null/empty = keep the
  // server-reported order (backward-compatible default). Volumes listed here are
  // pinned to the top in this order; the rest follow in server order.
  const [truenasPoolOrder, setTruenasPoolOrder] = useState<string[] | null>(
    tile?.tileSettings?.truenasPoolOrder ?? null,
  );
  // qBittorrent category allow-list. null = "show all categories"; an explicit
  // array narrows the tile's torrent list to those categories.
  const [categoryFilter, setCategoryFilter] = useState<string[] | null>(
    tile?.tileSettings?.categoryFilter ?? null,
  );
  // When true, the qBittorrent tile groups torrents under category headers
  // instead of a flat list. Defaults to false (flat list).
  const [groupByCategory, setGroupByCategory] = useState<boolean>(
    tile?.tileSettings?.groupByCategory ?? false,
  );
  // Local Time (clock) widget options.
  const [clockFormat, setClockFormat] = useState<"12" | "24">(
    tile?.tileSettings?.clockFormat ?? "24",
  );
  const [clockShowSeconds, setClockShowSeconds] = useState<boolean>(
    tile?.tileSettings?.clockShowSeconds ?? false,
  );
  const [clockShowDate, setClockShowDate] = useState<boolean>(
    tile?.tileSettings?.clockShowDate ?? false,
  );
  // Timer widget options. The countdown starting duration is edited as
  // hours/minutes/seconds and combined into timerDuration (seconds) on save.
  const initialTimerDuration =
    tile?.tileSettings?.timerDuration ?? DEFAULT_TIMER_DURATION_SECONDS;
  const [timerMode, setTimerMode] = useState<"countup" | "countdown" | "pomodoro">(
    tile?.tileSettings?.timerMode ?? "countup",
  );
  const [timerHours, setTimerHours] = useState<number>(
    Math.floor(initialTimerDuration / 3600),
  );
  const [timerMinutes, setTimerMinutes] = useState<number>(
    Math.floor((initialTimerDuration % 3600) / 60),
  );
  const [timerSeconds, setTimerSeconds] = useState<number>(
    initialTimerDuration % 60,
  );
  // Pomodoro options (lengths in minutes + sessions before a long break).
  const [pomodoroFocusMinutes, setPomodoroFocusMinutes] = useState<number>(
    tile?.tileSettings?.pomodoroFocusMinutes ?? DEFAULT_POMODORO_FOCUS_MIN,
  );
  const [pomodoroShortBreakMinutes, setPomodoroShortBreakMinutes] = useState<number>(
    tile?.tileSettings?.pomodoroShortBreakMinutes ?? DEFAULT_POMODORO_SHORT_BREAK_MIN,
  );
  const [pomodoroLongBreakMinutes, setPomodoroLongBreakMinutes] = useState<number>(
    tile?.tileSettings?.pomodoroLongBreakMinutes ?? DEFAULT_POMODORO_LONG_BREAK_MIN,
  );
  const [pomodoroSessionsBeforeLongBreak, setPomodoroSessionsBeforeLongBreak] =
    useState<number>(
      tile?.tileSettings?.pomodoroSessionsBeforeLongBreak ?? DEFAULT_POMODORO_SESSIONS,
    );
  // Whether a finished countdown plays a chime + fires a browser notification.
  const [timerAlertEnabled, setTimerAlertEnabled] = useState<boolean>(
    tile?.tileSettings?.timerAlertEnabled ?? false,
  );
  // Which alert sound plays when the timer alerts (or "none" for notify-only).
  const [timerAlertSound, setTimerAlertSound] = useState<TimerAlertSound>(
    (tile?.tileSettings?.timerAlertSound as TimerAlertSound | undefined) ??
      DEFAULT_TIMER_ALERT_SOUND,
  );
  // Dice Roller options: which die type to roll and how many.
  const [diceType, setDiceType] = useState<DiceType>(
    tile?.tileSettings?.diceType ?? DEFAULT_DICE_TYPE,
  );
  const [diceCount, setDiceCount] = useState<number>(
    tile?.tileSettings?.diceCount ?? DEFAULT_DICE_COUNT,
  );
  // Weather widget options.
  const [weatherAutoLocate, setWeatherAutoLocate] = useState<boolean>(
    tile?.tileSettings?.weatherAutoLocate ?? true,
  );
  const [weatherLocation, setWeatherLocation] = useState<string>(
    tile?.tileSettings?.weatherLocation ?? "",
  );
  const [weatherUnits, setWeatherUnits] = useState<"c" | "f">(
    tile?.tileSettings?.weatherUnits ?? "c",
  );
  // Sports widget options.
  const [sportsLeagues, setSportsLeagues] = useState<string[]>(
    tile?.tileSettings?.sportsLeagues ?? [],
  );
  const [sportsTeams, setSportsTeams] = useState<string[]>(
    tile?.tileSettings?.sportsTeams ?? [],
  );
  const [sportsShowScores, setSportsShowScores] = useState<boolean>(
    tile?.tileSettings?.sportsShowScores ?? true,
  );
  const [sportsShowNews, setSportsShowNews] = useState<boolean>(
    tile?.tileSettings?.sportsShowNews ?? false,
  );
  // News (RSS/Atom) widget options.
  const [newsFeedUrl, setNewsFeedUrl] = useState<string>(
    tile?.tileSettings?.newsFeedUrl ?? "",
  );
  const [newsMaxItems, setNewsMaxItems] = useState<number>(
    tile?.tileSettings?.newsMaxItems ?? 8,
  );
  const [newsShowTimestamp, setNewsShowTimestamp] = useState<boolean>(
    tile?.tileSettings?.newsShowTimestamp ?? false,
  );
  // Inline "Test feed" preview state for the News config block. Lets the user
  // verify a feed URL resolves to real headlines before saving.
  const [newsTestState, setNewsTestState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [newsTestItems, setNewsTestItems] = useState<NewsItem[]>([]);
  const [newsTestTitle, setNewsTestTitle] = useState<string | null>(null);
  const [newsTestError, setNewsTestError] = useState<string | null>(null);
  // Stocks (watchlist) widget options. Each entry holds a symbol plus optional
  // share quantity and cost basis (turning the watchlist into a portfolio).
  const [stockWatchlist, setStockWatchlist] = useState<StockWatchEntry[]>(
    tile?.tileSettings?.stockWatchlist ?? [],
  );
  const [stockSearch, setStockSearch] = useState<string>("");

  // Sleeper (fantasy) widget options.
  const [sleeperUsername, setSleeperUsername] = useState<string>(
    tile?.tileSettings?.sleeperUsername ?? "",
  );
  const [sleeperLeagueId, setSleeperLeagueId] = useState<string>(
    tile?.tileSettings?.sleeperLeagueId ?? "",
  );
  const [sleeperSport, setSleeperSport] = useState<string>(
    tile?.tileSettings?.sleeperSport ?? "nfl",
  );
  const [sleeperSeason, setSleeperSeason] = useState<string>(
    tile?.tileSettings?.sleeperSeason ?? String(new Date().getFullYear()),
  );
  const [sleeperShowMatchup, setSleeperShowMatchup] = useState<boolean>(
    tile?.tileSettings?.sleeperShowMatchup ?? true,
  );
  const [sleeperShowStandings, setSleeperShowStandings] = useState<boolean>(
    tile?.tileSettings?.sleeperShowStandings ?? true,
  );
  const [sleeperShowTransactions, setSleeperShowTransactions] = useState<boolean>(
    tile?.tileSettings?.sleeperShowTransactions ?? true,
  );
  // Lazy-loaded league picker state: leagues fetched once a username + sport +
  // season are known, plus the resolved Sleeper user and any lookup error.
  const [sleeperLeagues, setSleeperLeagues] = useState<SleeperLeague[]>([]);
  const [sleeperLoadState, setSleeperLoadState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [sleeperLoadError, setSleeperLoadError] = useState<string | null>(null);

  // Audio Player widget options. Which music source backs the tile (only Plex
  // is wired up today; this is the seam future sources plug into).
  const [audioSource, setAudioSource] = useState<string>(
    tile?.tileSettings?.audioSource ?? "plex",
  );
  // Music-browser tabs (Plex / Subsonic only). Absent defaults to on.
  const [audioFindMusic, setAudioFindMusic] = useState<boolean>(
    tile?.tileSettings?.audioFindMusic ?? true,
  );
  const [audioSearch, setAudioSearch] = useState<boolean>(
    tile?.tileSettings?.audioSearch ?? true,
  );
  const [audioBrowse, setAudioBrowse] = useState<boolean>(
    tile?.tileSettings?.audioBrowse ?? true,
  );
  const [audioPlaylists, setAudioPlaylists] = useState<boolean>(
    tile?.tileSettings?.audioPlaylists ?? true,
  );

  // Generic per-tile option (applies to every tile): when on, the tile body
  // scrolls instead of clipping content that overflows its grid bounds.
  const [scrollable, setScrollable] = useState<boolean>(
    tile?.tileSettings?.scrollable ?? false,
  );

  // Note (post-it) appearance options. The note's content (body + checklist) is
  // edited in-place on the tile, not here, so the modal only owns its look.
  const [noteColor, setNoteColor] = useState<string>(
    tile?.tileSettings?.noteColor ?? DEFAULT_NOTE_COLOR,
  );
  const [noteFontSize, setNoteFontSize] = useState<NoteFontSize>(
    (tile?.tileSettings?.noteFontSize as NoteFontSize) ?? "md",
  );
  const [noteTextColor, setNoteTextColor] = useState<string>(
    tile?.tileSettings?.noteTextColor ?? DEFAULT_NOTE_TEXT_COLOR,
  );
  const [showNoteColorPicker, setShowNoteColorPicker] = useState(false);

  // Tamagotchi appearance options. The pet's stats (hunger/happiness/energy)
  // live on the tile itself and are preserved on save; only the look is edited
  // here.
  const [petBodyColor, setPetBodyColor] = useState<string>(
    tile?.tileSettings?.petBodyColor ?? DEFAULT_BODY_COLOR,
  );
  const [petEyes, setPetEyes] = useState<EyeStyle>(
    (tile?.tileSettings?.petEyes as EyeStyle) ?? DEFAULT_EYES,
  );
  const [petNose, setPetNose] = useState<NoseStyle>(
    (tile?.tileSettings?.petNose as NoseStyle) ?? DEFAULT_NOSE,
  );
  const [petMouth, setPetMouth] = useState<MouthStyle>(
    (tile?.tileSettings?.petMouth as MouthStyle) ?? DEFAULT_MOUTH,
  );
  const [showPetColorPicker, setShowPetColorPicker] = useState(false);
  const [showNoteTextColorPicker, setShowNoteTextColorPicker] = useState(false);

  // Bonsai appearance options. The tree's live state (hydration/overgrowth/
  // growth) lives on the tile and is preserved on save; only the look is edited
  // here.
  const [bonsaiPotColor, setBonsaiPotColor] = useState<string>(
    tile?.tileSettings?.bonsaiPotColor ?? DEFAULT_POT_COLOR,
  );
  const [bonsaiLeafColor, setBonsaiLeafColor] = useState<string>(
    tile?.tileSettings?.bonsaiLeafColor ?? DEFAULT_LEAF_COLOR,
  );
  const [bonsaiBlossom, setBonsaiBlossom] = useState<string>(
    tile?.tileSettings?.bonsaiBlossom ?? DEFAULT_BLOSSOM,
  );
  const [bonsaiStyle, setBonsaiStyle] = useState<BonsaiStyle>(
    (tile?.tileSettings?.bonsaiStyle as BonsaiStyle) ?? DEFAULT_STYLE,
  );
  const [showBonsaiPotPicker, setShowBonsaiPotPicker] = useState(false);
  const [showBonsaiLeafPicker, setShowBonsaiLeafPicker] = useState(false);

  useEffect(() => {
    if (open) {
      const placement = normalizePlacement(tile ?? {});
      setIntegration(tile?.integration ?? NONE);
      setName(tile?.name ?? "");
      setUrl(tile?.url ?? "");
      setBgColor(tile?.bgColor ?? null);
      setImageUrl(tile?.imageUrl ?? "");
      setImageFit(placement.fit);
      setImagePosition(placement.position);
      setImageScale(placement.scale);
      setImageSource("upload");
      setTitleSize((tile?.titleSize as TitleSize) ?? DEFAULT_TITLE_SIZE);
      setTitlePosition((tile?.titlePosition as PositionKey) ?? DEFAULT_TITLE_POSITION);
      setTitleColor(tile?.titleColor ?? null);
      setHideTitle(tile?.hideTitle ?? false);
      setMetrics(tile?.metrics ?? null);
      setTruenasMetric(tile?.tileSettings?.truenasMetric ?? null);
      setTruenasPools(tile?.tileSettings?.truenasPools ?? null);
      setTruenasPoolOrder(tile?.tileSettings?.truenasPoolOrder ?? null);
      setCategoryFilter(tile?.tileSettings?.categoryFilter ?? null);
      setGroupByCategory(tile?.tileSettings?.groupByCategory ?? false);
      setClockFormat(tile?.tileSettings?.clockFormat ?? "24");
      setClockShowSeconds(tile?.tileSettings?.clockShowSeconds ?? false);
      setClockShowDate(tile?.tileSettings?.clockShowDate ?? false);
      {
        const d = tile?.tileSettings?.timerDuration ?? DEFAULT_TIMER_DURATION_SECONDS;
        setTimerMode(tile?.tileSettings?.timerMode ?? "countup");
        setTimerHours(Math.floor(d / 3600));
        setTimerMinutes(Math.floor((d % 3600) / 60));
        setTimerSeconds(d % 60);
        setPomodoroFocusMinutes(
          tile?.tileSettings?.pomodoroFocusMinutes ?? DEFAULT_POMODORO_FOCUS_MIN,
        );
        setPomodoroShortBreakMinutes(
          tile?.tileSettings?.pomodoroShortBreakMinutes ??
            DEFAULT_POMODORO_SHORT_BREAK_MIN,
        );
        setPomodoroLongBreakMinutes(
          tile?.tileSettings?.pomodoroLongBreakMinutes ??
            DEFAULT_POMODORO_LONG_BREAK_MIN,
        );
        setPomodoroSessionsBeforeLongBreak(
          tile?.tileSettings?.pomodoroSessionsBeforeLongBreak ??
            DEFAULT_POMODORO_SESSIONS,
        );
        setTimerAlertEnabled(tile?.tileSettings?.timerAlertEnabled ?? false);
        setTimerAlertSound(
          (tile?.tileSettings?.timerAlertSound as TimerAlertSound | undefined) ??
            DEFAULT_TIMER_ALERT_SOUND,
        );
      }
      setDiceType((tile?.tileSettings?.diceType as DiceType) ?? DEFAULT_DICE_TYPE);
      setDiceCount(tile?.tileSettings?.diceCount ?? DEFAULT_DICE_COUNT);
      setWeatherAutoLocate(tile?.tileSettings?.weatherAutoLocate ?? true);
      setWeatherLocation(tile?.tileSettings?.weatherLocation ?? "");
      setWeatherUnits(tile?.tileSettings?.weatherUnits ?? "c");
      setSportsLeagues(tile?.tileSettings?.sportsLeagues ?? []);
      setSportsTeams(tile?.tileSettings?.sportsTeams ?? []);
      setSportsShowScores(tile?.tileSettings?.sportsShowScores ?? true);
      setSportsShowNews(tile?.tileSettings?.sportsShowNews ?? false);
      setNewsFeedUrl(tile?.tileSettings?.newsFeedUrl ?? "");
      setNewsMaxItems(tile?.tileSettings?.newsMaxItems ?? 8);
      setNewsShowTimestamp(tile?.tileSettings?.newsShowTimestamp ?? false);
      setNewsTestState("idle");
      setNewsTestItems([]);
      setNewsTestTitle(null);
      setNewsTestError(null);
      setStockWatchlist(tile?.tileSettings?.stockWatchlist ?? []);
      setStockSearch("");
      setSleeperUsername(tile?.tileSettings?.sleeperUsername ?? "");
      setSleeperLeagueId(tile?.tileSettings?.sleeperLeagueId ?? "");
      setSleeperSport(tile?.tileSettings?.sleeperSport ?? "nfl");
      setSleeperSeason(
        tile?.tileSettings?.sleeperSeason ?? String(new Date().getFullYear()),
      );
      setSleeperShowMatchup(tile?.tileSettings?.sleeperShowMatchup ?? true);
      setSleeperShowStandings(tile?.tileSettings?.sleeperShowStandings ?? true);
      setSleeperShowTransactions(
        tile?.tileSettings?.sleeperShowTransactions ?? true,
      );
      setSleeperLeagues([]);
      setSleeperLoadState("idle");
      setSleeperLoadError(null);
      setAudioSource(tile?.tileSettings?.audioSource ?? "plex");
      setAudioFindMusic(tile?.tileSettings?.audioFindMusic ?? true);
      setAudioSearch(tile?.tileSettings?.audioSearch ?? true);
      setAudioBrowse(tile?.tileSettings?.audioBrowse ?? true);
      setAudioPlaylists(tile?.tileSettings?.audioPlaylists ?? true);
      setScrollable(tile?.tileSettings?.scrollable ?? false);
      setNoteColor(tile?.tileSettings?.noteColor ?? DEFAULT_NOTE_COLOR);
      setNoteFontSize((tile?.tileSettings?.noteFontSize as NoteFontSize) ?? "md");
      setNoteTextColor(tile?.tileSettings?.noteTextColor ?? DEFAULT_NOTE_TEXT_COLOR);
      setPetBodyColor(tile?.tileSettings?.petBodyColor ?? DEFAULT_BODY_COLOR);
      setPetEyes((tile?.tileSettings?.petEyes as EyeStyle) ?? DEFAULT_EYES);
      setPetNose((tile?.tileSettings?.petNose as NoseStyle) ?? DEFAULT_NOSE);
      setPetMouth((tile?.tileSettings?.petMouth as MouthStyle) ?? DEFAULT_MOUTH);
      setBonsaiPotColor(tile?.tileSettings?.bonsaiPotColor ?? DEFAULT_POT_COLOR);
      setBonsaiLeafColor(tile?.tileSettings?.bonsaiLeafColor ?? DEFAULT_LEAF_COLOR);
      setBonsaiBlossom(tile?.tileSettings?.bonsaiBlossom ?? DEFAULT_BLOSSOM);
      setBonsaiStyle((tile?.tileSettings?.bonsaiStyle as BonsaiStyle) ?? DEFAULT_STYLE);
      setShowBonsaiPotPicker(false);
      setShowBonsaiLeafPicker(false);
      setShowPetColorPicker(false);
      setShowNoteColorPicker(false);
      setShowNoteTextColorPicker(false);
      setShowColorPicker(false);
      setShowTitleColorPicker(false);
    }
  }, [open, tile]);

  // The image library — the user's previously uploaded images.
  const uploadsQuery = useListUploads({
    query: { queryKey: getListUploadsQueryKey(), enabled: open },
  });
  const deleteUpload = useDeleteUpload({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUploadsQueryKey() });
      },
      onError: (err) => {
        toast({ title: "Failed to delete image", description: err.message, variant: "destructive" });
      },
    },
  });

  // The set of metric keys currently shown. A null selection means "show all",
  // so reflect every catalog key as checked in the picker.
  const catalog = integration === NONE ? [] : METRIC_CATALOG[integration] ?? [];
  const enabledKeys = new Set(metrics ?? allMetricKeys(integration));

  // qBittorrent category discovery — only fetch live status when the editor is
  // open and qBittorrent is the selected integration. The list of selectable
  // categories comes from the widget's `categories` field, which reflects
  // qBittorrent's full category catalog (every defined category, even ones with
  // no active torrents) rather than being derived from the live torrent list.
  const isQbittorrent = integration === TileIntegration.qbittorrent;
  // TrueNAS is special: it's picked via the integration picker's second pop-out,
  // which selects one of its bespoke per-metric "live tile" variants. When a
  // variant is chosen (truenasMetric set), the generic metric-checkbox section
  // is hidden — the variant already fixes which metrics the tile renders.
  const isTruenas = integration === TileIntegration.truenas;
  // The no-connection built-in widgets (clock/weather) have their own config UI
  // and no metric catalog or backing service.
  const isClock = integration === TileIntegration.clock;
  const isWeather = integration === TileIntegration.weather;
  const isSports = integration === TileIntegration.sports;
  const isNews = integration === TileIntegration.news;
  const isStocks = integration === TileIntegration.stocks;
  const isSleeper = integration === TileIntegration.sleeper;
  const isAudioPlayer = integration === TileIntegration.audioplayer;
  // The Magic Eight Ball is a self-contained client-side toy with no link,
  // image, background, metrics, or settings — only a name and size matter.
  const isEightball = integration === TileIntegration.eightball;
  // The Dice Roller and Coin Flip are the same kind of self-contained
  // client-side toy: no link, image, background, metrics, or settings — only a
  // name and size matter.
  const isDice = integration === TileIntegration.dice;
  const isCoinFlip = integration === TileIntegration.coinflip;
  // The Fortune tile is the same kind of self-contained client-side toy: it
  // shows a random quote/fortune from a baked-in list, refreshed on click or on
  // a timer. No link, image, background, metrics, or settings — only a name and
  // size matter.
  const isFortune = integration === TileIntegration.fortune;
  // The Tamagotchi is a self-contained virtual-pet toy. Like the note/timer it
  // paints its own surface (pet + stats + care buttons) with no header, and its
  // living state is operated in-place on the tile, so the editor strips
  // name/URL/image/background/metrics — only its size/position matter.
  const isTamagotchi = integration === TileIntegration.tamagotchi;
  // The Bonsai is a self-contained living-plant toy. Like the Tamagotchi it
  // paints its own surface (tree + stats + care buttons) with no header, and its
  // living state is tended in-place on the tile, so the editor strips
  // name/URL/image/background/metrics and instead exposes its cosmetic look
  // (pot color, foliage color, blossoms, tree style).
  const isBonsai = integration === TileIntegration.bonsai;
  // The spacer is a layout-only tile: an invisible gap with no name, URL,
  // image, background, or live data. Only its size/position matter, so the
  // editor strips every content field and shows a short description instead.
  const isSpacer = integration === TileIntegration.spacer;
  // The divider is a layout-only section heading. It keeps a label (Name)
  // field but, like the spacer, strips URL, image, background, and metrics so
  // only its text and size/position matter.
  const isDivider = integration === TileIntegration.divider;
  // The note is a post-it tile: its content (body + checklist) is edited in
  // place on the tile, so the editor strips name/URL/image/background/metrics
  // and instead exposes the post-it's appearance (color, font size, text color).
  const isNote = integration === TileIntegration.note;
  // The timer is a client-side stopwatch/countdown tile. Like the note it paints
  // its own surface (big readout + controls) with no header, so the editor
  // strips name/URL/image/background/metrics and instead exposes the mode and
  // countdown duration.
  const isTimer = integration === TileIntegration.timer;
  // Layout-only tiles (spacer + divider) share the same stripped editor: no
  // URL, image, background, or metric sections.
  const isLayoutTile = isSpacer || isDivider;
  // Tiles that carry no link/image/background content: layout helpers plus the
  // note and timer, which paint their own surface.
  const isContentless =
    isLayoutTile || isNote || isTimer || isEightball || isDice || isCoinFlip || isFortune || isTamagotchi || isBonsai;

  // Teams for the chosen leagues, for the dependent team multi-select. Sourced
  // from the baked-in catalog (ESPN's /teams endpoint isn't CORS-enabled), so
  // this is a synchronous lookup grouped per selected league.
  const sportsTeamGroups = sportsLeagues.map((key) => ({
    league: key,
    teams: getLeagueTeams(key),
  }));

  function toggleSportsLeague(key: string, checked: boolean) {
    setSportsLeagues((prev) => {
      const set = new Set(prev);
      if (checked) set.add(key);
      else set.delete(key);
      return SPORTS_LEAGUES.filter((l) => set.has(l.key)).map((l) => l.key);
    });
    // Dropping a league also drops any of its selected teams.
    if (!checked) {
      setSportsTeams((prev) => prev.filter((t) => !t.startsWith(`${key}:`)));
    }
  }

  function toggleSportsTeam(teamKeyValue: string, checked: boolean) {
    setSportsTeams((prev) => {
      const set = new Set(prev);
      if (checked) set.add(teamKeyValue);
      else set.delete(teamKeyValue);
      return Array.from(set);
    });
  }

  // Fetch a few headlines from the entered feed URL so the user can confirm it
  // resolves to a real feed before saving. Reuses GET /api/widgets/news (the
  // same route the tile uses): a bad/unreachable URL throws (502) and surfaces
  // inline, a valid one returns items shown as a small preview.
  async function handleTestFeed() {
    const trimmed = newsFeedUrl.trim();
    if (!trimmed) return;
    setNewsTestState("loading");
    setNewsTestError(null);
    try {
      const data = await getNewsWidget({ url: trimmed, limit: 5 });
      if (data.items.length === 0) {
        setNewsTestState("error");
        setNewsTestError(
          "That URL loaded but contained no headlines — check it points to an RSS or Atom feed.",
        );
        setNewsTestItems([]);
        setNewsTestTitle(null);
        return;
      }
      setNewsTestItems(data.items);
      setNewsTestTitle(data.feedTitle);
      setNewsTestState("success");
    } catch {
      setNewsTestState("error");
      setNewsTestError(
        "Couldn't load that feed. Double-check the URL is a reachable RSS or Atom feed.",
      );
      setNewsTestItems([]);
      setNewsTestTitle(null);
    }
  }

  // Lazily resolve the Sleeper username and load its leagues for the picker.
  // Sleeper's endpoints are public and keyless, so this is a direct browser
  // fetch (like the News "Test feed" button). A bad username or network error
  // surfaces inline so the user can correct it before saving.
  async function handleLoadSleeperLeagues() {
    const user = sleeperUsername.trim();
    if (!user) return;
    setSleeperLoadState("loading");
    setSleeperLoadError(null);
    try {
      const resolved = await fetchSleeperUser(user);
      if (!resolved) {
        setSleeperLoadState("error");
        setSleeperLoadError(`No Sleeper user named "${user}".`);
        setSleeperLeagues([]);
        return;
      }
      const leagues = await fetchUserLeagues(
        resolved.userId,
        sleeperSport,
        sleeperSeason.trim(),
      );
      setSleeperLeagues(leagues);
      setSleeperLoadState("success");
      if (leagues.length === 0) {
        setSleeperLoadError(
          `No ${sleeperSport.toUpperCase()} leagues found for ${user} in ${sleeperSeason}.`,
        );
      }
    } catch {
      setSleeperLoadState("error");
      setSleeperLoadError(
        "Couldn't reach Sleeper. Check the username, sport, and season.",
      );
      setSleeperLeagues([]);
    }
  }

  const qbStatusQuery = useGetQbittorrentStatus({
    query: {
      queryKey: getGetQbittorrentStatusQueryKey(),
      enabled: open && isQbittorrent,
    },
  });
  const availableCategories = Array.from(
    new Set(
      (qbStatusQuery.data?.categories ?? []).filter(
        (c): c is string => typeof c === "string" && c.length > 0,
      ),
    ),
  ).sort((a, b) => a.localeCompare(b));

  // The set of categories the saved filter currently covers. A null filter
  // means "all categories" — reflect every catalog category as checked. An
  // explicit array is honored as-is so a saved selection survives even when the
  // live catalog is empty (e.g. the categories fetch transiently failed).
  const checkedCategories = new Set(categoryFilter ?? availableCategories);
  const torrentsMetricOn = enabledKeys.has("torrents");

  // TrueNAS pool (volume) discovery — only fetch live metrics while the editor
  // is open and TrueNAS is the selected integration. The available volume names
  // come from the live metrics' `pools` list.
  const truenasMetricsQuery = useGetTruenasMetrics({
    query: {
      queryKey: getGetTruenasMetricsQueryKey(),
      enabled: open && isTruenas,
    },
  });
  const availablePools = Array.from(
    new Set(
      (truenasMetricsQuery.data?.pools ?? [])
        .map((p) => p.name)
        .filter((n): n is string => typeof n === "string" && n.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));
  // The set of volumes the saved filter currently covers. A null/empty filter
  // means "all volumes" — reflect every reported volume as checked. An explicit
  // array is honored as-is so a saved selection survives even when the live
  // metrics fetch transiently fails.
  const checkedPools = new Set(
    truenasPools == null || truenasPools.length === 0
      ? availablePools
      : truenasPools,
  );

  function toggleTruenasPool(pool: string, checked: boolean) {
    // Start from the saved selection when present; otherwise (null/empty =
    // "all") start from the full reported list so unchecking one leaves the
    // rest selected.
    const base =
      truenasPools == null || truenasPools.length === 0
        ? availablePools
        : truenasPools;
    const set = new Set(base);
    if (checked) set.add(pool);
    else set.delete(pool);
    const next = Array.from(set).sort((a, b) => a.localeCompare(b));
    // Collapse back to null ("show all") when every reported volume is
    // selected, so a newly-appearing volume shows automatically. Computed
    // against the full reported list — never an empty one — so a transiently
    // empty metrics fetch can't silently wipe an explicit selection.
    const coversAll =
      availablePools.length > 0 && availablePools.every((p) => set.has(p));
    setTruenasPools(coversAll ? null : next);
  }

  // The volumes the tile actually shows, in their current display order. We mirror
  // the runtime ordering (filter by selection, then apply the saved order) using
  // the *server-reported* pool order as the base — not the alphabetical
  // availablePools — so reordering reflects exactly what renders on the tile.
  const reportedPoolNames = (truenasMetricsQuery.data?.pools ?? [])
    .map((p) => p.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
  const orderedVisiblePools = filterTruenasPools(
    reportedPoolNames.map((name) => ({ name })),
    truenasPools,
    truenasPoolOrder,
  ).map((p) => p.name);

  function moveTruenasVolume(from: number, to: number) {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= orderedVisiblePools.length ||
      to >= orderedVisiblePools.length
    ) {
      return;
    }
    const next = [...orderedVisiblePools];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    // Collapse back to null ("server order") when the new order matches the
    // natural server order of the same visible set, so the default stays
    // backward-compatible and newly-appearing volumes keep flowing in server
    // order. Otherwise persist the explicit order of the visible volumes.
    const visibleSet = new Set(next);
    const naturalOrder = reportedPoolNames.filter((n) => visibleSet.has(n));
    const matchesServerOrder =
      next.length === naturalOrder.length &&
      next.every((n, i) => n === naturalOrder[i]);
    setTruenasPoolOrder(matchesServerOrder ? null : next);
  }

  function toggleCategory(category: string, checked: boolean) {
    // Start from the saved selection when present; otherwise (null = "all")
    // start from the full catalog so unchecking one leaves the rest selected.
    const base = categoryFilter ?? availableCategories;
    const set = new Set(base);
    if (checked) set.add(category);
    else set.delete(category);
    // Collapse back to null ("show all") only when every catalog category is
    // selected, so newly-added categories appear automatically. This is
    // computed against the full catalog — never an empty live list — so a
    // transiently-empty catalog can't silently wipe an explicit selection.
    const next = Array.from(set).sort((a, b) => a.localeCompare(b));
    const coversFullCatalog =
      availableCategories.length > 0 &&
      availableCategories.every((c) => set.has(c));
    setCategoryFilter(coversFullCatalog ? null : next);
  }

  function handleIntegrationChange(next: string, subKey?: string) {
    setIntegration(next);
    // Switching integrations invalidates the old category filter too.
    setCategoryFilter(null);
    // TrueNAS is chosen via its second pop-out, which passes the picked metric
    // variant. Store it and narrow the tile's metric selection to that variant's
    // underlying keys so the data path stays consistent; any other integration
    // clears the variant and resets to "show all".
    if (next === TileIntegration.truenas && subKey) {
      const variant = truenasMetricVariant(subKey);
      setTruenasMetric(subKey as NonNullable<TileSettings>["truenasMetric"]);
      setMetrics(variant ? variant.metricKeys : null);
    } else {
      setTruenasMetric(null);
      // Switching away from TrueNAS invalidates the old volume filter.
      if (next !== TileIntegration.truenas) setTruenasPools(null);
      // Switching integrations invalidates the old metric keys; reset to "show
      // all" for the newly chosen service.
      setMetrics(null);
    }
    // Switching away from Sports clears its selections so a stale league/team
    // filter never rides along to a different widget.
    if (next !== TileIntegration.sports) {
      setSportsLeagues([]);
      setSportsTeams([]);
    }
  }

  function toggleMetric(key: string, checked: boolean) {
    const base = metrics ?? allMetricKeys(integration);
    const set = new Set(base);
    if (checked) set.add(key);
    else set.delete(key);
    // Persist an explicit ordered subset so widgets honor exactly this choice.
    setMetrics(allMetricKeys(integration).filter((k) => set.has(k)));
  }

  const createTile = useCreateTile({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/tiles"] });
        toast({ title: "Tile created" });
        onOpenChange(false);
      },
      onError: (err) => {
        toast({ title: "Failed to create tile", description: err.message, variant: "destructive" });
      },
    },
  });

  const updateTile = useUpdateTile({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/tiles"] });
        toast({ title: "Tile updated" });
        onOpenChange(false);
      },
      onError: (err) => {
        toast({ title: "Failed to update tile", description: err.message, variant: "destructive" });
      },
    },
  });

  const deleteTile = useDeleteTile({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/tiles"] });
        toast({ title: "Tile deleted" });
        onOpenChange(false);
      },
      onError: (err) => {
        toast({ title: "Failed to delete tile", description: err.message, variant: "destructive" });
      },
    },
  });

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` },
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      const { url: uploadedUrl } = await res.json();
      setImageUrl(uploadedUrl);
      // Reset placement to sensible defaults for the freshly chosen image:
      // show the whole image, centered, at 100% so it can be freely panned.
      setImageFit(DEFAULT_NEW_FIT);
      setImagePosition(DEFAULT_PAN);
      setImageScale(DEFAULT_SCALE);
      // Refresh the library so the new image appears there too.
      queryClient.invalidateQueries({ queryKey: getListUploadsQueryKey() });
      toast({ title: "Image uploaded" });
    } catch (err: unknown) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  // Pick an image from the library / URL and reset placement to defaults so the
  // new image starts centered with the whole picture visible.
  function pickImage(nextUrl: string) {
    setImageUrl(nextUrl);
    setImageFit(DEFAULT_NEW_FIT);
    setImagePosition(DEFAULT_PAN);
    setImageScale(DEFAULT_SCALE);
  }

  // Clear the tile's image entirely.
  function clearImage() {
    setImageUrl("");
    setImageFit(DEFAULT_NEW_FIT);
    setImagePosition(DEFAULT_PAN);
    setImageScale(DEFAULT_SCALE);
  }

  // Delete an image from the library; if it was the tile's current image, clear
  // that selection too so we don't reference a now-missing file.
  function handleDeleteUpload(id: number, fileUrl: string) {
    deleteUpload.mutate({ id });
    if (imageUrl === fileUrl) clearImage();
  }

  // Eyedropper: pick any color on screen using the browser EyeDropper API.
  // Only Chromium-based browsers support it, so we feature-detect.
  const eyeDropperSupported =
    typeof window !== "undefined" && "EyeDropper" in window;

  async function pickColorFromScreen() {
    if (!eyeDropperSupported) return;
    try {
      const EyeDropperCtor = (window as unknown as {
        EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> };
      }).EyeDropper;
      const result = await new EyeDropperCtor().open();
      setBgColor(result.sRGBHex);
    } catch {
      // User dismissed the eyedropper (Esc) — nothing to do.
    }
  }

  async function pickTitleColorFromScreen() {
    if (!eyeDropperSupported) return;
    try {
      const EyeDropperCtor = (window as unknown as {
        EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> };
      }).EyeDropper;
      const result = await new EyeDropperCtor().open();
      setTitleColor(result.sRGBHex);
    } catch {
      // User dismissed the eyedropper (Esc) — nothing to do.
    }
  }

  // Live placement preview for the editor (mirrors how tiles render).
  const preview = resolveImageStyle({ imageFit, imagePosition, imageScale });
  const titlePreview = resolveTitleStyle({ titleSize, titlePosition });

  // ── Drag-to-reposition (free pan) ─────────────────────────────────────────
  // The user drags the preview image to pan it anywhere within the tile: the
  // image is a canvas and the tile a viewport over it. The pan is stored in
  // imagePosition as "pan(<x>,<y>)" — a translate in % of the tile box — so it
  // works on both axes at any zoom and never force-crops the image. The drag is
  // 1:1 in pixels because translate is resolved against the box the img fills.
  const previewRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    boxW: number;
    boxH: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handlePreviewPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!imageUrl) return;
    const box = previewRef.current;
    if (!box) return;
    const boxW = box.clientWidth;
    const boxH = box.clientHeight;
    if (!boxW || !boxH) return;
    // Start from the current pan; a legacy anchor/focal value has no pan, so we
    // begin from center and the drag recalibrates it into the free-pan model.
    const start = parsePan(imagePosition) ?? { x: 0, y: 0 };
    dragState.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: start.x,
      startY: start.y,
      boxW,
      boxH,
    };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handlePreviewPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragState.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startClientX;
    const dy = e.clientY - s.startClientY;
    // translate is % of the box, so a px delta maps to (dx / boxW) * 100.
    const nx = s.startX + (dx / s.boxW) * 100;
    const ny = s.startY + (dy / s.boxH) * 100;
    setImagePosition(formatPan(nx, ny));
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragState.current;
    if (!s || e.pointerId !== s.pointerId) return;
    dragState.current = null;
    setIsDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  // Whether the image has been panned away from its centered default.
  const isCentered = !isPan(imagePosition) || imagePosition === DEFAULT_PAN;

  function handleSave() {
    const data = {
      // Every tile is stored as an app/link with an optional integration.
      type: TileType.app,
      integration:
        integration === NONE
          ? null
          : (integration as typeof TileIntegration[keyof typeof TileIntegration]),
      // A spacer carries no content at all; a divider keeps only its label
      // (name). Both clear url/background/image so converting an existing tile
      // into a layout tile leaves nothing behind.
      name: isSpacer || isNote || isTimer || isTamagotchi || isBonsai ? "" : name || undefined,
      url: isContentless ? "" : url || undefined,
      // Send the raw value so clearing (null) reaches the body and the server
      // writes NULL; otherwise an undefined field is dropped and the old color
      // sticks. A non-empty string sets an explicit per-tile color as before.
      bgColor: isContentless ? null : bgColor,
      // Send "" to explicitly clear the image when removed; placement fields are
      // only sent when an image is present.
      imageUrl: isContentless ? "" : imageUrl || "",
      imageFit: !isContentless && imageUrl ? imageFit : undefined,
      imagePosition: !isContentless && imageUrl ? imagePosition : undefined,
      imageScale: !isContentless && imageUrl ? imageScale : undefined,
      // Title size/placement only applies to plain app/link tiles; integration
      // (widget) tiles keep their fixed header layout, so clear those fields.
      titleSize: integration === NONE ? titleSize : null,
      titlePosition: integration === NONE ? titlePosition : null,
      titleColor: integration === NONE ? titleColor : null,
      // Applies to both plain and integration tiles.
      hideTitle,
      // Plain app/link tiles carry no metric selection; neither does the note
      // or timer.
      metrics: integration === NONE || isNote || isTimer ? null : metrics,
      // tileSettings carries per-widget config: the qBittorrent category
      // filter, the clock format options, the weather options, or the sports
      // options. The generic "scrollable" option applies to every tile, so it
      // is merged in below regardless of integration.
      tileSettings: (() => {
        const widget = isTruenas
          ? { truenasMetric, truenasPools, truenasPoolOrder }
          : isQbittorrent
          ? { categoryFilter, groupByCategory }
          : isClock
            ? { clockFormat, clockShowSeconds, clockShowDate }
            : isTimer
            ? {
                // Editing a timer's config resets its run state so the new mode
                // / duration starts cleanly. Run state is otherwise owned and
                // persisted by the tile itself (Start/Pause/Reset).
                timerMode,
                timerDuration:
                  timerMode === "countdown"
                    ? Math.max(
                        1,
                        timerHours * 3600 + timerMinutes * 60 + timerSeconds,
                      )
                    : null,
                timerRunning: false,
                timerStartedAt: null,
                timerAccumulatedMs: 0,
                // Pomodoro lengths/cycle config (always persisted so switching
                // modes back to pomodoro keeps the user's choices). Run-state
                // for the cycle resets to a fresh focus phase.
                pomodoroFocusMinutes: Math.max(1, pomodoroFocusMinutes),
                pomodoroShortBreakMinutes: Math.max(1, pomodoroShortBreakMinutes),
                pomodoroLongBreakMinutes: Math.max(1, pomodoroLongBreakMinutes),
                pomodoroSessionsBeforeLongBreak: Math.max(
                  1,
                  pomodoroSessionsBeforeLongBreak,
                ),
                pomodoroPhase: "focus" as const,
                pomodoroCompletedSessions: 0,
                // Persist the alert choice regardless of mode so it sticks when
                // switching back. The sound is honored by both countdown
                // completion and pomodoro phase transitions.
                timerAlertEnabled,
                timerAlertSound,
              }
            : isWeather
              ? {
                  weatherAutoLocate,
                  weatherLocation: weatherLocation.trim() || null,
                  weatherUnits,
                }
              : isSports
                ? {
                    sportsLeagues,
                    sportsTeams,
                    sportsShowScores,
                    sportsShowNews,
                  }
                : isNews
                  ? {
                      newsFeedUrl: newsFeedUrl.trim() || null,
                      newsMaxItems,
                      newsShowTimestamp,
                    }
                  : isStocks
                    ? { stockWatchlist }
                    : isSleeper
                      ? {
                          sleeperUsername: sleeperUsername.trim() || null,
                          sleeperLeagueId: sleeperLeagueId.trim() || null,
                          sleeperSport,
                          sleeperSeason: sleeperSeason.trim() || null,
                          sleeperShowMatchup,
                          sleeperShowStandings,
                          sleeperShowTransactions,
                        }
                      : isAudioPlayer
                        ? {
                            audioSource,
                            ...(audioSource === "plex" || audioSource === "subsonic"
                              ? { audioFindMusic, audioSearch, audioBrowse, audioPlaylists }
                              : {}),
                          }
                        : isNote
                          ? {
                              // Appearance is edited here; the note's content
                              // (body + checklist) is edited in-place on the
                              // tile, so preserve whatever is already stored.
                              noteColor,
                              noteFontSize,
                              noteTextColor,
                              noteBody: tile?.tileSettings?.noteBody ?? null,
                              noteItems: tile?.tileSettings?.noteItems ?? null,
                            }
                          : isDice
                            ? { diceType, diceCount }
                            : isTamagotchi
                              ? {
                                  // Appearance is edited here; the pet's live
                                  // stats are persisted by the tile itself, so
                                  // preserve whatever is already stored.
                                  petBodyColor,
                                  petEyes,
                                  petNose,
                                  petMouth,
                                  petHunger: tile?.tileSettings?.petHunger ?? null,
                                  petHappiness: tile?.tileSettings?.petHappiness ?? null,
                                  petEnergy: tile?.tileSettings?.petEnergy ?? null,
                                  petUpdatedAt: tile?.tileSettings?.petUpdatedAt ?? null,
                                }
                              : isBonsai
                                ? {
                                    // Appearance is edited here; the tree's live
                                    // state is persisted by the tile itself, so
                                    // preserve whatever is already stored.
                                    bonsaiPotColor,
                                    bonsaiLeafColor,
                                    bonsaiBlossom,
                                    bonsaiStyle,
                                    bonsaiHydration: tile?.tileSettings?.bonsaiHydration ?? null,
                                    bonsaiOvergrowth: tile?.tileSettings?.bonsaiOvergrowth ?? null,
                                    bonsaiGrowth: tile?.tileSettings?.bonsaiGrowth ?? null,
                                    bonsaiUpdatedAt: tile?.tileSettings?.bonsaiUpdatedAt ?? null,
                                  }
                                : null;
        // Only emit a settings object when there is something to store; an
        // un-scrolled plain tile keeps tileSettings null as before.
        if (!widget && !scrollable) return null;
        return { ...(widget ?? {}), scrollable };
      })(),
      gridX: tile?.gridX ?? defaultGridPos?.x ?? 0,
      gridY: tile?.gridY ?? defaultGridPos?.y ?? 0,
      gridW: tile?.gridW ?? 4,
      gridH: tile?.gridH ?? 4,
    };

    if (mode === "create") {
      createTile.mutate({ data: { ...data, pageId: pageId ?? null } });
    } else if (tile) {
      updateTile.mutate({ id: tile.id, data });
    }
  }

  function handleDelete() {
    if (tile) deleteTile.mutate({ id: tile.id });
  }

  const isPending = createTile.isPending || updateTile.isPending;

  // TrueNAS's per-metric variants, keyed for the integration picker's second
  // pop-out. Each becomes its own bespoke "live tile".
  const truenasSubOptions = {
    [TileIntegration.truenas]: TRUENAS_METRIC_VARIANTS.map((v) => ({
      key: v.key,
      label: v.label,
      description: v.description,
    })),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Tile" : "Edit Tile"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!isSpacer && (
            <div className="space-y-1.5">
              <Label>{isDivider ? "Label" : "Name"}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isDivider ? "Media" : "My App"}
              />
            </div>
          )}

          <div className={`space-y-1.5 ${isSpacer ? "" : "border-t border-border pt-4"}`}>
            <Label>App integration</Label>
            {(() => {
              const selectedLabel =
                integration === NONE
                  ? "None"
                  : INTEGRATIONS.find((i) => i.value === integration)?.label ??
                    "None";
              const SelectedIcon = integrationMeta(integration).icon;
              return (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex w-full items-center gap-3 rounded-md border border-input bg-background p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                    <SelectedIcon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {selectedLabel}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {integrationMeta(integration).description}
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-xs font-medium text-primary">
                    {integration === NONE ? "Browse" : "Change"}
                  </span>
                </button>
              );
            })()}
            <p className="text-xs text-muted-foreground">
              Optional. Attach a service to show its live status on this tile.
            </p>
          </div>

          <IntegrationPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            value={integration}
            onSelect={handleIntegrationChange}
            integrations={INTEGRATIONS}
            statuses={connectionStatuses}
            subOptions={truenasSubOptions}
            subValue={truenasMetric ?? undefined}
          />

          {isSpacer && (
            <p className="text-sm text-muted-foreground border-t border-border pt-4">
              An invisible gap tile for managing layout spacing. It stays
              completely transparent on the dashboard and only shows a dashed
              outline while editing. Just drag and resize it to shape your
              layout.
            </p>
          )}

          {isDivider && (
            <p className="text-sm text-muted-foreground border-t border-border pt-4">
              A section heading tile for grouping. It shows the label text above
              with no card background — drop it between groups of tiles and
              resize it to span a row.
            </p>
          )}

          {isEightball && (
            <p className="text-sm text-muted-foreground border-t border-border pt-4">
              A Magic Eight Ball toy. Click the tile to "shake" it and reveal one
              of the 20 classic answers. Fully self-contained — no connection or
              settings needed. Give it a name and resize it to taste.
            </p>
          )}

          {isDice && (
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">
                A set of dice. Click the tile to roll them and see the result
                (plus the total when rolling more than one). Pick the die type
                and how many to roll.
              </p>
              <div className="space-y-1.5">
                <Label>Die type</Label>
                <Select
                  value={diceType}
                  onValueChange={(v) => setDiceType(v as DiceType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DICE_TYPES.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.value} ({d.sides}-sided)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Number of dice</Label>
                <Input
                  type="number"
                  min={MIN_DICE_COUNT}
                  max={MAX_DICE_COUNT}
                  value={diceCount}
                  onChange={(e) =>
                    setDiceCount(
                      Math.max(
                        MIN_DICE_COUNT,
                        Math.min(
                          MAX_DICE_COUNT,
                          Math.floor(Number(e.target.value) || MIN_DICE_COUNT),
                        ),
                      ),
                    )
                  }
                  aria-label="Number of dice"
                />
                <span className="block text-[11px] text-muted-foreground">
                  Roll between {MIN_DICE_COUNT} and {MAX_DICE_COUNT} dice at once.
                </span>
              </div>
            </div>
          )}

          {isCoinFlip && (
            <p className="text-sm text-muted-foreground border-t border-border pt-4">
              A flippable coin. Click the tile to spin it and land on Heads or
              Tails. Fully self-contained — no connection or settings needed.
              Give it a name and resize it to taste.
            </p>
          )}

          {isFortune && (
            <p className="text-sm text-muted-foreground border-t border-border pt-4">
              A daily fortune. The tile shows a random quote from a curated list,
              refreshing on its own every so often — or click it for a new one.
              Fully self-contained — no connection or settings needed. Give it a
              name and resize it to taste.
            </p>
          )}

          {isTamagotchi && (
            <div className="space-y-4 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">
                A virtual pet. Feed it, play with it, and let it rest right on
                the tile — its hunger, happiness, and energy slowly drift over
                real time. Customize how it looks below; its mood still tweaks
                the expression when it needs care.
              </p>

              {/* Live preview of the chosen look. */}
              <div className="flex justify-center">
                <PetFace
                  appearance={{
                    bodyColor: petBodyColor,
                    eyes: petEyes,
                    nose: petNose,
                    mouth: petMouth,
                  }}
                  mood="content"
                  style={{ width: 96, height: 96 }}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Body color</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {PET_BODY_COLORS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setPetBodyColor(preset.value)}
                      title={preset.label}
                      aria-label={preset.label}
                      aria-pressed={petBodyColor === preset.value}
                      className={`h-8 w-8 rounded-full border shadow-sm transition-transform hover:scale-105 ${
                        petBodyColor === preset.value
                          ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                          : "border-border"
                      }`}
                      style={{ background: preset.gradient }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    className="w-8 h-8 rounded-md border border-border flex-shrink-0 shadow-sm"
                    style={{ background: petBodyColor }}
                    onClick={() => setShowPetColorPicker((v) => !v)}
                    aria-label="Pick custom body color"
                  />
                  <Input
                    value={petBodyColor}
                    onChange={(e) => setPetBodyColor(e.target.value)}
                    placeholder="#7fd45a or preset name"
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="flex-shrink-0"
                    onClick={() => setPetBodyColor(DEFAULT_BODY_COLOR)}
                    disabled={petBodyColor === DEFAULT_BODY_COLOR}
                    title="Reset to default body color"
                    aria-label="Reset to default body color"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                </div>
                {showPetColorPicker && (
                  <div className="mt-2">
                    <HexColorPicker
                      color={
                        petBodyColor.startsWith("#") ? petBodyColor : "#7fd45a"
                      }
                      onChange={setPetBodyColor}
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Eyes</Label>
                  <Select
                    value={petEyes}
                    onValueChange={(v) => setPetEyes(v as EyeStyle)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PET_EYES_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Nose</Label>
                  <Select
                    value={petNose}
                    onValueChange={(v) => setPetNose(v as NoseStyle)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PET_NOSE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Mouth</Label>
                  <Select
                    value={petMouth}
                    onValueChange={(v) => setPetMouth(v as MouthStyle)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PET_MOUTH_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {isBonsai && (
            <div className="space-y-4 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">
                A living bonsai. Water it, prune it, and watch it grow right on
                the tile — its hydration and tidiness slowly drift over real
                time. Personalize its look below; this is cosmetic only and does
                not affect how it grows.
              </p>

              {/* Live preview of the chosen look (a healthy mature tree). */}
              <div className="flex justify-center">
                <BonsaiPreview
                  appearance={{
                    potColor: bonsaiPotColor,
                    leafColor: bonsaiLeafColor,
                    blossom: bonsaiBlossom,
                    style: bonsaiStyle,
                  }}
                  size={120}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Pot color</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {BONSAI_POT_COLORS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setBonsaiPotColor(preset.value)}
                      title={preset.label}
                      aria-label={preset.label}
                      aria-pressed={bonsaiPotColor === preset.value}
                      className={`h-8 w-8 rounded-full border shadow-sm transition-transform hover:scale-105 ${
                        bonsaiPotColor === preset.value
                          ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                          : "border-border"
                      }`}
                      style={{ background: preset.color }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    className="w-8 h-8 rounded-md border border-border flex-shrink-0 shadow-sm"
                    style={{ background: bonsaiPotColor }}
                    onClick={() => setShowBonsaiPotPicker((v) => !v)}
                    aria-label="Pick custom pot color"
                  />
                  <Input
                    value={bonsaiPotColor}
                    onChange={(e) => setBonsaiPotColor(e.target.value)}
                    placeholder="#9c5a33 or preset name"
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="flex-shrink-0"
                    onClick={() => setBonsaiPotColor(DEFAULT_POT_COLOR)}
                    disabled={bonsaiPotColor === DEFAULT_POT_COLOR}
                    title="Reset to default pot color"
                    aria-label="Reset to default pot color"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                </div>
                {showBonsaiPotPicker && (
                  <div className="mt-2">
                    <HexColorPicker
                      color={bonsaiPotColor.startsWith("#") ? bonsaiPotColor : "#9c5a33"}
                      onChange={setBonsaiPotColor}
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Foliage color</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {BONSAI_LEAF_COLORS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setBonsaiLeafColor(preset.value)}
                      title={preset.label}
                      aria-label={preset.label}
                      aria-pressed={bonsaiLeafColor === preset.value}
                      className={`h-8 w-8 rounded-full border shadow-sm transition-transform hover:scale-105 ${
                        bonsaiLeafColor === preset.value
                          ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                          : "border-border"
                      }`}
                      style={{ background: preset.color }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    className="w-8 h-8 rounded-md border border-border flex-shrink-0 shadow-sm"
                    style={{ background: bonsaiLeafColor }}
                    onClick={() => setShowBonsaiLeafPicker((v) => !v)}
                    aria-label="Pick custom foliage color"
                  />
                  <Input
                    value={bonsaiLeafColor}
                    onChange={(e) => setBonsaiLeafColor(e.target.value)}
                    placeholder="#4ea832 or preset name"
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="flex-shrink-0"
                    onClick={() => setBonsaiLeafColor(DEFAULT_LEAF_COLOR)}
                    disabled={bonsaiLeafColor === DEFAULT_LEAF_COLOR}
                    title="Reset to default foliage color"
                    aria-label="Reset to default foliage color"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                </div>
                {showBonsaiLeafPicker && (
                  <div className="mt-2">
                    <HexColorPicker
                      color={bonsaiLeafColor.startsWith("#") ? bonsaiLeafColor : "#4ea832"}
                      onChange={setBonsaiLeafColor}
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Blossoms</Label>
                  <Select
                    value={bonsaiBlossom}
                    onValueChange={(v) => setBonsaiBlossom(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BONSAI_BLOSSOM_COLORS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Tree style</Label>
                  <Select
                    value={bonsaiStyle}
                    onValueChange={(v) => setBonsaiStyle(v as BonsaiStyle)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BONSAI_STYLE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {isNote && (
            <div className="space-y-4 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">
                A colored post-it note. Write its text and tick off checklist
                items directly on the tile — your edits save automatically. Set
                its look here.
              </p>

              <div className="space-y-1.5">
                <Label>Note color</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {NOTE_PRESET_COLORS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setNoteColor(preset.value)}
                      title={preset.label}
                      aria-label={preset.label}
                      aria-pressed={noteColor === preset.value}
                      className={`h-8 w-8 rounded-md border shadow-sm transition-transform hover:scale-105 ${
                        noteColor === preset.value
                          ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                          : "border-border"
                      }`}
                      style={{ background: preset.value }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    className="w-8 h-8 rounded-md border border-border flex-shrink-0 shadow-sm"
                    style={{ background: noteColor }}
                    onClick={() => setShowNoteColorPicker((v) => !v)}
                    aria-label="Pick custom note color"
                  />
                  <Input
                    value={noteColor}
                    onChange={(e) => setNoteColor(e.target.value)}
                    placeholder={DEFAULT_NOTE_COLOR}
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="flex-shrink-0"
                    onClick={() => setNoteColor(DEFAULT_NOTE_COLOR)}
                    disabled={noteColor === DEFAULT_NOTE_COLOR}
                    title="Reset to default note color"
                    aria-label="Reset to default note color"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                </div>
                {showNoteColorPicker && (
                  <div className="mt-2">
                    <HexColorPicker color={noteColor} onChange={setNoteColor} />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Font size</Label>
                <Select
                  value={noteFontSize}
                  onValueChange={(v) => setNoteFontSize(v as NoteFontSize)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NOTE_FONT_SIZES.map((size) => (
                      <SelectItem key={size.value} value={size.value}>
                        {size.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Text color</Label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="w-8 h-8 rounded-md border border-border flex-shrink-0 shadow-sm"
                    style={{ background: noteTextColor }}
                    onClick={() => setShowNoteTextColorPicker((v) => !v)}
                    aria-label="Pick note text color"
                  />
                  <Input
                    value={noteTextColor}
                    onChange={(e) => setNoteTextColor(e.target.value)}
                    placeholder={DEFAULT_NOTE_TEXT_COLOR}
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="flex-shrink-0"
                    onClick={() => setNoteTextColor(DEFAULT_NOTE_TEXT_COLOR)}
                    disabled={noteTextColor === DEFAULT_NOTE_TEXT_COLOR}
                    title="Reset to default text color"
                    aria-label="Reset to default text color"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                </div>
                {showNoteTextColorPicker && (
                  <div className="mt-2">
                    <HexColorPicker
                      color={noteTextColor}
                      onChange={setNoteTextColor}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {catalog.length > 0 && !isTruenas && (
            <div className="space-y-2 border-t border-border pt-4">
              <Label>Metrics shown</Label>
              <p className="text-xs text-muted-foreground">
                Pick what this tile displays. Larger tiles reveal more detail.
              </p>
              <div className="space-y-2 pt-1">
                {catalog.map((m) => (
                  <label
                    key={m.key}
                    htmlFor={`metric-${m.key}`}
                    className="flex items-center gap-2 cursor-pointer select-none"
                  >
                    <Checkbox
                      id={`metric-${m.key}`}
                      checked={enabledKeys.has(m.key)}
                      onCheckedChange={(c) => toggleMetric(m.key, c === true)}
                    />
                    <span className="text-sm">{m.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {isAudioPlayer && (
            <div className="space-y-2 border-t border-border pt-4">
              <Label htmlFor="audio-source">Music source</Label>
              <p className="text-xs text-muted-foreground">
                Where this tile pulls now-playing and the queue from. Plex,
                Jellyfin, and Navidrome / Subsonic use your saved connections;
                Spotify uses your linked Spotify account (link it in Settings).
              </p>
              <Select value={audioSource} onValueChange={setAudioSource}>
                <SelectTrigger id="audio-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plex">Plex</SelectItem>
                  <SelectItem value="jellyfin">Jellyfin</SelectItem>
                  <SelectItem value="subsonic">Navidrome / Subsonic</SelectItem>
                  <SelectItem value="spotify">Spotify</SelectItem>
                </SelectContent>
              </Select>
              {(audioSource === "plex" || audioSource === "subsonic") && (
                <div className="space-y-2 pt-2">
                  <Label>Music browser</Label>
                  <p className="text-xs text-muted-foreground">
                    The “Find music” button opens a panel to search and browse
                    your library and load anything as the queue.
                  </p>
                  <label
                    htmlFor="tile-audioFindMusic"
                    className="flex cursor-pointer select-none items-center justify-between gap-2"
                  >
                    <span className="text-sm">Show “Find music” button</span>
                    <button
                      id="tile-audioFindMusic"
                      type="button"
                      role="switch"
                      aria-checked={audioFindMusic}
                      onClick={() => setAudioFindMusic((v) => !v)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                        audioFindMusic ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${
                          audioFindMusic ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </label>
                  {audioFindMusic && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Choose which tabs it offers.
                      </p>
                      {(
                        [
                          ["audioSearch", "Search", audioSearch, setAudioSearch],
                          ["audioBrowse", "Browse library", audioBrowse, setAudioBrowse],
                          ["audioPlaylists", "Playlists", audioPlaylists, setAudioPlaylists],
                        ] as const
                      ).map(([key, label, value, setValue]) => (
                        <label
                          key={key}
                          htmlFor={`tile-${key}`}
                          className="flex cursor-pointer select-none items-center gap-2"
                        >
                          <input
                            id={`tile-${key}`}
                            type="checkbox"
                            checked={value}
                            onChange={(e) => setValue(e.target.checked)}
                            className="h-4 w-4 accent-primary"
                          />
                          <span className="text-sm">{label}</span>
                        </label>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {isTruenas &&
            (truenasMetric == null || truenasMetric === "pools") && (
              <div className="space-y-2 border-t border-border pt-4">
                <Label>Filter volumes</Label>
                <p className="text-xs text-muted-foreground">
                  Show only the selected ZFS pools (volumes). Leave all checked
                  to show every volume.
                </p>
                {truenasMetricsQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground pt-1">
                    Loading volumes…
                  </p>
                ) : availablePools.length === 0 ? (
                  <p className="text-xs text-muted-foreground pt-1">
                    No ZFS pools were reported by this TrueNAS.
                  </p>
                ) : (
                  <div className="space-y-2 pt-1">
                    <label
                      htmlFor="truenas-pool-all"
                      className="flex items-center gap-2 cursor-pointer select-none"
                    >
                      <Checkbox
                        id="truenas-pool-all"
                        checked={truenasPools == null || truenasPools.length === 0}
                        onCheckedChange={(c) => {
                          if (c === true) setTruenasPools(null);
                          else setTruenasPools([]);
                        }}
                      />
                      <span className="text-sm font-medium">All volumes</span>
                    </label>
                    {availablePools.map((pool) => (
                      <label
                        key={pool}
                        htmlFor={`truenas-pool-${pool}`}
                        className="flex items-center gap-2 cursor-pointer select-none pl-5"
                      >
                        <Checkbox
                          id={`truenas-pool-${pool}`}
                          checked={checkedPools.has(pool)}
                          onCheckedChange={(c) =>
                            toggleTruenasPool(pool, c === true)
                          }
                        />
                        <span className="text-sm">{pool}</span>
                      </label>
                    ))}
                  </div>
                )}
                {orderedVisiblePools.length > 1 && (
                  <div className="space-y-2 pt-3">
                    <Label>Volume order</Label>
                    <p className="text-xs text-muted-foreground">
                      Move volumes up or down to set the order they appear on the
                      tile.
                    </p>
                    <ul className="space-y-1 pt-1">
                      {orderedVisiblePools.map((pool, index) => (
                        <li
                          key={pool}
                          className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1"
                        >
                          <span className="text-sm truncate">{pool}</span>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              aria-label={`Move ${pool} up`}
                              disabled={index === 0}
                              onClick={() =>
                                moveTruenasVolume(index, index - 1)
                              }
                            >
                              <ChevronUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              aria-label={`Move ${pool} down`}
                              disabled={
                                index === orderedVisiblePools.length - 1
                              }
                              onClick={() =>
                                moveTruenasVolume(index, index + 1)
                              }
                            >
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

          {isQbittorrent && torrentsMetricOn && (
            <div className="space-y-2 border-t border-border pt-4">
              <label
                htmlFor="group-by-category"
                className="flex items-center gap-2 cursor-pointer select-none"
              >
                <Checkbox
                  id="group-by-category"
                  checked={groupByCategory}
                  onCheckedChange={(c) => setGroupByCategory(c === true)}
                />
                <span className="text-sm">Group torrents by category</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Show torrents under category headers instead of a flat list.
              </p>
            </div>
          )}

          {isQbittorrent && torrentsMetricOn && (
            <div className="space-y-2 border-t border-border pt-4">
              <Label>Filter categories</Label>
              <p className="text-xs text-muted-foreground">
                Show only torrents in the selected categories. Leave all checked
                to show every category.
              </p>
              {qbStatusQuery.isLoading ? (
                <p className="text-xs text-muted-foreground pt-1">Loading categories…</p>
              ) : availableCategories.length === 0 ? (
                <p className="text-xs text-muted-foreground pt-1">
                  No categories are defined in qBittorrent.
                </p>
              ) : (
                <div className="space-y-2 pt-1">
                  <label
                    htmlFor="category-all"
                    className="flex items-center gap-2 cursor-pointer select-none"
                  >
                    <Checkbox
                      id="category-all"
                      checked={categoryFilter === null}
                      onCheckedChange={(c) => {
                        if (c === true) setCategoryFilter(null);
                        else setCategoryFilter([]);
                      }}
                    />
                    <span className="text-sm font-medium">All categories</span>
                  </label>
                  {availableCategories.map((cat) => (
                    <label
                      key={cat}
                      htmlFor={`category-${cat}`}
                      className="flex items-center gap-2 cursor-pointer select-none pl-5"
                    >
                      <Checkbox
                        id={`category-${cat}`}
                        checked={checkedCategories.has(cat)}
                        onCheckedChange={(c) => toggleCategory(cat, c === true)}
                      />
                      <span className="text-sm">{cat}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {isClock && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="space-y-1.5">
                <Label>Time format</Label>
                <Select
                  value={clockFormat}
                  onValueChange={(v) => setClockFormat(v as "12" | "24")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24">24-hour (14:30)</SelectItem>
                    <SelectItem value="12">12-hour (2:30 PM)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label
                htmlFor="clock-seconds"
                className="flex items-center gap-2 cursor-pointer select-none"
              >
                <Checkbox
                  id="clock-seconds"
                  checked={clockShowSeconds}
                  onCheckedChange={(c) => setClockShowSeconds(c === true)}
                />
                <span className="text-sm">Show seconds</span>
              </label>
              <label
                htmlFor="clock-date"
                className="flex items-center gap-2 cursor-pointer select-none"
              >
                <Checkbox
                  id="clock-date"
                  checked={clockShowDate}
                  onCheckedChange={(c) => setClockShowDate(c === true)}
                />
                <span className="text-sm">Show date</span>
              </label>
              <p className="text-xs text-muted-foreground">
                The clock uses your browser's local time zone.
              </p>
            </div>
          )}

          {isTimer && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="space-y-1.5">
                <Label>Mode</Label>
                <Select
                  value={timerMode}
                  onValueChange={(v) =>
                    setTimerMode(v as "countup" | "countdown" | "pomodoro")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="countup">Count up (stopwatch)</SelectItem>
                    <SelectItem value="countdown">Count down</SelectItem>
                    <SelectItem value="pomodoro">Pomodoro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {timerMode === "countdown" && (
                <div className="space-y-1.5">
                  <Label>Starting duration</Label>
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <Input
                        type="number"
                        min={0}
                        max={99}
                        value={timerHours}
                        onChange={(e) =>
                          setTimerHours(
                            Math.max(0, Math.min(99, Math.floor(Number(e.target.value) || 0))),
                          )
                        }
                        aria-label="Hours"
                      />
                      <span className="block text-center text-[11px] text-muted-foreground">
                        hours
                      </span>
                    </div>
                    <div className="flex-1 space-y-1">
                      <Input
                        type="number"
                        min={0}
                        max={59}
                        value={timerMinutes}
                        onChange={(e) =>
                          setTimerMinutes(
                            Math.max(0, Math.min(59, Math.floor(Number(e.target.value) || 0))),
                          )
                        }
                        aria-label="Minutes"
                      />
                      <span className="block text-center text-[11px] text-muted-foreground">
                        min
                      </span>
                    </div>
                    <div className="flex-1 space-y-1">
                      <Input
                        type="number"
                        min={0}
                        max={59}
                        value={timerSeconds}
                        onChange={(e) =>
                          setTimerSeconds(
                            Math.max(0, Math.min(59, Math.floor(Number(e.target.value) || 0))),
                          )
                        }
                        aria-label="Seconds"
                      />
                      <span className="block text-center text-[11px] text-muted-foreground">
                        sec
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {timerMode === "pomodoro" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Focus length</Label>
                    <Input
                      type="number"
                      min={1}
                      max={180}
                      value={pomodoroFocusMinutes}
                      onChange={(e) =>
                        setPomodoroFocusMinutes(
                          Math.max(1, Math.min(180, Math.floor(Number(e.target.value) || 1))),
                        )
                      }
                      aria-label="Focus length in minutes"
                    />
                    <span className="block text-[11px] text-muted-foreground">
                      minutes
                    </span>
                  </div>
                  <div className="space-y-1">
                    <Label>Short break</Label>
                    <Input
                      type="number"
                      min={1}
                      max={180}
                      value={pomodoroShortBreakMinutes}
                      onChange={(e) =>
                        setPomodoroShortBreakMinutes(
                          Math.max(1, Math.min(180, Math.floor(Number(e.target.value) || 1))),
                        )
                      }
                      aria-label="Short break length in minutes"
                    />
                    <span className="block text-[11px] text-muted-foreground">
                      minutes
                    </span>
                  </div>
                  <div className="space-y-1">
                    <Label>Long break</Label>
                    <Input
                      type="number"
                      min={1}
                      max={180}
                      value={pomodoroLongBreakMinutes}
                      onChange={(e) =>
                        setPomodoroLongBreakMinutes(
                          Math.max(1, Math.min(180, Math.floor(Number(e.target.value) || 1))),
                        )
                      }
                      aria-label="Long break length in minutes"
                    />
                    <span className="block text-[11px] text-muted-foreground">
                      minutes
                    </span>
                  </div>
                  <div className="space-y-1">
                    <Label>Sessions / long break</Label>
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      value={pomodoroSessionsBeforeLongBreak}
                      onChange={(e) =>
                        setPomodoroSessionsBeforeLongBreak(
                          Math.max(1, Math.min(12, Math.floor(Number(e.target.value) || 1))),
                        )
                      }
                      aria-label="Focus sessions before a long break"
                    />
                    <span className="block text-[11px] text-muted-foreground">
                      focus sessions
                    </span>
                  </div>
                </div>
              )}
              {(timerMode === "countdown" || timerMode === "pomodoro") && (
                <div className="space-y-2.5">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="timer-alert"
                      className="flex items-center gap-2 cursor-pointer select-none"
                    >
                      <Checkbox
                        id="timer-alert"
                        checked={timerAlertEnabled}
                        onCheckedChange={(c) => {
                          const on = c === true;
                          setTimerAlertEnabled(on);
                          // Request notification permission up front so the alert
                          // can fire later without a user gesture.
                          if (
                            on &&
                            typeof Notification !== "undefined" &&
                            Notification.permission === "default"
                          ) {
                            void Notification.requestPermission();
                          }
                        }}
                      />
                      <span className="text-sm">
                        {timerMode === "pomodoro"
                          ? "Alert on phase change"
                          : "Alert when finished"}
                      </span>
                    </label>
                    <p className="text-[11px] text-muted-foreground">
                      {timerMode === "pomodoro"
                        ? "Plays a sound and shows a browser notification each time a focus or break phase ends."
                        : "Plays a sound and shows a browser notification when the countdown reaches zero."}
                    </p>
                  </div>
                  {timerAlertEnabled && (
                    <div className="space-y-1.5">
                      <Label>Alert sound</Label>
                      <div className="flex items-center gap-2">
                        <Select
                          value={timerAlertSound}
                          onValueChange={(v) => {
                            const sound = v as TimerAlertSound;
                            setTimerAlertSound(sound);
                            // Preview the chosen sound so picking is a one-click
                            // audition. The select click counts as the gesture
                            // browsers require to unmute the AudioContext.
                            playTimerSound(sound);
                          }}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TIMER_ALERT_SOUND_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={timerAlertSound === "none"}
                          onClick={() => playTimerSound(timerAlertSound)}
                          aria-label="Preview alert sound"
                        >
                          Preview
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Choose "None" to show a browser notification without a
                        sound.
                      </p>
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Start, pause, and reset the timer on the tile itself. Saving these
                settings resets a running timer.
              </p>
            </div>
          )}

          {isWeather && (
            <div className="space-y-3 border-t border-border pt-4">
              <label
                htmlFor="weather-auto"
                className="flex items-center gap-2 cursor-pointer select-none"
              >
                <Checkbox
                  id="weather-auto"
                  checked={weatherAutoLocate}
                  onCheckedChange={(c) => setWeatherAutoLocate(c === true)}
                />
                <span className="text-sm">Auto-detect my location</span>
              </label>

              <div className="space-y-1.5">
                <Label>City</Label>
                <Input
                  value={weatherLocation}
                  onChange={(e) => setWeatherLocation(e.target.value)}
                  placeholder="e.g. London"
                />
                <p className="text-xs text-muted-foreground">
                  {weatherAutoLocate
                    ? "Used if location access is denied or unavailable."
                    : "Enter a city to show its weather."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Units</Label>
                <Select
                  value={weatherUnits}
                  onValueChange={(v) => setWeatherUnits(v as "c" | "f")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="c">Celsius (°C)</SelectItem>
                    <SelectItem value="f">Fahrenheit (°F)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {isSports && (
            <div className="space-y-4 border-t border-border pt-4">
              <div className="space-y-2">
                <Label>Leagues</Label>
                <p className="text-xs text-muted-foreground">
                  Pick the leagues to follow. Scores and headlines cover every
                  selected league.
                </p>
                <div className="space-y-2 pt-1">
                  {SPORTS_LEAGUES.map((l) => (
                    <label
                      key={l.key}
                      htmlFor={`league-${l.key}`}
                      className="flex items-center gap-2 cursor-pointer select-none"
                    >
                      <Checkbox
                        id={`league-${l.key}`}
                        checked={sportsLeagues.includes(l.key)}
                        onCheckedChange={(c) => toggleSportsLeague(l.key, c === true)}
                      />
                      <span className="text-sm">{l.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {sportsLeagues.length > 0 && (
                <div className="space-y-2">
                  <Label>Teams</Label>
                  <p className="text-xs text-muted-foreground">
                    Optional. Narrow to specific teams — leave a league's teams
                    unchecked to show all of its teams.
                  </p>
                  <div className="space-y-3 pt-1">
                    {sportsTeamGroups.map(({ league, teams }) => (
                        <div key={league} className="space-y-1.5">
                          <div className="text-xs font-medium text-foreground">
                            {SPORTS_LEAGUES.find((l) => l.key === league)?.label ?? league}
                          </div>
                          {teams.length === 0 ? (
                            <p className="text-xs text-muted-foreground pl-1">
                              No teams available.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-1">
                              {teams.map((t) => (
                                <label
                                  key={t.key}
                                  htmlFor={`team-${t.key}`}
                                  className="flex items-center gap-2 cursor-pointer select-none"
                                >
                                  <Checkbox
                                    id={`team-${t.key}`}
                                    checked={sportsTeams.includes(t.key)}
                                    onCheckedChange={(c) => toggleSportsTeam(t.key, c === true)}
                                  />
                                  <span className="text-sm truncate">{t.label}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Show</Label>
                <label
                  htmlFor="sports-scores"
                  className="flex items-center gap-2 cursor-pointer select-none"
                >
                  <Checkbox
                    id="sports-scores"
                    checked={sportsShowScores}
                    onCheckedChange={(c) => {
                      const next = c === true;
                      setSportsShowScores(next);
                      // Keep at least one of scores/news on.
                      if (!next && !sportsShowNews) setSportsShowNews(true);
                    }}
                  />
                  <span className="text-sm">Live scores</span>
                </label>
                <label
                  htmlFor="sports-news"
                  className="flex items-center gap-2 cursor-pointer select-none"
                >
                  <Checkbox
                    id="sports-news"
                    checked={sportsShowNews}
                    onCheckedChange={(c) => {
                      const next = c === true;
                      setSportsShowNews(next);
                      // Keep at least one of scores/news on.
                      if (!next && !sportsShowScores) setSportsShowScores(true);
                    }}
                  />
                  <span className="text-sm">Breaking news</span>
                </label>
              </div>
            </div>
          )}

          {isNews && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="space-y-1.5">
                <Label>Feed URL</Label>
                <div className="flex gap-2">
                  <Input
                    value={newsFeedUrl}
                    onChange={(e) => {
                      setNewsFeedUrl(e.target.value);
                      // Stale results no longer describe the edited URL.
                      if (newsTestState !== "idle") {
                        setNewsTestState("idle");
                        setNewsTestItems([]);
                        setNewsTestTitle(null);
                        setNewsTestError(null);
                      }
                    }}
                    placeholder="https://feeds.bbci.co.uk/news/rss.xml"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestFeed}
                    disabled={
                      newsFeedUrl.trim().length === 0 ||
                      newsTestState === "loading"
                    }
                    className="shrink-0"
                  >
                    {newsTestState === "loading" ? "Testing…" : "Test feed"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Paste any RSS or Atom feed URL (e.g. BBC, Hacker News, a
                  subreddit, a blog). Leave blank to preview demo headlines.
                </p>

                {newsTestState === "error" && newsTestError && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {newsTestError}
                  </div>
                )}

                {newsTestState === "success" && (
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 space-y-1.5">
                    <p className="text-xs font-medium text-foreground">
                      ✓ Feed looks good
                      {newsTestTitle ? ` — ${newsTestTitle}` : ""}
                    </p>
                    <ul className="space-y-1">
                      {newsTestItems.map((item, i) => (
                        <li
                          key={i}
                          className="text-xs text-muted-foreground truncate"
                        >
                          • {item.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Maximum headlines</Label>
                <Select
                  value={String(newsMaxItems)}
                  onValueChange={(v) => setNewsMaxItems(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[5, 8, 10, 15, 20, 30].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} headlines
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Upper limit — the tile shows as many as fit its size.
                </p>
              </div>

              <label
                htmlFor="news-timestamp"
                className="flex items-center gap-2 cursor-pointer select-none"
              >
                <Checkbox
                  id="news-timestamp"
                  checked={newsShowTimestamp}
                  onCheckedChange={(c) => setNewsShowTimestamp(c === true)}
                />
                <span className="text-sm">Show published time</span>
              </label>
            </div>
          )}

          {isStocks && (
            <StocksWatchlistEditor
              watchlist={stockWatchlist}
              onChange={setStockWatchlist}
              search={stockSearch}
              onSearchChange={setStockSearch}
            />
          )}

          {isSleeper && (
            <div className="space-y-4 border-t border-border pt-4">
              <div className="space-y-1.5">
                <Label>Sleeper username</Label>
                <Input
                  value={sleeperUsername}
                  onChange={(e) => {
                    setSleeperUsername(e.target.value);
                    // The previously loaded leagues no longer match the edited
                    // username — clear them so the picker re-loads.
                    if (sleeperLoadState !== "idle") {
                      setSleeperLoadState("idle");
                      setSleeperLeagues([]);
                      setSleeperLoadError(null);
                    }
                  }}
                  placeholder="your-sleeper-username"
                />
                <p className="text-xs text-muted-foreground">
                  Your public Sleeper account name. No password needed — Sleeper's
                  data is read-only and public.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Sport</Label>
                  <Select
                    value={sleeperSport}
                    onValueChange={(v) => {
                      setSleeperSport(v);
                      setSleeperLoadState("idle");
                      setSleeperLeagues([]);
                      setSleeperLoadError(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SLEEPER_SPORTS.map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Season</Label>
                  <Input
                    value={sleeperSeason}
                    onChange={(e) => {
                      setSleeperSeason(e.target.value);
                      setSleeperLoadState("idle");
                      setSleeperLeagues([]);
                      setSleeperLoadError(null);
                    }}
                    placeholder="2025"
                    inputMode="numeric"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>League</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleLoadSleeperLeagues}
                    disabled={
                      sleeperUsername.trim().length === 0 ||
                      sleeperSeason.trim().length === 0 ||
                      sleeperLoadState === "loading"
                    }
                    className="shrink-0"
                  >
                    {sleeperLoadState === "loading" ? "Loading…" : "Load leagues"}
                  </Button>
                  <Select
                    value={sleeperLeagueId || NONE}
                    onValueChange={(v) =>
                      setSleeperLeagueId(v === NONE ? "" : v)
                    }
                    disabled={sleeperLeagues.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a league" />
                    </SelectTrigger>
                    <SelectContent>
                      {sleeperLeagues.length === 0 ? (
                        <SelectItem value={NONE} disabled>
                          Load leagues first
                        </SelectItem>
                      ) : (
                        sleeperLeagues.map((l) => (
                          <SelectItem key={l.leagueId} value={l.leagueId}>
                            {l.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {sleeperLoadError && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {sleeperLoadError}
                  </div>
                )}
                {sleeperLeagueId &&
                  sleeperLeagues.length === 0 &&
                  sleeperLoadState === "idle" && (
                    <p className="text-xs text-muted-foreground">
                      A league is saved. Load leagues to change it.
                    </p>
                  )}
                <p className="text-xs text-muted-foreground">
                  Enter your username, then load and pick the league this tile
                  follows.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Show</Label>
                <label
                  htmlFor="sleeper-matchup"
                  className="flex items-center gap-2 cursor-pointer select-none"
                >
                  <Checkbox
                    id="sleeper-matchup"
                    checked={sleeperShowMatchup}
                    onCheckedChange={(c) => setSleeperShowMatchup(c === true)}
                  />
                  <span className="text-sm">Current matchup</span>
                </label>
                <label
                  htmlFor="sleeper-standings"
                  className="flex items-center gap-2 cursor-pointer select-none"
                >
                  <Checkbox
                    id="sleeper-standings"
                    checked={sleeperShowStandings}
                    onCheckedChange={(c) => setSleeperShowStandings(c === true)}
                  />
                  <span className="text-sm">Standings</span>
                </label>
                <label
                  htmlFor="sleeper-transactions"
                  className="flex items-center gap-2 cursor-pointer select-none"
                >
                  <Checkbox
                    id="sleeper-transactions"
                    checked={sleeperShowTransactions}
                    onCheckedChange={(c) =>
                      setSleeperShowTransactions(c === true)
                    }
                  />
                  <span className="text-sm">Recent moves</span>
                </label>
              </div>
            </div>
          )}

          {!isContentless && (
            <div className="space-y-1.5">
              <Label>URL</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
              />
            </div>
          )}

          {!isContentless && (
            <label
              htmlFor="hide-title"
              className="flex items-center gap-2 cursor-pointer select-none"
            >
              <Checkbox
                id="hide-title"
                checked={hideTitle}
                onCheckedChange={(c) => setHideTitle(c === true)}
              />
              <span className="text-sm">Hide title text</span>
            </label>
          )}

          {!isContentless && (
            <label
              htmlFor="scrollable"
              className="flex items-center gap-2 cursor-pointer select-none"
            >
              <Checkbox
                id="scrollable"
                checked={scrollable}
                onCheckedChange={(c) => setScrollable(c === true)}
              />
              <span className="text-sm">Scrollable content</span>
            </label>
          )}

          {integration === NONE && (
            <div className="space-y-1.5">
              <Label>Title Color</Label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="w-8 h-8 rounded-md border border-border flex-shrink-0 shadow-sm"
                  style={{ background: titleColor || "transparent" }}
                  onClick={() => setShowTitleColorPicker((v) => !v)}
                  aria-label="Pick title color"
                />
                <Input
                  value={titleColor ?? ""}
                  onChange={(e) => setTitleColor(e.target.value || null)}
                  placeholder="Automatic"
                  className="font-mono text-sm"
                />
                {eyeDropperSupported && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="flex-shrink-0"
                    onClick={pickTitleColorFromScreen}
                    title="Pick a color from your screen"
                    aria-label="Pick a color from your screen"
                  >
                    <Pipette className="w-4 h-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="flex-shrink-0"
                  onClick={() => setTitleColor(null)}
                  disabled={titleColor === null}
                  title="Reset to automatic color"
                  aria-label="Reset to automatic color"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </div>
              {showTitleColorPicker && (
                <div className="mt-2">
                  <HexColorPicker color={titleColor ?? "#ffffff"} onChange={setTitleColor} />
                </div>
              )}
            </div>
          )}

          {!isContentless && (
          <div className="space-y-1.5">
            <Label>Background Color</Label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="w-8 h-8 rounded-md border border-border flex-shrink-0 shadow-sm"
                style={{ background: bgColor || THEME_BG_PREVIEW }}
                onClick={() => setShowColorPicker((v) => !v)}
                aria-label="Pick color"
              />
              <Input
                value={bgColor ?? ""}
                onChange={(e) => setBgColor(e.target.value || null)}
                placeholder="Theme default"
                className="font-mono text-sm"
              />
              {eyeDropperSupported && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="flex-shrink-0"
                  onClick={pickColorFromScreen}
                  title="Pick a color from your screen"
                  aria-label="Pick a color from your screen"
                >
                  <Pipette className="w-4 h-4" />
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="flex-shrink-0"
                onClick={() => setBgColor(null)}
                disabled={bgColor === null}
                title="Reset to theme default"
                aria-label="Reset to theme default"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
            {showColorPicker && (
              <div className="mt-2">
                <HexColorPicker color={bgColor ?? PICKER_FALLBACK} onChange={setBgColor} />
              </div>
            )}
          </div>
          )}

          {!isContentless && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Image</Label>
              {imageUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                  onClick={clearImage}
                >
                  <X className="w-3.5 h-3.5 mr-1" />
                  Remove
                </Button>
              )}
            </div>

            {/* Live preview of how the tile image will look. Drag it to set a
                custom focal point when the image overflows the box. */}
            <div
              ref={previewRef}
              className={`relative w-full h-28 rounded-md overflow-hidden border border-border ${
                imageUrl
                  ? isDragging
                    ? "cursor-grabbing touch-none select-none"
                    : "cursor-grab touch-none select-none"
                  : ""
              }`}
              style={{ background: bgColor || THEME_BG_PREVIEW }}
              onPointerDown={handlePreviewPointerDown}
              onPointerMove={handlePreviewPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {imageUrl ? (
                <div className={preview.wrapperClassName} style={preview.wrapperStyle}>
                  <img
                    src={imageUrl}
                    alt="preview"
                    className={preview.className}
                    style={preview.style}
                    draggable={false}
                  />
                </div>
              ) : null}
              {imageUrl && <div className="absolute inset-0 bg-black/20" />}
              {/* Title overlay mirrors AppTile placement for plain tiles; widget
                  tiles keep their fixed header so just show a simple label. */}
              {hideTitle ? null : integration === NONE ? (
                <div className={`absolute inset-0 flex flex-col gap-1 p-2 ${titlePreview.containerClass}`}>
                  <span
                    className={`font-bold leading-tight tracking-wide drop-shadow-sm truncate max-w-full ${titlePreview.sizeClass} ${titlePreview.textAlignClass}`}
                    style={{ color: titleColor || (imageUrl ? "#fff" : "inherit") }}
                  >
                    {name || "Preview"}
                  </span>
                </div>
              ) : (
                imageUrl && (
                  <span className="absolute bottom-1.5 left-2 text-xs font-bold text-white drop-shadow-sm truncate max-w-[90%]">
                    {name || "Preview"}
                  </span>
                )
              )}
              {!imageUrl && integration !== NONE && (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  No image selected
                </div>
              )}
            </div>

            {/* Image source: upload a new one, pick from the library, or paste a URL. */}
            <Tabs value={imageSource} onValueChange={(v) => setImageSource(v as ImageSource)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="upload">Upload</TabsTrigger>
                <TabsTrigger value="library">Library</TabsTrigger>
                <TabsTrigger value="url">URL</TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="pt-2">
                <Label
                  htmlFor="file-upload"
                  className="cursor-pointer inline-flex text-xs px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  {uploading ? "Uploading…" : imageUrl ? "Upload replacement" : "Upload image"}
                </Label>
                <input
                  id="file-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUpload}
                  disabled={uploading}
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  Large photos are automatically resized and compressed.
                </p>
              </TabsContent>

              <TabsContent value="library" className="pt-2">
                {uploadsQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : (uploadsQuery.data?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No uploads yet. Upload an image to start your library.
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-1">
                    {uploadsQuery.data!.map((file) => (
                      <div key={file.id} className="relative group/lib aspect-square">
                        <button
                          type="button"
                          onClick={() => pickImage(file.url)}
                          className={`w-full h-full rounded-md overflow-hidden border ${
                            imageUrl === file.url
                              ? "border-primary ring-2 ring-primary"
                              : "border-border hover:border-primary/60"
                          }`}
                          title={file.originalName ?? undefined}
                        >
                          <img
                            src={file.url}
                            alt={file.originalName ?? "uploaded image"}
                            className="w-full h-full object-cover"
                            draggable={false}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteUpload(file.id, file.url)}
                          className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover/lib:opacity-100 transition-opacity shadow"
                          title="Delete from library"
                          aria-label="Delete image"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="url" className="pt-2">
                <Input
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://…/icon.png"
                />
              </TabsContent>
            </Tabs>
          </div>
          )}

          {!isLayoutTile && imageUrl && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Fit</Label>
                <Select value={imageFit} onValueChange={(v) => setImageFit(v as FitValue)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIT_OPTIONS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Position</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setImagePosition(DEFAULT_PAN)}
                    disabled={isCentered}
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    Recenter
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Drag the image in the preview above to position it, and use Scale
                  to zoom in or out.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Scale</Label>
                  <span className="text-xs text-muted-foreground tabular-nums">{imageScale}%</span>
                </div>
                <Slider
                  min={MIN_SCALE}
                  max={MAX_SCALE}
                  step={5}
                  value={[imageScale]}
                  onValueChange={([v]) => setImageScale(v)}
                />
              </div>
            </div>
          )}

          {integration === NONE && name && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="space-y-1.5">
                <Label>Title size</Label>
                <Select value={titleSize} onValueChange={(v) => setTitleSize(v as TitleSize)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TITLE_SIZE_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Title placement</Label>
                <div className="grid grid-cols-3 gap-1 w-[88px]">
                  {POSITION_OPTIONS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setTitlePosition(p.key)}
                      title={p.label}
                      aria-label={p.label}
                      className={`h-7 rounded border transition-colors ${
                        titlePosition === p.key
                          ? "bg-primary border-primary"
                          : "bg-secondary border-border hover:bg-secondary/70"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {mode === "edit" && (
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteTile.isPending}
              className="sm:mr-auto"
            >
              {deleteTile.isPending ? "Deleting…" : "Delete tile"}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving…" : mode === "create" ? "Add tile" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Editor for the Stocks tile's per-tile watchlist. Symbols are added via a live
// symbol search (provider-backed, or built-in sample matches when unconfigured)
// and each entry can optionally carry shares + cost basis to track a position.
function StocksWatchlistEditor({
  watchlist,
  onChange,
  search,
  onSearchChange,
}: {
  watchlist: StockWatchEntry[];
  onChange: (next: StockWatchEntry[]) => void;
  search: string;
  onSearchChange: (next: string) => void;
}) {
  const query = search.trim();
  const { data: searchData, isFetching } = useSearchStocks(
    { q: query },
    {
      query: {
        queryKey: getSearchStocksQueryKey({ q: query }),
        enabled: query.length >= 1,
        staleTime: 30_000,
      },
    },
  );

  const existing = new Set(watchlist.map((e) => e.symbol));
  const results = (searchData?.results ?? []).filter((r) => !existing.has(r.symbol.toUpperCase()));

  function addSymbol(symbol: string) {
    const sym = symbol.trim().toUpperCase();
    if (!sym || existing.has(sym)) return;
    onChange([...watchlist, { symbol: sym, shares: null, costBasis: null }]);
    onSearchChange("");
  }

  function removeAt(index: number) {
    onChange(watchlist.filter((_, i) => i !== index));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= watchlist.length) return;
    const next = [...watchlist];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  }

  function updateAt(index: number, patch: Partial<StockWatchEntry>) {
    onChange(watchlist.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  // Parse a numeric text input into a positive number or null (empty/invalid).
  function parseNum(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="space-y-1.5">
        <Label>Add symbols</Label>
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (results[0]) addSymbol(results[0].symbol);
              else if (query) addSymbol(query);
            }
          }}
          placeholder="Search ticker or company (e.g. AAPL, Apple)"
        />
        <p className="text-xs text-muted-foreground">
          US stocks &amp; ETFs. Without a provider API key the tile shows sample
          quotes; set <code>FINNHUB_API_KEY</code> for live prices.
        </p>

        {query.length >= 1 && (
          <div className="max-h-40 overflow-y-auto rounded-md border border-border divide-y divide-border">
            {isFetching && results.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
            ) : results.length === 0 ? (
              <button
                type="button"
                onClick={() => addSymbol(query)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
              >
                Add &quot;{query.toUpperCase()}&quot;
              </button>
            ) : (
              results.map((r) => (
                <button
                  key={r.symbol}
                  type="button"
                  onClick={() => addSymbol(r.symbol)}
                  className="w-full text-left px-3 py-2 hover:bg-accent flex items-center justify-between gap-2"
                >
                  <span className="text-sm font-medium">{r.symbol}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {r.description}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {watchlist.length > 0 && (
        <div className="space-y-2">
          <Label>Watchlist</Label>
          <p className="text-xs text-muted-foreground">
            Add shares (and optional cost/share) to track a position's value and
            gain/loss. Leave blank for a price-only watchlist.
          </p>
          <div className="space-y-2">
            {watchlist.map((entry, i) => (
              <div
                key={entry.symbol}
                className="rounded-md border border-border p-2 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{entry.symbol}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      disabled={i === watchlist.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive"
                      onClick={() => removeAt(i)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Shares</Label>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={entry.shares ?? ""}
                      onChange={(e) => updateAt(i, { shares: parseNum(e.target.value) })}
                      placeholder="—"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Cost / share</Label>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={entry.costBasis ?? ""}
                      onChange={(e) => updateAt(i, { costBasis: parseNum(e.target.value) })}
                      placeholder="—"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
