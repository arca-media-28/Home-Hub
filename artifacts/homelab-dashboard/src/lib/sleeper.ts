// Client-side Sleeper fantasy-sports data module. Like the Sports tile, this
// fetches directly from a free public API in the browser — Sleeper's read
// endpoints (https://api.sleeper.app/v1) are keyless and public for any league
// id, so there is no backend proxy or service connection. Every helper
// normalizes the raw API shapes so the tile never deals with snake_case blobs.

const BASE = "https://api.sleeper.app/v1";

// Sleeper supports a handful of sports for its season-state endpoint. NFL is by
// far the most common; the others are included for completeness.
export interface SleeperSport {
  key: string;
  label: string;
}

export const SLEEPER_SPORTS: SleeperSport[] = [
  { key: "nfl", label: "NFL" },
  { key: "nba", label: "NBA" },
  { key: "lcs", label: "LCS" },
];

const SPORT_BY_KEY = new Map(SLEEPER_SPORTS.map((s) => [s.key, s]));

export function sleeperSportLabel(key: string): string {
  return SPORT_BY_KEY.get(key)?.label ?? key.toUpperCase();
}

// ── Normalized shapes the tile renders ───────────────────────────────────────
export interface SleeperUser {
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
}

// Which fantasy-points column to read from projections/scoring, derived from
// the league's reception scoring (rec): 1 → full PPR, 0.5 → half PPR, else std.
export type ScoringFormat = "ppr" | "half_ppr" | "std";

export interface SleeperLeague {
  leagueId: string;
  name: string;
  season: string;
  sport: string;
  // Sleeper status: "pre_draft" | "drafting" | "in_season" | "complete" | ...
  status: string;
  totalRosters: number;
  scoringFormat: ScoringFormat;
}

export interface SleeperRoster {
  rosterId: number;
  ownerId: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export interface SleeperLeagueUser {
  userId: string;
  displayName: string;
  teamName: string | null;
  avatar: string | null;
}

export interface SleeperMatchup {
  rosterId: number;
  matchupId: number | null;
  points: number;
  // Player ids in the starting lineup (used to sum projected points). May
  // contain "0" placeholders for empty slots, which are ignored.
  starters: string[];
}

// Projected fantasy points for a player, split by scoring format so the tile
// can pick the column matching the league's settings.
export interface SleeperProjection {
  ppr: number;
  half_ppr: number;
  std: number;
}

export interface SleeperTransaction {
  id: string;
  // "trade" | "waiver" | "free_agent"
  type: string;
  status: string;
  created: number;
  // Roster ids that added each player (player id → roster id).
  adds: Array<{ playerId: string; rosterId: number }>;
  rosterIds: number[];
}

export interface SleeperPlayer {
  name: string;
  team: string | null;
  position: string | null;
}

export interface SleeperState {
  week: number;
  season: string;
  // "pre" | "regular" | "post" | "off"
  seasonType: string;
}

// ── Raw API shapes (narrowed to the fields we read) ──────────────────────────
interface RawUser {
  user_id?: string;
  username?: string;
  display_name?: string;
  avatar?: string | null;
  metadata?: { team_name?: string | null } | null;
}

interface RawLeague {
  league_id?: string;
  name?: string;
  season?: string;
  sport?: string;
  status?: string;
  total_rosters?: number;
  scoring_settings?: { rec?: number } | null;
}

interface RawRoster {
  roster_id?: number;
  owner_id?: string | null;
  settings?: {
    wins?: number;
    losses?: number;
    ties?: number;
    fpts?: number;
    fpts_decimal?: number;
  } | null;
}

interface RawMatchup {
  roster_id?: number;
  matchup_id?: number | null;
  points?: number | null;
  starters?: string[] | null;
}

interface RawTransaction {
  transaction_id?: string;
  type?: string;
  status?: string;
  created?: number;
  adds?: Record<string, number> | null;
  roster_ids?: number[] | null;
}

interface RawState {
  week?: number;
  season?: string;
  season_type?: string;
  display_week?: number;
}

interface RawPlayer {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  team?: string | null;
  position?: string | null;
}

const avatarUrl = (id: string | null | undefined): string | null =>
  id ? `https://sleepercdn.com/avatars/thumbs/${id}` : null;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sleeper ${res.status} ${url}`);
  return (await res.json()) as T;
}

// ── Fetchers (each returns a normalized shape) ───────────────────────────────

// Resolve a Sleeper account by username (case-insensitive on Sleeper's side).
// Returns null when the username does not exist (Sleeper replies with null).
export async function fetchSleeperUser(username: string): Promise<SleeperUser | null> {
  const raw = await getJson<RawUser | null>(
    `${BASE}/user/${encodeURIComponent(username.trim())}`,
  );
  if (!raw || !raw.user_id) return null;
  return {
    userId: raw.user_id,
    username: raw.username ?? username,
    displayName: raw.display_name ?? raw.username ?? username,
    avatar: avatarUrl(raw.avatar),
  };
}

// All leagues a user belongs to for a given sport + season. Used by the editor's
// league picker once a username is entered.
export async function fetchUserLeagues(
  userId: string,
  sport: string,
  season: string,
): Promise<SleeperLeague[]> {
  const raw = await getJson<RawLeague[]>(
    `${BASE}/user/${userId}/leagues/${sport}/${season}`,
  );
  return (raw ?? [])
    .filter((l): l is RawLeague & { league_id: string } => Boolean(l?.league_id))
    .map(normalizeLeague);
}

// A single league's metadata (name + status), used to detect off-season.
export async function fetchLeague(leagueId: string): Promise<SleeperLeague> {
  const raw = await getJson<RawLeague>(`${BASE}/league/${leagueId}`);
  return normalizeLeague(raw);
}

function normalizeLeague(raw: RawLeague): SleeperLeague {
  const rec = raw.scoring_settings?.rec ?? 0;
  const scoringFormat: ScoringFormat =
    rec >= 1 ? "ppr" : rec >= 0.5 ? "half_ppr" : "std";
  return {
    leagueId: raw.league_id ?? "",
    name: raw.name ?? "League",
    season: raw.season ?? "",
    sport: raw.sport ?? "nfl",
    status: raw.status ?? "in_season",
    totalRosters: raw.total_rosters ?? 0,
    scoringFormat,
  };
}

export async function fetchLeagueRosters(leagueId: string): Promise<SleeperRoster[]> {
  const raw = await getJson<RawRoster[]>(`${BASE}/league/${leagueId}/rosters`);
  return (raw ?? []).map((r) => {
    const s = r.settings ?? {};
    // Sleeper splits fantasy points into an integer part (fpts) and a decimal
    // part (fpts_decimal, 0–99), so recombine them into a single number.
    const pointsFor = (s.fpts ?? 0) + (s.fpts_decimal ?? 0) / 100;
    return {
      rosterId: r.roster_id ?? 0,
      ownerId: r.owner_id ?? null,
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      ties: s.ties ?? 0,
      pointsFor: Math.round(pointsFor * 100) / 100,
    };
  });
}

export async function fetchLeagueUsers(leagueId: string): Promise<SleeperLeagueUser[]> {
  const raw = await getJson<RawUser[]>(`${BASE}/league/${leagueId}/users`);
  return (raw ?? []).map((u) => ({
    userId: u.user_id ?? "",
    displayName: u.display_name ?? "Manager",
    teamName: u.metadata?.team_name ?? null,
    avatar: avatarUrl(u.avatar),
  }));
}

export async function fetchMatchups(
  leagueId: string,
  week: number,
): Promise<SleeperMatchup[]> {
  const raw = await getJson<RawMatchup[]>(
    `${BASE}/league/${leagueId}/matchups/${week}`,
  );
  return (raw ?? []).map((m) => ({
    rosterId: m.roster_id ?? 0,
    matchupId: m.matchup_id ?? null,
    points: m.points ?? 0,
    starters: (m.starters ?? []).filter((id) => id && id !== "0"),
  }));
}

// Per-player projected points for a sport/season/week, keyed by player id.
// Sleeper exposes projections on the bare host (not the /v1 base). The shape is
// an array of { player_id, stats: { pts_ppr, pts_half_ppr, pts_std } }. Returns
// an empty map on any failure so the matchup can still show actual scores.
export async function fetchProjections(
  sport: string,
  season: string,
  week: number,
): Promise<Map<string, SleeperProjection>> {
  const map = new Map<string, SleeperProjection>();
  try {
    const raw = await getJson<
      Array<{
        player_id?: string;
        stats?: {
          pts_ppr?: number;
          pts_half_ppr?: number;
          pts_std?: number;
        } | null;
      }>
    >(
      `https://api.sleeper.app/projections/${sport}/${season}/${week}?season_type=regular`,
    );
    for (const row of raw ?? []) {
      if (!row.player_id) continue;
      const s = row.stats ?? {};
      map.set(row.player_id, {
        ppr: s.pts_ppr ?? 0,
        half_ppr: s.pts_half_ppr ?? s.pts_ppr ?? 0,
        std: s.pts_std ?? 0,
      });
    }
  } catch {
    // Projections are best-effort; the tile falls back to actual-only.
  }
  return map;
}

export async function fetchTransactions(
  leagueId: string,
  week: number,
): Promise<SleeperTransaction[]> {
  const raw = await getJson<RawTransaction[]>(
    `${BASE}/league/${leagueId}/transactions/${week}`,
  );
  return (raw ?? []).map((t) => ({
    id: t.transaction_id ?? `${t.created ?? 0}`,
    type: t.type ?? "free_agent",
    status: t.status ?? "complete",
    created: t.created ?? 0,
    adds: Object.entries(t.adds ?? {}).map(([playerId, rosterId]) => ({
      playerId,
      rosterId,
    })),
    rosterIds: t.roster_ids ?? [],
  }));
}

// Season state (current week + season type) for a sport. The tile uses this to
// know which week's matchup/transactions to fetch. `fetchNflState` is the common
// case named explicitly for NFL leagues.
export async function fetchSportState(sport: string): Promise<SleeperState> {
  const raw = await getJson<RawState>(`${BASE}/state/${sport}`);
  return {
    week: raw.week ?? raw.display_week ?? 1,
    season: raw.season ?? "",
    seasonType: raw.season_type ?? "regular",
  };
}

export function fetchNflState(): Promise<SleeperState> {
  return fetchSportState("nfl");
}

// The full player catalog for a sport, keyed by player id. This is a large
// (multi-MB) payload that Sleeper recommends fetching at most once per day, so
// callers should cache it aggressively (the tile uses an effectively infinite
// stale time). Only fetched when transactions are actually shown so most tiles
// never pay for it.
export async function fetchPlayers(sport: string): Promise<Map<string, SleeperPlayer>> {
  const raw = await getJson<Record<string, RawPlayer>>(`${BASE}/players/${sport}`);
  const map = new Map<string, SleeperPlayer>();
  for (const [id, p] of Object.entries(raw ?? {})) {
    const name =
      p.full_name ||
      [p.first_name, p.last_name].filter(Boolean).join(" ") ||
      id;
    map.set(id, {
      name,
      team: p.team ?? null,
      position: p.position ?? null,
    });
  }
  return map;
}

// ── Derived view models the tile consumes ────────────────────────────────────
export interface StandingRow {
  rosterId: number;
  rank: number;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  // True for the configured user's own team, so the tile can highlight it.
  isSelf: boolean;
}

export interface MatchupSide {
  teamName: string;
  // Live/actual fantasy points accrued so far.
  points: number;
  // Sum of projected points for the starting lineup, or null when projections
  // are unavailable.
  projected: number | null;
}

export interface MatchupView {
  self: MatchupSide;
  opponent: MatchupSide | null;
  // "win" | "loss" | "tie" relative to the user, or null when undecided/no data.
  outcome: "win" | "loss" | "tie" | null;
}

export interface TransactionView {
  id: string;
  type: string;
  created: number;
  playerName: string;
  // The fantasy team that made the move (added the player).
  teamName: string;
}

// Resolve a roster's display name: the manager's custom team name when set,
// otherwise their Sleeper display name, falling back to a roster label.
export function rosterTeamName(
  rosterId: number,
  rosters: SleeperRoster[],
  users: SleeperLeagueUser[],
): string {
  const roster = rosters.find((r) => r.rosterId === rosterId);
  const user = roster?.ownerId
    ? users.find((u) => u.userId === roster.ownerId)
    : undefined;
  return user?.teamName || user?.displayName || `Team ${rosterId}`;
}

// Build the ranked standings: most wins first, then points-for as a tiebreak.
export function buildStandings(
  rosters: SleeperRoster[],
  users: SleeperLeagueUser[],
  selfUserId: string | null,
): StandingRow[] {
  const sorted = [...rosters].sort(
    (a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor,
  );
  return sorted.map((r, i) => ({
    rosterId: r.rosterId,
    rank: i + 1,
    teamName: rosterTeamName(r.rosterId, rosters, users),
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    pointsFor: r.pointsFor,
    isSelf: Boolean(selfUserId && r.ownerId === selfUserId),
  }));
}

// Sum projected points for a matchup entry's starters, picking the scoring
// column that matches the league. Returns null when no projection data is
// available so the UI can hide the projected figure instead of showing 0.
function projectedFor(
  entry: SleeperMatchup,
  projections: Map<string, SleeperProjection> | undefined,
  format: ScoringFormat,
): number | null {
  if (!projections || projections.size === 0) return null;
  let total = 0;
  let matched = false;
  for (const id of entry.starters) {
    const proj = projections.get(id);
    if (!proj) continue;
    matched = true;
    total += proj[format];
  }
  if (!matched) return null;
  return Math.round(total * 100) / 100;
}

// Build the user's current-week matchup from the matchup list. Returns null when
// the user's roster can't be found or has no matchup this week (e.g. bye/off).
export function buildMatchup(
  matchups: SleeperMatchup[],
  selfRosterId: number | null,
  rosters: SleeperRoster[],
  users: SleeperLeagueUser[],
  projections?: Map<string, SleeperProjection>,
  scoringFormat: ScoringFormat = "ppr",
): MatchupView | null {
  if (selfRosterId == null) return null;
  const mine = matchups.find((m) => m.rosterId === selfRosterId);
  if (!mine) return null;

  const selfName = rosterTeamName(selfRosterId, rosters, users);
  const oppEntry =
    mine.matchupId != null
      ? matchups.find(
          (m) => m.matchupId === mine.matchupId && m.rosterId !== selfRosterId,
        )
      : undefined;

  if (!oppEntry) {
    return {
      self: {
        teamName: selfName,
        points: mine.points,
        projected: projectedFor(mine, projections, scoringFormat),
      },
      opponent: null,
      outcome: null,
    };
  }

  const oppName = rosterTeamName(oppEntry.rosterId, rosters, users);
  let outcome: MatchupView["outcome"] = null;
  if (mine.points !== oppEntry.points) {
    outcome = mine.points > oppEntry.points ? "win" : "loss";
  } else if (mine.points > 0 || oppEntry.points > 0) {
    outcome = "tie";
  }

  return {
    self: {
      teamName: selfName,
      points: mine.points,
      projected: projectedFor(mine, projections, scoringFormat),
    },
    opponent: {
      teamName: oppName,
      points: oppEntry.points,
      projected: projectedFor(oppEntry, projections, scoringFormat),
    },
    outcome,
  };
}

// Flatten transactions into a recent activity feed: one row per added player,
// newest first. Pending/failed waivers are dropped so the feed shows completed
// moves only.
export function buildTransactionFeed(
  transactions: SleeperTransaction[],
  rosters: SleeperRoster[],
  users: SleeperLeagueUser[],
  players: Map<string, SleeperPlayer> | undefined,
): TransactionView[] {
  const rows: TransactionView[] = [];
  const sorted = [...transactions]
    .filter((t) => t.status === "complete")
    .sort((a, b) => b.created - a.created);
  for (const t of sorted) {
    for (const add of t.adds) {
      const player = players?.get(add.playerId);
      const playerName = player
        ? player.position
          ? `${player.name} (${player.position})`
          : player.name
        : `Player ${add.playerId}`;
      rows.push({
        id: `${t.id}-${add.playerId}`,
        type: t.type,
        created: t.created,
        playerName,
        teamName: rosterTeamName(add.rosterId, rosters, users),
      });
    }
  }
  return rows;
}

// Human label for a transaction type.
export function transactionTypeLabel(type: string): string {
  switch (type) {
    case "trade":
      return "Trade";
    case "waiver":
      return "Waiver";
    case "free_agent":
      return "Free agent";
    default:
      return type;
  }
}
