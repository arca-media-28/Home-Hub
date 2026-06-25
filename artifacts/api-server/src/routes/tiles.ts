import { Router } from "express";
import { db, tileStmts, pageStmts, type DbTile } from "../lib/db.js";
import { requireAuth, type AuthRequest } from "../lib/auth.js";

const router = Router();

// Parse the stored metrics JSON blob into a string[] (or null = "show all").
// Tolerates legacy/garbage values by falling back to null.
function parseMetrics(raw: string | null): string[] | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    return null;
  } catch {
    return null;
  }
}

// Serialize an incoming metrics value to a JSON blob (or null). Anything that
// isn't an array of strings is stored as null ("show all").
function serializeMetrics(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const keys = value.filter((x): x is string => typeof x === "string");
  return JSON.stringify(keys);
}

// Per-integration extra config. Currently only carries the qBittorrent
// category filter, but the column is a generic JSON object so future
// integrations can stash their own keys here.
interface TileSettings {
  categoryFilter?: string[] | null;
  groupByCategory?: boolean | null;
  clockFormat?: "12" | "24" | null;
  clockShowSeconds?: boolean | null;
  clockShowDate?: boolean | null;
  weatherAutoLocate?: boolean | null;
  weatherLocation?: string | null;
  weatherUnits?: "c" | "f" | null;
  sportsLeagues?: string[] | null;
  sportsTeams?: string[] | null;
  sportsShowScores?: boolean | null;
  sportsShowNews?: boolean | null;
  newsFeedUrl?: string | null;
  newsMaxItems?: number | null;
  newsShowTimestamp?: boolean | null;
  stockWatchlist?: StockWatchEntry[] | null;
  sleeperUsername?: string | null;
  sleeperLeagueId?: string | null;
  sleeperSport?: string | null;
  sleeperSeason?: string | null;
  sleeperShowMatchup?: boolean | null;
  sleeperShowStandings?: boolean | null;
  sleeperShowTransactions?: boolean | null;
  audioSource?: string | null;
  audioFindMusic?: boolean | null;
  audioSearch?: boolean | null;
  audioBrowse?: boolean | null;
  audioPlaylists?: boolean | null;
  scrollable?: boolean | null;
  noteBody?: string | null;
  noteItems?: NoteChecklistItem[] | null;
  noteColor?: string | null;
  noteFontSize?: "sm" | "md" | "lg" | null;
  noteTextColor?: string | null;
  timerMode?: "countup" | "countdown" | "pomodoro" | null;
  timerDuration?: number | null;
  timerRunning?: boolean | null;
  timerStartedAt?: number | null;
  timerAccumulatedMs?: number | null;
  pomodoroFocusMinutes?: number | null;
  pomodoroShortBreakMinutes?: number | null;
  pomodoroLongBreakMinutes?: number | null;
  pomodoroSessionsBeforeLongBreak?: number | null;
  pomodoroPhase?: "focus" | "shortBreak" | "longBreak" | null;
  pomodoroCompletedSessions?: number | null;
  timerAlertEnabled?: boolean | null;
  diceType?: string | null;
  diceCount?: number | null;
  petHunger?: number | null;
  petHappiness?: number | null;
  petEnergy?: number | null;
  petUpdatedAt?: number | null;
  petBodyColor?: string | null;
  petEyes?: string | null;
  petNose?: string | null;
  petMouth?: string | null;
  bonsaiHydration?: number | null;
  bonsaiOvergrowth?: number | null;
  bonsaiGrowth?: number | null;
  bonsaiUpdatedAt?: number | null;
  truenasMetric?: "cpuram" | "network" | "arc" | "pools" | "disks" | null;
  truenasPools?: string[] | null;
}

// A single checklist/to-do item on a Note (post-it) tile: its label text and
// whether it has been ticked off (rendered with a strike-through).
interface NoteChecklistItem {
  text: string;
  done: boolean;
}

// Validate/clean a single checklist item. Returns null when there is no usable
// text so callers can drop garbage rows.
function pickNoteChecklistItem(raw: unknown): NoteChecklistItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj["text"] !== "string") return null;
  return { text: obj["text"], done: obj["done"] === true };
}

// A single watchlist entry for the Stocks tile: a ticker symbol plus optional
// share quantity and average cost basis (which turn the watchlist into a
// lightweight portfolio).
interface StockWatchEntry {
  symbol: string;
  shares?: number | null;
  costBasis?: number | null;
}

// Validate/clean a single watchlist entry. Returns null when there is no usable
// symbol so callers can drop garbage rows.
function pickStockWatchEntry(raw: unknown): StockWatchEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const symbol = typeof obj["symbol"] === "string" ? obj["symbol"].trim().toUpperCase() : "";
  if (!symbol) return null;
  const entry: StockWatchEntry = { symbol };
  if (typeof obj["shares"] === "number" && Number.isFinite(obj["shares"])) {
    entry.shares = obj["shares"];
  } else if (obj["shares"] === null) {
    entry.shares = null;
  }
  if (typeof obj["costBasis"] === "number" && Number.isFinite(obj["costBasis"])) {
    entry.costBasis = obj["costBasis"];
  } else if (obj["costBasis"] === null) {
    entry.costBasis = null;
  }
  return entry;
}

// Copy the known keys of a tile-settings object into a clean TileSettings,
// dropping anything unrecognized. Shared by parse (from DB) and serialize (from
// request body) so both honor exactly the same allow-list.
function pickTileSettings(obj: Record<string, unknown>): TileSettings {
  const result: TileSettings = {};
  if (Array.isArray(obj["categoryFilter"])) {
    result.categoryFilter = obj["categoryFilter"].filter(
      (x): x is string => typeof x === "string",
    );
  } else if (obj["categoryFilter"] === null) {
    result.categoryFilter = null;
  }
  if (typeof obj["groupByCategory"] === "boolean") {
    result.groupByCategory = obj["groupByCategory"];
  } else if (obj["groupByCategory"] === null) {
    result.groupByCategory = null;
  }
  if (obj["clockFormat"] === "12" || obj["clockFormat"] === "24") {
    result.clockFormat = obj["clockFormat"];
  } else if (obj["clockFormat"] === null) {
    result.clockFormat = null;
  }
  if (typeof obj["clockShowSeconds"] === "boolean") {
    result.clockShowSeconds = obj["clockShowSeconds"];
  } else if (obj["clockShowSeconds"] === null) {
    result.clockShowSeconds = null;
  }
  if (typeof obj["clockShowDate"] === "boolean") {
    result.clockShowDate = obj["clockShowDate"];
  } else if (obj["clockShowDate"] === null) {
    result.clockShowDate = null;
  }
  if (typeof obj["weatherAutoLocate"] === "boolean") {
    result.weatherAutoLocate = obj["weatherAutoLocate"];
  } else if (obj["weatherAutoLocate"] === null) {
    result.weatherAutoLocate = null;
  }
  if (typeof obj["weatherLocation"] === "string") {
    result.weatherLocation = obj["weatherLocation"];
  } else if (obj["weatherLocation"] === null) {
    result.weatherLocation = null;
  }
  if (obj["weatherUnits"] === "c" || obj["weatherUnits"] === "f") {
    result.weatherUnits = obj["weatherUnits"];
  } else if (obj["weatherUnits"] === null) {
    result.weatherUnits = null;
  }
  if (Array.isArray(obj["sportsLeagues"])) {
    result.sportsLeagues = obj["sportsLeagues"].filter(
      (x): x is string => typeof x === "string",
    );
  } else if (obj["sportsLeagues"] === null) {
    result.sportsLeagues = null;
  }
  if (Array.isArray(obj["sportsTeams"])) {
    result.sportsTeams = obj["sportsTeams"].filter(
      (x): x is string => typeof x === "string",
    );
  } else if (obj["sportsTeams"] === null) {
    result.sportsTeams = null;
  }
  if (typeof obj["sportsShowScores"] === "boolean") {
    result.sportsShowScores = obj["sportsShowScores"];
  } else if (obj["sportsShowScores"] === null) {
    result.sportsShowScores = null;
  }
  if (typeof obj["sportsShowNews"] === "boolean") {
    result.sportsShowNews = obj["sportsShowNews"];
  } else if (obj["sportsShowNews"] === null) {
    result.sportsShowNews = null;
  }
  if (typeof obj["newsFeedUrl"] === "string") {
    result.newsFeedUrl = obj["newsFeedUrl"];
  } else if (obj["newsFeedUrl"] === null) {
    result.newsFeedUrl = null;
  }
  if (typeof obj["newsMaxItems"] === "number") {
    result.newsMaxItems = obj["newsMaxItems"];
  } else if (obj["newsMaxItems"] === null) {
    result.newsMaxItems = null;
  }
  if (typeof obj["newsShowTimestamp"] === "boolean") {
    result.newsShowTimestamp = obj["newsShowTimestamp"];
  } else if (obj["newsShowTimestamp"] === null) {
    result.newsShowTimestamp = null;
  }
  if (Array.isArray(obj["stockWatchlist"])) {
    result.stockWatchlist = obj["stockWatchlist"]
      .map(pickStockWatchEntry)
      .filter((e): e is StockWatchEntry => e !== null);
  } else if (obj["stockWatchlist"] === null) {
    result.stockWatchlist = null;
  }
  if (typeof obj["sleeperUsername"] === "string") {
    result.sleeperUsername = obj["sleeperUsername"];
  } else if (obj["sleeperUsername"] === null) {
    result.sleeperUsername = null;
  }
  if (typeof obj["sleeperLeagueId"] === "string") {
    result.sleeperLeagueId = obj["sleeperLeagueId"];
  } else if (obj["sleeperLeagueId"] === null) {
    result.sleeperLeagueId = null;
  }
  if (typeof obj["sleeperSport"] === "string") {
    result.sleeperSport = obj["sleeperSport"];
  } else if (obj["sleeperSport"] === null) {
    result.sleeperSport = null;
  }
  if (typeof obj["sleeperSeason"] === "string") {
    result.sleeperSeason = obj["sleeperSeason"];
  } else if (obj["sleeperSeason"] === null) {
    result.sleeperSeason = null;
  }
  if (typeof obj["sleeperShowMatchup"] === "boolean") {
    result.sleeperShowMatchup = obj["sleeperShowMatchup"];
  } else if (obj["sleeperShowMatchup"] === null) {
    result.sleeperShowMatchup = null;
  }
  if (typeof obj["sleeperShowStandings"] === "boolean") {
    result.sleeperShowStandings = obj["sleeperShowStandings"];
  } else if (obj["sleeperShowStandings"] === null) {
    result.sleeperShowStandings = null;
  }
  if (typeof obj["sleeperShowTransactions"] === "boolean") {
    result.sleeperShowTransactions = obj["sleeperShowTransactions"];
  } else if (obj["sleeperShowTransactions"] === null) {
    result.sleeperShowTransactions = null;
  }
  if (typeof obj["audioSource"] === "string") {
    result.audioSource = obj["audioSource"];
  } else if (obj["audioSource"] === null) {
    result.audioSource = null;
  }
  if (typeof obj["audioFindMusic"] === "boolean") {
    result.audioFindMusic = obj["audioFindMusic"];
  } else if (obj["audioFindMusic"] === null) {
    result.audioFindMusic = null;
  }
  if (typeof obj["audioSearch"] === "boolean") {
    result.audioSearch = obj["audioSearch"];
  } else if (obj["audioSearch"] === null) {
    result.audioSearch = null;
  }
  if (typeof obj["audioBrowse"] === "boolean") {
    result.audioBrowse = obj["audioBrowse"];
  } else if (obj["audioBrowse"] === null) {
    result.audioBrowse = null;
  }
  if (typeof obj["audioPlaylists"] === "boolean") {
    result.audioPlaylists = obj["audioPlaylists"];
  } else if (obj["audioPlaylists"] === null) {
    result.audioPlaylists = null;
  }
  if (typeof obj["scrollable"] === "boolean") {
    result.scrollable = obj["scrollable"];
  } else if (obj["scrollable"] === null) {
    result.scrollable = null;
  }
  if (
    obj["truenasMetric"] === "cpuram" ||
    obj["truenasMetric"] === "network" ||
    obj["truenasMetric"] === "arc" ||
    obj["truenasMetric"] === "pools" ||
    obj["truenasMetric"] === "disks"
  ) {
    result.truenasMetric = obj["truenasMetric"];
  } else if (obj["truenasMetric"] === null) {
    result.truenasMetric = null;
  }
  if (Array.isArray(obj["truenasPools"])) {
    result.truenasPools = obj["truenasPools"].filter(
      (x): x is string => typeof x === "string",
    );
  } else if (obj["truenasPools"] === null) {
    result.truenasPools = null;
  }
  if (typeof obj["noteBody"] === "string") {
    result.noteBody = obj["noteBody"];
  } else if (obj["noteBody"] === null) {
    result.noteBody = null;
  }
  if (Array.isArray(obj["noteItems"])) {
    result.noteItems = obj["noteItems"]
      .map(pickNoteChecklistItem)
      .filter((e): e is NoteChecklistItem => e !== null);
  } else if (obj["noteItems"] === null) {
    result.noteItems = null;
  }
  if (typeof obj["noteColor"] === "string") {
    result.noteColor = obj["noteColor"];
  } else if (obj["noteColor"] === null) {
    result.noteColor = null;
  }
  if (obj["noteFontSize"] === "sm" || obj["noteFontSize"] === "md" || obj["noteFontSize"] === "lg") {
    result.noteFontSize = obj["noteFontSize"];
  } else if (obj["noteFontSize"] === null) {
    result.noteFontSize = null;
  }
  if (typeof obj["noteTextColor"] === "string") {
    result.noteTextColor = obj["noteTextColor"];
  } else if (obj["noteTextColor"] === null) {
    result.noteTextColor = null;
  }
  if (
    obj["timerMode"] === "countup" ||
    obj["timerMode"] === "countdown" ||
    obj["timerMode"] === "pomodoro"
  ) {
    result.timerMode = obj["timerMode"];
  } else if (obj["timerMode"] === null) {
    result.timerMode = null;
  }
  if (typeof obj["timerDuration"] === "number") {
    result.timerDuration = obj["timerDuration"];
  } else if (obj["timerDuration"] === null) {
    result.timerDuration = null;
  }
  if (typeof obj["timerRunning"] === "boolean") {
    result.timerRunning = obj["timerRunning"];
  } else if (obj["timerRunning"] === null) {
    result.timerRunning = null;
  }
  if (typeof obj["timerStartedAt"] === "number") {
    result.timerStartedAt = obj["timerStartedAt"];
  } else if (obj["timerStartedAt"] === null) {
    result.timerStartedAt = null;
  }
  if (typeof obj["timerAccumulatedMs"] === "number") {
    result.timerAccumulatedMs = obj["timerAccumulatedMs"];
  } else if (obj["timerAccumulatedMs"] === null) {
    result.timerAccumulatedMs = null;
  }
  if (typeof obj["pomodoroFocusMinutes"] === "number") {
    result.pomodoroFocusMinutes = obj["pomodoroFocusMinutes"];
  } else if (obj["pomodoroFocusMinutes"] === null) {
    result.pomodoroFocusMinutes = null;
  }
  if (typeof obj["pomodoroShortBreakMinutes"] === "number") {
    result.pomodoroShortBreakMinutes = obj["pomodoroShortBreakMinutes"];
  } else if (obj["pomodoroShortBreakMinutes"] === null) {
    result.pomodoroShortBreakMinutes = null;
  }
  if (typeof obj["pomodoroLongBreakMinutes"] === "number") {
    result.pomodoroLongBreakMinutes = obj["pomodoroLongBreakMinutes"];
  } else if (obj["pomodoroLongBreakMinutes"] === null) {
    result.pomodoroLongBreakMinutes = null;
  }
  if (typeof obj["pomodoroSessionsBeforeLongBreak"] === "number") {
    result.pomodoroSessionsBeforeLongBreak = obj["pomodoroSessionsBeforeLongBreak"];
  } else if (obj["pomodoroSessionsBeforeLongBreak"] === null) {
    result.pomodoroSessionsBeforeLongBreak = null;
  }
  if (
    obj["pomodoroPhase"] === "focus" ||
    obj["pomodoroPhase"] === "shortBreak" ||
    obj["pomodoroPhase"] === "longBreak"
  ) {
    result.pomodoroPhase = obj["pomodoroPhase"];
  } else if (obj["pomodoroPhase"] === null) {
    result.pomodoroPhase = null;
  }
  if (typeof obj["pomodoroCompletedSessions"] === "number") {
    result.pomodoroCompletedSessions = obj["pomodoroCompletedSessions"];
  } else if (obj["pomodoroCompletedSessions"] === null) {
    result.pomodoroCompletedSessions = null;
  }
  if (typeof obj["timerAlertEnabled"] === "boolean") {
    result.timerAlertEnabled = obj["timerAlertEnabled"];
  } else if (obj["timerAlertEnabled"] === null) {
    result.timerAlertEnabled = null;
  }
  if (typeof obj["diceType"] === "string") {
    result.diceType = obj["diceType"];
  } else if (obj["diceType"] === null) {
    result.diceType = null;
  }
  if (typeof obj["diceCount"] === "number") {
    result.diceCount = obj["diceCount"];
  } else if (obj["diceCount"] === null) {
    result.diceCount = null;
  }
  if (typeof obj["petHunger"] === "number") {
    result.petHunger = obj["petHunger"];
  } else if (obj["petHunger"] === null) {
    result.petHunger = null;
  }
  if (typeof obj["petHappiness"] === "number") {
    result.petHappiness = obj["petHappiness"];
  } else if (obj["petHappiness"] === null) {
    result.petHappiness = null;
  }
  if (typeof obj["petEnergy"] === "number") {
    result.petEnergy = obj["petEnergy"];
  } else if (obj["petEnergy"] === null) {
    result.petEnergy = null;
  }
  if (typeof obj["petUpdatedAt"] === "number") {
    result.petUpdatedAt = obj["petUpdatedAt"];
  } else if (obj["petUpdatedAt"] === null) {
    result.petUpdatedAt = null;
  }
  if (typeof obj["petBodyColor"] === "string") {
    result.petBodyColor = obj["petBodyColor"];
  } else if (obj["petBodyColor"] === null) {
    result.petBodyColor = null;
  }
  if (typeof obj["petEyes"] === "string") {
    result.petEyes = obj["petEyes"];
  } else if (obj["petEyes"] === null) {
    result.petEyes = null;
  }
  if (typeof obj["petNose"] === "string") {
    result.petNose = obj["petNose"];
  } else if (obj["petNose"] === null) {
    result.petNose = null;
  }
  if (typeof obj["petMouth"] === "string") {
    result.petMouth = obj["petMouth"];
  } else if (obj["petMouth"] === null) {
    result.petMouth = null;
  }
  if (typeof obj["bonsaiHydration"] === "number") {
    result.bonsaiHydration = obj["bonsaiHydration"];
  } else if (obj["bonsaiHydration"] === null) {
    result.bonsaiHydration = null;
  }
  if (typeof obj["bonsaiOvergrowth"] === "number") {
    result.bonsaiOvergrowth = obj["bonsaiOvergrowth"];
  } else if (obj["bonsaiOvergrowth"] === null) {
    result.bonsaiOvergrowth = null;
  }
  if (typeof obj["bonsaiGrowth"] === "number") {
    result.bonsaiGrowth = obj["bonsaiGrowth"];
  } else if (obj["bonsaiGrowth"] === null) {
    result.bonsaiGrowth = null;
  }
  if (typeof obj["bonsaiUpdatedAt"] === "number") {
    result.bonsaiUpdatedAt = obj["bonsaiUpdatedAt"];
  } else if (obj["bonsaiUpdatedAt"] === null) {
    result.bonsaiUpdatedAt = null;
  }
  return result;
}

// Parse the stored tile_settings JSON blob into an object (or null = "no extra
// settings"). Tolerates legacy/garbage values by falling back to null.
function parseTileSettings(raw: string | null): TileSettings | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return pickTileSettings(parsed as Record<string, unknown>);
    }
    return null;
  } catch {
    return null;
  }
}

// Serialize an incoming tile settings value to a JSON blob (or null). Anything
// that isn't a plain object is stored as null ("no extra settings").
function serializeTileSettings(value: unknown): string | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return JSON.stringify(pickTileSettings(value as Record<string, unknown>));
}

export function formatTile(t: DbTile) {
  return {
    id: t.id,
    userId: t.user_id,
    pageId: t.page_id,
    type: t.type,
    integration: t.integration,
    gridX: t.grid_x,
    gridY: t.grid_y,
    gridW: t.grid_w,
    gridH: t.grid_h,
    name: t.name,
    url: t.url,
    bgColor: t.bg_color,
    imageUrl: t.image_url,
    imageFit: t.image_fit,
    imagePosition: t.image_position,
    imageScale: t.image_scale,
    titleSize: t.title_size,
    titlePosition: t.title_position,
    titleColor: t.title_color,
    hideTitle: Boolean(t.hide_title),
    metrics: parseMetrics(t.metrics),
    tileSettings: parseTileSettings(t.tile_settings),
    createdAt: t.created_at,
  };
}

// Serialize a tile for inclusion in a page export. This is `formatTile` minus
// every identity/ownership field (id, userId, pageId, createdAt) so the result
// is safe to share and to re-import under a different user/page. No credential
// data lives on tiles — integrations are referenced by type only — so the
// allow-listed visual/settings fields are all that travel.
export function exportTile(t: DbTile) {
  const { id, userId, pageId, createdAt, ...rest } = formatTile(t);
  void id;
  void userId;
  void pageId;
  void createdAt;
  return rest;
}

// Shared INSERT for new tiles, reused by the create route and the page-import
// flow so both honor exactly the same columns and the same settings allow-list.
const insertTileStmt = db.prepare<
  [number, number | null, string, string | null, number, number, number, number, string | null, string | null, string | null, string | null, string | null, string | null, number | null, string | null, string | null, string | null, number, string | null, string | null],
  { id: number }
>(
  `INSERT INTO tiles (user_id, page_id, type, integration, grid_x, grid_y, grid_w, grid_h, name, url, bg_color, image_url, image_fit, image_position, image_scale, title_size, title_position, title_color, hide_title, metrics, tile_settings)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
);

// Helpers that coerce an untrusted import value to the right column type,
// falling back to a default when the value is missing or the wrong shape.
function importString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function importNumber(v: unknown, fallback: number | null): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// Create a single tile from an (untrusted) exported-tile object on the given
// page. Unknown/garbage fields are dropped, tileSettings is run through the
// pickTileSettings allow-list, and any credential-like field simply has no
// column to land in — so nothing unexpected can be imported.
export function createImportedTile(userId: number, pageId: number, raw: unknown): void {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  insertTileStmt.run(
    userId,
    pageId,
    importString(obj["type"]) ?? "app",
    importString(obj["integration"]),
    importNumber(obj["gridX"], 0)!,
    importNumber(obj["gridY"], 0)!,
    importNumber(obj["gridW"], 4)!,
    importNumber(obj["gridH"], 4)!,
    importString(obj["name"]),
    importString(obj["url"]),
    importString(obj["bgColor"]),
    importString(obj["imageUrl"]),
    importString(obj["imageFit"]),
    importString(obj["imagePosition"]),
    importNumber(obj["imageScale"], null),
    importString(obj["titleSize"]),
    importString(obj["titlePosition"]),
    importString(obj["titleColor"]),
    obj["hideTitle"] === true ? 1 : 0,
    serializeMetrics(obj["metrics"]),
    serializeTileSettings(obj["tileSettings"]),
  );
}

// GET /api/tiles?pageId= — when a pageId is supplied, return only that page's
// tiles (after verifying the page belongs to the caller). Omitting pageId
// returns every tile the user owns, preserving the pre-multi-page behavior.
router.get("/", requireAuth, (req: AuthRequest, res) => {
  const pageIdRaw = req.query["pageId"];
  if (pageIdRaw !== undefined) {
    const pageId = parseInt(String(pageIdRaw));
    if (Number.isNaN(pageId) || !pageStmts.findById.get(pageId, req.user!.userId)) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    const tiles = tileStmts.findAllByPage.all(req.user!.userId, pageId);
    res.json(tiles.map(formatTile));
    return;
  }
  const tiles = tileStmts.findAllByUser.all(req.user!.userId);
  res.json(tiles.map(formatTile));
});

// POST /api/tiles
router.post("/", requireAuth, (req: AuthRequest, res) => {
  const body = req.body as {
    pageId?: number | null;
    type?: string;
    integration?: string | null;
    gridX?: number;
    gridY?: number;
    gridW?: number;
    gridH?: number;
    name?: string;
    url?: string;
    bgColor?: string;
    imageUrl?: string;
    imageFit?: string;
    imagePosition?: string;
    imageScale?: number;
    titleSize?: string;
    titlePosition?: string;
    titleColor?: string;
    hideTitle?: boolean;
    metrics?: string[] | null;
    tileSettings?: TileSettings | null;
  };

  // Resolve which page this tile belongs to. An explicit pageId must belong to
  // the caller; otherwise default to the user's first page. (A user always has
  // at least one page after migration/registration, but tolerate its absence
  // by storing NULL rather than rejecting.)
  let pageId: number | null = null;
  if (body.pageId != null) {
    const page = pageStmts.findById.get(body.pageId, req.user!.userId);
    if (!page) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    pageId = page.id;
  } else {
    const pages = pageStmts.findAllByUser.all(req.user!.userId);
    pageId = pages[0]?.id ?? null;
  }

  const row = insertTileStmt.get(
    req.user!.userId,
    pageId,
    body.type ?? "app",
    body.integration ?? null,
    body.gridX ?? 0,
    body.gridY ?? 0,
    body.gridW ?? 4,
    body.gridH ?? 4,
    body.name ?? null,
    body.url ?? null,
    body.bgColor ?? null,
    body.imageUrl ?? null,
    body.imageFit ?? null,
    body.imagePosition ?? null,
    body.imageScale ?? null,
    body.titleSize ?? null,
    body.titlePosition ?? null,
    body.titleColor ?? null,
    body.hideTitle ? 1 : 0,
    body.metrics === undefined ? null : serializeMetrics(body.metrics),
    body.tileSettings === undefined ? null : serializeTileSettings(body.tileSettings)
  )!;

  const tile = db.prepare<[number], DbTile>("SELECT * FROM tiles WHERE id = ?").get(row.id)!;
  res.status(201).json(formatTile(tile));
});

// GET /api/tiles/:id
router.get("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = parseInt(String(req.params["id"]));
  const tile = tileStmts.findById.get(id, req.user!.userId);
  if (!tile) {
    res.status(404).json({ error: "Tile not found" });
    return;
  }
  res.json(formatTile(tile));
});

// PUT /api/tiles/:id
router.put("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = parseInt(String(req.params["id"]));
  const existing = tileStmts.findById.get(id, req.user!.userId);
  if (!existing) {
    res.status(404).json({ error: "Tile not found" });
    return;
  }

  const body = req.body as {
    integration?: string | null;
    gridX?: number;
    gridY?: number;
    gridW?: number;
    gridH?: number;
    name?: string;
    url?: string;
    bgColor?: string | null;
    imageUrl?: string;
    imageFit?: string;
    imagePosition?: string | null;
    imageScale?: number | null;
    titleSize?: string | null;
    titlePosition?: string | null;
    titleColor?: string | null;
    hideTitle?: boolean;
    metrics?: string[] | null;
    tileSettings?: TileSettings | null;
  };

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (body.integration !== undefined) { updates.push("integration = ?"); params.push(body.integration); }
  if (body.gridX !== undefined) { updates.push("grid_x = ?"); params.push(body.gridX); }
  if (body.gridY !== undefined) { updates.push("grid_y = ?"); params.push(body.gridY); }
  if (body.gridW !== undefined) { updates.push("grid_w = ?"); params.push(body.gridW); }
  if (body.gridH !== undefined) { updates.push("grid_h = ?"); params.push(body.gridH); }
  if (body.name !== undefined) { updates.push("name = ?"); params.push(body.name); }
  if (body.url !== undefined) { updates.push("url = ?"); params.push(body.url); }
  if (body.bgColor !== undefined) { updates.push("bg_color = ?"); params.push(body.bgColor); }
  if (body.imageUrl !== undefined) { updates.push("image_url = ?"); params.push(body.imageUrl); }
  if (body.imageFit !== undefined) { updates.push("image_fit = ?"); params.push(body.imageFit); }
  if (body.imagePosition !== undefined) { updates.push("image_position = ?"); params.push(body.imagePosition); }
  if (body.imageScale !== undefined) { updates.push("image_scale = ?"); params.push(body.imageScale); }
  if (body.titleSize !== undefined) { updates.push("title_size = ?"); params.push(body.titleSize); }
  if (body.titlePosition !== undefined) { updates.push("title_position = ?"); params.push(body.titlePosition); }
  if (body.titleColor !== undefined) { updates.push("title_color = ?"); params.push(body.titleColor); }
  if (body.hideTitle !== undefined) { updates.push("hide_title = ?"); params.push(body.hideTitle ? 1 : 0); }
  if (body.metrics !== undefined) { updates.push("metrics = ?"); params.push(body.metrics === null ? null : serializeMetrics(body.metrics)); }
  if (body.tileSettings !== undefined) { updates.push("tile_settings = ?"); params.push(body.tileSettings === null ? null : serializeTileSettings(body.tileSettings)); }

  if (updates.length > 0) {
    params.push(id);
    db.prepare(`UPDATE tiles SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  }

  const updated = db.prepare<[number], DbTile>("SELECT * FROM tiles WHERE id = ?").get(id)!;
  res.json(formatTile(updated));
});

// DELETE /api/tiles/:id
router.delete("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = parseInt(String(req.params["id"]));
  const existing = tileStmts.findById.get(id, req.user!.userId);
  if (!existing) {
    res.status(404).json({ error: "Tile not found" });
    return;
  }
  tileStmts.delete.run(id, req.user!.userId);
  res.status(204).send();
});

export default router;
