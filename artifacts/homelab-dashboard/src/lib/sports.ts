// Client-side sports data module. Mirrors how the Weather tile fetches directly
// from a free public API in the browser — there is no backend proxy, API key,
// or service connection. Data comes from ESPN's public site API
// (site.api.espn.com), which is keyless and covers the major leagues.

// ── League catalog ───────────────────────────────────────────────────────────
// A curated list of leagues the Sports tile can follow. Each entry maps a stable
// `key` (persisted in the tile settings) to the two ESPN path segments
// (`sport`/`league`) used to build scoreboard/news/teams URLs.
export interface SportsLeague {
  key: string;
  label: string;
  sport: string;
  league: string;
}

export const SPORTS_LEAGUES: SportsLeague[] = [
  { key: "nfl", label: "NFL", sport: "football", league: "nfl" },
  { key: "nba", label: "NBA", sport: "basketball", league: "nba" },
  { key: "mlb", label: "MLB", sport: "baseball", league: "mlb" },
  { key: "nhl", label: "NHL", sport: "hockey", league: "nhl" },
  { key: "mls", label: "MLS", sport: "soccer", league: "usa.1" },
  { key: "eng.1", label: "English Premier League", sport: "soccer", league: "eng.1" },
  { key: "esp.1", label: "La Liga", sport: "soccer", league: "esp.1" },
  { key: "ger.1", label: "Bundesliga", sport: "soccer", league: "ger.1" },
  { key: "ita.1", label: "Serie A", sport: "soccer", league: "ita.1" },
  {
    key: "uefa.champions",
    label: "UEFA Champions League",
    sport: "soccer",
    league: "uefa.champions",
  },
];

const LEAGUE_BY_KEY = new Map(SPORTS_LEAGUES.map((l) => [l.key, l]));

export function leagueLabel(key: string): string {
  return LEAGUE_BY_KEY.get(key)?.label ?? key;
}

const BASE = "https://site.api.espn.com/apis/site/v2/sports";

// Compose a per-league team key as "<leagueKey>:<teamId>" so the same team id
// across different leagues never collides.
export function teamKey(leagueKey: string, teamId: string): string {
  return `${leagueKey}:${teamId}`;
}

// ── Normalized shapes the tile renders ───────────────────────────────────────
export interface SportsTeamSide {
  name: string;
  abbrev: string;
  score: string | null;
  logo: string | null;
}

export interface SportsScore {
  id: string;
  leagueKey: string;
  league: string;
  // ESPN status state: "pre" (scheduled), "in" (live), "post" (finished).
  state: "pre" | "in" | "post";
  // Human status, e.g. "Final", "7:30 PM", "Q3 4:12".
  detail: string;
  home: SportsTeamSide;
  away: SportsTeamSide;
  startDate: string | null;
}

export interface SportsHeadline {
  id: string;
  leagueKey: string;
  league: string;
  headline: string;
  description: string | null;
  published: string | null;
  link: string | null;
}

export interface SportsData {
  scores: SportsScore[];
  headlines: SportsHeadline[];
}

export interface SportsOptions {
  leagues: string[];
  // Scoped team keys ("<leagueKey>:<teamId>"). A league with no entries here
  // shows all of its teams.
  teams: string[];
  showScores: boolean;
  showNews: boolean;
}

// ── ESPN response shapes (narrowed to the fields we read) ────────────────────
interface EspnCompetitor {
  homeAway?: string;
  score?: string;
  team?: {
    id?: string;
    displayName?: string;
    shortDisplayName?: string;
    abbreviation?: string;
    logo?: string;
  };
}

interface EspnEvent {
  id?: string;
  date?: string;
  status?: { type?: { state?: string; shortDetail?: string; detail?: string } };
  competitions?: Array<{
    competitors?: EspnCompetitor[];
    status?: { type?: { state?: string; shortDetail?: string; detail?: string } };
  }>;
}

interface EspnArticle {
  // ESPN gives articles either a numeric/string id or only a links blob, so we
  // fall back to the headline for a stable React key.
  id?: string | number;
  headline?: string;
  description?: string;
  published?: string;
  links?: { web?: { href?: string } };
  categories?: Array<{ team?: { id?: number | string }; teamId?: number | string }>;
}

function side(c: EspnCompetitor | undefined): SportsTeamSide {
  const team = c?.team;
  return {
    name: team?.shortDisplayName || team?.displayName || team?.abbreviation || "—",
    abbrev: team?.abbreviation || "",
    score: c?.score ?? null,
    logo: team?.logo ?? null,
  };
}

// The set of team ids selected for a given league (without the league prefix).
// Empty set means "no team filter for this league" → show every team.
function teamIdsForLeague(leagueKey: string, teams: string[]): Set<string> {
  const prefix = `${leagueKey}:`;
  const ids = new Set<string>();
  for (const t of teams) {
    if (t.startsWith(prefix)) ids.add(t.slice(prefix.length));
  }
  return ids;
}

async function fetchLeagueScores(
  league: SportsLeague,
  teamFilter: Set<string>,
): Promise<SportsScore[]> {
  const res = await fetch(`${BASE}/${league.sport}/${league.league}/scoreboard`);
  if (!res.ok) throw new Error(`scoreboard ${league.key} ${res.status}`);
  const j = (await res.json()) as { events?: EspnEvent[] };
  const events = j.events ?? [];

  const scores: SportsScore[] = [];
  for (const ev of events) {
    const comp = ev.competitions?.[0];
    const competitors = comp?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home") ?? competitors[0];
    const away = competitors.find((c) => c.homeAway === "away") ?? competitors[1];

    // Team filter: keep the event only when one of its teams is selected. An
    // empty filter for this league means "all teams".
    if (teamFilter.size > 0) {
      const homeId = home?.team?.id ?? "";
      const awayId = away?.team?.id ?? "";
      if (!teamFilter.has(homeId) && !teamFilter.has(awayId)) continue;
    }

    const statusType = comp?.status?.type ?? ev.status?.type;
    const state = (statusType?.state as SportsScore["state"]) ?? "pre";
    const detail = statusType?.shortDetail || statusType?.detail || "";

    scores.push({
      id: ev.id ?? `${league.key}-${scores.length}`,
      leagueKey: league.key,
      league: league.label,
      state,
      detail,
      home: side(home),
      away: side(away),
      startDate: ev.date ?? null,
    });
  }

  // Live games first, then upcoming, then finished — most interesting on top.
  const order: Record<SportsScore["state"], number> = { in: 0, pre: 1, post: 2 };
  scores.sort((a, b) => order[a.state] - order[b.state]);
  return scores;
}

async function fetchLeagueNews(
  league: SportsLeague,
  teamFilter: Set<string>,
): Promise<SportsHeadline[]> {
  const res = await fetch(`${BASE}/${league.sport}/${league.league}/news`);
  if (!res.ok) throw new Error(`news ${league.key} ${res.status}`);
  const j = (await res.json()) as { articles?: EspnArticle[] };
  const articles = j.articles ?? [];

  const toHeadline = (a: EspnArticle): SportsHeadline => ({
    id: String(a.id ?? a.headline),
    leagueKey: league.key,
    league: league.label,
    headline: a.headline as string,
    description: a.description ?? null,
    published: a.published ?? null,
    link: a.links?.web?.href ?? null,
  });

  const named = articles.filter((a) => a.headline);

  // When teams are selected, prefer articles tagged with one of those teams.
  // But ESPN's per-league news feed is short and sparsely team-tagged, so a
  // strict filter often empties the section. Fall back to the league's general
  // headlines when no team-specific articles exist, so "Breaking news" never
  // silently disappears just because a team filter is set.
  if (teamFilter.size > 0) {
    const tagged = named.filter((a) =>
      (a.categories ?? []).some((c) => {
        const id = c.team?.id ?? c.teamId;
        return id != null && teamFilter.has(String(id));
      }),
    );
    if (tagged.length > 0) return tagged.map(toHeadline);
  }

  return named.map(toHeadline);
}

// Fetch and normalize scores and/or headlines for the selected leagues/teams.
// Each league is fetched independently and a single failing league never blanks
// the whole tile — its error is swallowed so the others still render.
export async function fetchSports(opts: SportsOptions): Promise<SportsData> {
  const leagues = opts.leagues
    .map((k) => LEAGUE_BY_KEY.get(k))
    .filter((l): l is SportsLeague => Boolean(l));

  const scorePromises: Promise<SportsScore[]>[] = [];
  const newsPromises: Promise<SportsHeadline[]>[] = [];

  for (const league of leagues) {
    const filter = teamIdsForLeague(league.key, opts.teams);
    if (opts.showScores) scorePromises.push(fetchLeagueScores(league, filter));
    if (opts.showNews) newsPromises.push(fetchLeagueNews(league, filter));
  }

  const [scoreResults, newsResults] = await Promise.all([
    Promise.allSettled(scorePromises),
    Promise.allSettled(newsPromises),
  ]);

  const scores: SportsScore[] = [];
  for (const r of scoreResults) {
    if (r.status === "fulfilled") scores.push(...r.value);
  }

  const headlines: SportsHeadline[] = [];
  for (const r of newsResults) {
    if (r.status === "fulfilled") headlines.push(...r.value);
  }

  // Interleave live games to the front across leagues too.
  const order: Record<SportsScore["state"], number> = { in: 0, pre: 1, post: 2 };
  scores.sort((a, b) => order[a.state] - order[b.state]);

  // Newest headlines first across leagues.
  headlines.sort((a, b) => {
    const ta = a.published ? Date.parse(a.published) : 0;
    const tb = b.published ? Date.parse(b.published) : 0;
    return tb - ta;
  });

  return { scores, headlines };
}

// ── Team list (for the tile editor's dependent team multi-select) ────────────
export interface SportsTeamOption {
  key: string;
  label: string;
}

// Team rosters are stable reference data, so the catalog is baked in rather than
// fetched. ESPN's per-league `/teams` endpoint does NOT send CORS headers (unlike
// `/scoreboard` and `/news`), so a browser fetch would fail; the live scores/news
// the tile renders still come straight from ESPN. Entries are [teamId, name];
// the ids match those returned by the scoreboard/news feeds so team filtering
// lines up. Refresh occasionally for soccer promotion/relegation changes.
const LEAGUE_TEAMS: Record<string, ReadonlyArray<readonly [string, string]>> = {
  "nfl": [
    ["22", "Arizona Cardinals"],
    ["1", "Atlanta Falcons"],
    ["33", "Baltimore Ravens"],
    ["2", "Buffalo Bills"],
    ["29", "Carolina Panthers"],
    ["3", "Chicago Bears"],
    ["4", "Cincinnati Bengals"],
    ["5", "Cleveland Browns"],
    ["6", "Dallas Cowboys"],
    ["7", "Denver Broncos"],
    ["8", "Detroit Lions"],
    ["9", "Green Bay Packers"],
    ["34", "Houston Texans"],
    ["11", "Indianapolis Colts"],
    ["30", "Jacksonville Jaguars"],
    ["12", "Kansas City Chiefs"],
    ["13", "Las Vegas Raiders"],
    ["24", "Los Angeles Chargers"],
    ["14", "Los Angeles Rams"],
    ["15", "Miami Dolphins"],
    ["16", "Minnesota Vikings"],
    ["17", "New England Patriots"],
    ["18", "New Orleans Saints"],
    ["19", "New York Giants"],
    ["20", "New York Jets"],
    ["21", "Philadelphia Eagles"],
    ["23", "Pittsburgh Steelers"],
    ["25", "San Francisco 49ers"],
    ["26", "Seattle Seahawks"],
    ["27", "Tampa Bay Buccaneers"],
    ["10", "Tennessee Titans"],
    ["28", "Washington Commanders"],
  ],
  "nba": [
    ["1", "Atlanta Hawks"],
    ["2", "Boston Celtics"],
    ["17", "Brooklyn Nets"],
    ["30", "Charlotte Hornets"],
    ["4", "Chicago Bulls"],
    ["5", "Cleveland Cavaliers"],
    ["6", "Dallas Mavericks"],
    ["7", "Denver Nuggets"],
    ["8", "Detroit Pistons"],
    ["9", "Golden State Warriors"],
    ["10", "Houston Rockets"],
    ["11", "Indiana Pacers"],
    ["12", "LA Clippers"],
    ["13", "Los Angeles Lakers"],
    ["29", "Memphis Grizzlies"],
    ["14", "Miami Heat"],
    ["15", "Milwaukee Bucks"],
    ["16", "Minnesota Timberwolves"],
    ["3", "New Orleans Pelicans"],
    ["18", "New York Knicks"],
    ["25", "Oklahoma City Thunder"],
    ["19", "Orlando Magic"],
    ["20", "Philadelphia 76ers"],
    ["21", "Phoenix Suns"],
    ["22", "Portland Trail Blazers"],
    ["23", "Sacramento Kings"],
    ["24", "San Antonio Spurs"],
    ["28", "Toronto Raptors"],
    ["26", "Utah Jazz"],
    ["27", "Washington Wizards"],
  ],
  "mlb": [
    ["29", "Arizona Diamondbacks"],
    ["11", "Athletics"],
    ["15", "Atlanta Braves"],
    ["1", "Baltimore Orioles"],
    ["2", "Boston Red Sox"],
    ["16", "Chicago Cubs"],
    ["4", "Chicago White Sox"],
    ["17", "Cincinnati Reds"],
    ["5", "Cleveland Guardians"],
    ["27", "Colorado Rockies"],
    ["6", "Detroit Tigers"],
    ["18", "Houston Astros"],
    ["7", "Kansas City Royals"],
    ["3", "Los Angeles Angels"],
    ["19", "Los Angeles Dodgers"],
    ["28", "Miami Marlins"],
    ["8", "Milwaukee Brewers"],
    ["9", "Minnesota Twins"],
    ["21", "New York Mets"],
    ["10", "New York Yankees"],
    ["22", "Philadelphia Phillies"],
    ["23", "Pittsburgh Pirates"],
    ["25", "San Diego Padres"],
    ["26", "San Francisco Giants"],
    ["12", "Seattle Mariners"],
    ["24", "St. Louis Cardinals"],
    ["30", "Tampa Bay Rays"],
    ["13", "Texas Rangers"],
    ["14", "Toronto Blue Jays"],
    ["20", "Washington Nationals"],
  ],
  "nhl": [
    ["25", "Anaheim Ducks"],
    ["1", "Boston Bruins"],
    ["2", "Buffalo Sabres"],
    ["3", "Calgary Flames"],
    ["7", "Carolina Hurricanes"],
    ["4", "Chicago Blackhawks"],
    ["17", "Colorado Avalanche"],
    ["29", "Columbus Blue Jackets"],
    ["9", "Dallas Stars"],
    ["5", "Detroit Red Wings"],
    ["6", "Edmonton Oilers"],
    ["26", "Florida Panthers"],
    ["8", "Los Angeles Kings"],
    ["30", "Minnesota Wild"],
    ["10", "Montreal Canadiens"],
    ["27", "Nashville Predators"],
    ["11", "New Jersey Devils"],
    ["12", "New York Islanders"],
    ["13", "New York Rangers"],
    ["14", "Ottawa Senators"],
    ["15", "Philadelphia Flyers"],
    ["16", "Pittsburgh Penguins"],
    ["18", "San Jose Sharks"],
    ["124292", "Seattle Kraken"],
    ["19", "St. Louis Blues"],
    ["20", "Tampa Bay Lightning"],
    ["21", "Toronto Maple Leafs"],
    ["129764", "Utah Mammoth"],
    ["22", "Vancouver Canucks"],
    ["37", "Vegas Golden Knights"],
    ["23", "Washington Capitals"],
    ["28", "Winnipeg Jets"],
  ],
  "mls": [
    ["18418", "Atlanta United FC"],
    ["20906", "Austin FC"],
    ["9720", "CF Montréal"],
    ["21300", "Charlotte FC"],
    ["182", "Chicago Fire FC"],
    ["184", "Colorado Rapids"],
    ["183", "Columbus Crew"],
    ["193", "D.C. United"],
    ["18267", "FC Cincinnati"],
    ["185", "FC Dallas"],
    ["6077", "Houston Dynamo FC"],
    ["20232", "Inter Miami CF"],
    ["187", "LA Galaxy"],
    ["18966", "LAFC"],
    ["17362", "Minnesota United FC"],
    ["18986", "Nashville SC"],
    ["189", "New England Revolution"],
    ["17606", "New York City FC"],
    ["12011", "Orlando City SC"],
    ["10739", "Philadelphia Union"],
    ["9723", "Portland Timbers"],
    ["4771", "Real Salt Lake"],
    ["190", "Red Bull New York"],
    ["22529", "San Diego FC"],
    ["191", "San Jose Earthquakes"],
    ["9726", "Seattle Sounders FC"],
    ["186", "Sporting Kansas City"],
    ["21812", "St. Louis CITY SC"],
    ["7318", "Toronto FC"],
    ["9727", "Vancouver Whitecaps"],
  ],
  "eng.1": [
    ["349", "AFC Bournemouth"],
    ["359", "Arsenal"],
    ["362", "Aston Villa"],
    ["337", "Brentford"],
    ["331", "Brighton & Hove Albion"],
    ["379", "Burnley"],
    ["363", "Chelsea"],
    ["384", "Crystal Palace"],
    ["368", "Everton"],
    ["370", "Fulham"],
    ["357", "Leeds United"],
    ["364", "Liverpool"],
    ["382", "Manchester City"],
    ["360", "Manchester United"],
    ["361", "Newcastle United"],
    ["393", "Nottingham Forest"],
    ["366", "Sunderland"],
    ["367", "Tottenham Hotspur"],
    ["371", "West Ham United"],
    ["380", "Wolverhampton Wanderers"],
  ],
  "esp.1": [
    ["96", "Alavés"],
    ["93", "Athletic Club"],
    ["1068", "Atlético Madrid"],
    ["83", "Barcelona"],
    ["85", "Celta Vigo"],
    ["3751", "Elche"],
    ["88", "Espanyol"],
    ["2922", "Getafe"],
    ["9812", "Girona"],
    ["1538", "Levante"],
    ["84", "Mallorca"],
    ["97", "Osasuna"],
    ["101", "Rayo Vallecano"],
    ["244", "Real Betis"],
    ["86", "Real Madrid"],
    ["92", "Real Oviedo"],
    ["89", "Real Sociedad"],
    ["243", "Sevilla"],
    ["94", "Valencia"],
    ["102", "Villarreal"],
  ],
  "ger.1": [
    ["6418", "1. FC Heidenheim 1846"],
    ["598", "1. FC Union Berlin"],
    ["131", "Bayer Leverkusen"],
    ["132", "Bayern Munich"],
    ["124", "Borussia Dortmund"],
    ["268", "Borussia Mönchengladbach"],
    ["125", "Eintracht Frankfurt"],
    ["3841", "FC Augsburg"],
    ["122", "FC Cologne"],
    ["127", "Hamburg SV"],
    ["2950", "Mainz"],
    ["11420", "RB Leipzig"],
    ["126", "SC Freiburg"],
    ["270", "St. Pauli"],
    ["7911", "TSG Hoffenheim"],
    ["134", "VfB Stuttgart"],
    ["138", "VfL Wolfsburg"],
    ["137", "Werder Bremen"],
  ],
  "ita.1": [
    ["103", "AC Milan"],
    ["104", "AS Roma"],
    ["105", "Atalanta"],
    ["107", "Bologna"],
    ["2925", "Cagliari"],
    ["2572", "Como"],
    ["109", "Fiorentina"],
    ["4057", "Frosinone"],
    ["3263", "Genoa"],
    ["110", "Internazionale"],
    ["111", "Juventus"],
    ["112", "Lazio"],
    ["113", "Lecce"],
    ["4007", "Monza"],
    ["114", "Napoli"],
    ["115", "Parma"],
    ["3997", "Sassuolo"],
    ["239", "Torino"],
    ["118", "Udinese"],
    ["17530", "Venezia"],
  ],
  "uefa.champions": [
    ["139", "Ajax Amsterdam"],
    ["359", "Arsenal"],
    ["174", "AS Monaco"],
    ["105", "Atalanta"],
    ["93", "Athletic Club"],
    ["1068", "Atlético Madrid"],
    ["83", "Barcelona"],
    ["131", "Bayer Leverkusen"],
    ["132", "Bayern Munich"],
    ["1929", "Benfica"],
    ["2980", "Bodo/Glimt"],
    ["124", "Borussia Dortmund"],
    ["363", "Chelsea"],
    ["570", "Club Brugge"],
    ["125", "Eintracht Frankfurt"],
    ["909", "F.C. København"],
    ["10414", "FK Qarabag"],
    ["432", "Galatasaray"],
    ["110", "Internazionale"],
    ["111", "Juventus"],
    ["2528", "Kairat Almaty"],
    ["364", "Liverpool"],
    ["382", "Manchester City"],
    ["176", "Marseille"],
    ["114", "Napoli"],
    ["361", "Newcastle United"],
    ["435", "Olympiacos"],
    ["22281", "Pafos"],
    ["160", "Paris Saint-Germain"],
    ["148", "PSV Eindhoven"],
    ["86", "Real Madrid"],
    ["494", "Slavia Prague"],
    ["2250", "Sporting CP"],
    ["367", "Tottenham Hotspur"],
    ["5807", "Union St.-Gilloise"],
    ["102", "Villarreal"],
  ],
};

// Look up the teams of one league as selectable options keyed "<leagueKey>:<id>".
export function getLeagueTeams(leagueKey: string): SportsTeamOption[] {
  const teams = LEAGUE_TEAMS[leagueKey] ?? [];
  return teams.map(([id, name]) => ({ key: teamKey(leagueKey, id), label: name }));
}
