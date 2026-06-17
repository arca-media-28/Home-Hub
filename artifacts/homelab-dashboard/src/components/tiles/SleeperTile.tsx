import { useQuery } from "@tanstack/react-query";
import { Trophy, ArrowRightLeft } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";
import {
  fetchSleeperUser,
  fetchLeague,
  fetchLeagueRosters,
  fetchLeagueUsers,
  fetchMatchups,
  fetchProjections,
  fetchTransactions,
  fetchSportState,
  fetchPlayers,
  buildStandings,
  buildMatchup,
  buildTransactionFeed,
  transactionTypeLabel,
} from "@/lib/sleeper";
import {
  tileBudget,
  SECTION_PX,
  SLEEPER_MATCHUP_PX,
  SLEEPER_STANDING_ROW_PX,
  SLEEPER_TRANSACTION_ROW_PX,
  listColumnClass,
  listColumnStyle,
} from "./metrics";

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center gap-1 px-3 text-muted-foreground text-sm">
      <Trophy className="w-5 h-5 opacity-50" />
      <span>{children}</span>
    </div>
  );
}

// Slow-changing data: league metadata, rosters, users, season state, and the
// user's identity. Refetched every 5 minutes.
function useCoreQuery(username: string, leagueId: string, sport: string) {
  return useQuery({
    queryKey: ["sleeper", "core", username, leagueId, sport],
    enabled: Boolean(username && leagueId),
    refetchInterval: 5 * 60_000,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      const [user, league, rosters, users, state] = await Promise.all([
        fetchSleeperUser(username),
        fetchLeague(leagueId),
        fetchLeagueRosters(leagueId),
        fetchLeagueUsers(leagueId),
        fetchSportState(sport),
      ]);
      const selfRoster = user
        ? rosters.find((r) => r.ownerId === user.userId) ?? null
        : null;
      return { user, league, rosters, users, state, selfRoster };
    },
  });
}

export default function SleeperTile({ density, tileSettings }: WidgetProps) {
  const username = tileSettings?.sleeperUsername?.trim() ?? "";
  const leagueId = tileSettings?.sleeperLeagueId?.trim() ?? "";
  const sport = tileSettings?.sleeperSport?.trim() || "nfl";
  const showMatchup = tileSettings?.sleeperShowMatchup ?? true;
  const showStandings = tileSettings?.sleeperShowStandings ?? true;
  const showTransactions = tileSettings?.sleeperShowTransactions ?? true;

  const core = useCoreQuery(username, leagueId, sport);

  const league = core.data?.league;
  const offSeason =
    league?.status === "complete" || core.data?.state.seasonType === "off";
  // The week to read matchups/transactions from. In the off-season there is no
  // live matchup, so we don't fetch it.
  const week = core.data?.state.week ?? 1;
  const selfRosterId = core.data?.selfRoster?.rosterId ?? null;

  // Fast-changing matchup scores: refetched every 60 seconds.
  const matchupQuery = useQuery({
    queryKey: ["sleeper", "matchup", leagueId, week],
    enabled: Boolean(leagueId) && core.isSuccess && showMatchup && !offSeason,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
    queryFn: () => fetchMatchups(leagueId, week),
  });

  const season = core.data?.state.season ?? "";

  // Projected starter points for the current week. Projections are set before
  // games and change slowly, so a 5-minute refetch is plenty. Best-effort: the
  // fetcher swallows errors and returns an empty map, leaving actual-only.
  const projectionsQuery = useQuery({
    queryKey: ["sleeper", "projections", sport, season, week],
    enabled:
      Boolean(season) && core.isSuccess && showMatchup && !offSeason,
    refetchInterval: 5 * 60_000,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: () => fetchProjections(sport, season, week),
  });

  // Slow-changing transactions: refetched every 5 minutes. Includes the current
  // and previous week so a fresh week still shows recent activity.
  const txQuery = useQuery({
    queryKey: ["sleeper", "transactions", leagueId, week],
    enabled: Boolean(leagueId) && core.isSuccess && showTransactions,
    refetchInterval: 5 * 60_000,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => {
      const weeks = week > 1 ? [week, week - 1] : [week];
      const results = await Promise.all(
        weeks.map((w) => fetchTransactions(leagueId, w)),
      );
      return results.flat();
    },
  });

  const hasTransactions = (txQuery.data?.length ?? 0) > 0;

  // Player catalog (for transaction player names) — large payload, so fetched
  // at most once and only when transactions are actually present.
  const playersQuery = useQuery({
    queryKey: ["sleeper", "players", sport],
    enabled: showTransactions && hasTransactions,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    queryFn: () => fetchPlayers(sport),
  });

  if (!username || !leagueId) {
    return <Placeholder>Add your Sleeper username and league in this tile's settings.</Placeholder>;
  }

  if (core.isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (core.isError || !core.data) {
    return <Placeholder>Fantasy data unavailable</Placeholder>;
  }

  if (!core.data.user) {
    return <Placeholder>Sleeper user "{username}" not found.</Placeholder>;
  }

  const { rosters, users } = core.data;
  const selfUserId = core.data.user.userId;

  const standings = buildStandings(rosters, users, selfUserId);
  const matchup =
    showMatchup && !offSeason
      ? buildMatchup(
          matchupQuery.data ?? [],
          selfRosterId,
          rosters,
          users,
          projectionsQuery.data,
          league?.scoringFormat ?? "ppr",
        )
      : null;
  const transactions = showTransactions
    ? buildTransactionFeed(txQuery.data ?? [], rosters, users, playersQuery.data)
    : [];

  // Density-aware reveal in metric-priority order: matchup, then standings,
  // then transactions.
  const budget = tileBudget(density);

  const showMatchupBlock = Boolean(matchup) && budget.block(SLEEPER_MATCHUP_PX);

  let standingRows = 0;
  if (showStandings && standings.length > 0) {
    standingRows = budget.list(SECTION_PX, SLEEPER_STANDING_ROW_PX, standings.length);
  }

  let txRows = 0;
  if (showTransactions && transactions.length > 0) {
    txRows = budget.list(SECTION_PX, SLEEPER_TRANSACTION_ROW_PX, transactions.length);
  }

  if (!showMatchupBlock && standingRows === 0 && txRows === 0) {
    if (offSeason) {
      return <Placeholder>Season complete — no standings yet.</Placeholder>;
    }
    return <Placeholder>Nothing to show — enable a section in settings.</Placeholder>;
  }

  return (
    <div className="w-full h-full flex flex-col p-3 gap-2 overflow-hidden text-foreground">
      {offSeason && (
        <div className="flex-shrink-0">
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Season complete
          </span>
        </div>
      )}

      {showMatchupBlock && matchup && (
        <div className="flex-shrink-0 rounded-md border border-border bg-muted/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{matchup.self.teamName}</span>
            <span className="flex items-center gap-2 flex-shrink-0">
              {matchup.outcome && (
                <span
                  className={`text-[10px] font-bold uppercase ${
                    matchup.outcome === "win"
                      ? "text-green-500"
                      : matchup.outcome === "loss"
                        ? "text-red-500"
                        : "text-muted-foreground"
                  }`}
                >
                  {matchup.outcome === "win"
                    ? "W"
                    : matchup.outcome === "loss"
                      ? "L"
                      : "T"}
                </span>
              )}
              <span className="flex flex-col items-end leading-tight">
                <span className="tabular-nums text-base font-bold">
                  {matchup.self.points.toFixed(1)}
                </span>
                {matchup.self.projected != null && (
                  <span className="tabular-nums text-[10px] text-muted-foreground">
                    proj {matchup.self.projected.toFixed(1)}
                  </span>
                )}
              </span>
            </span>
          </div>
          <div className="my-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            vs
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">
              {matchup.opponent?.teamName ?? "Bye / no opponent"}
            </span>
            <span className="flex flex-col items-end leading-tight flex-shrink-0">
              <span className="tabular-nums text-base font-bold">
                {matchup.opponent ? matchup.opponent.points.toFixed(1) : "—"}
              </span>
              {matchup.opponent?.projected != null && (
                <span className="tabular-nums text-[10px] text-muted-foreground">
                  proj {matchup.opponent.projected.toFixed(1)}
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {standingRows > 0 && (
        <div className="space-y-1.5 min-h-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Trophy className="w-3 h-3" />
            Standings
          </div>
          <div
            className={listColumnClass(budget.columns, "space-y-1")}
            style={listColumnStyle(budget.columns)}
          >
            {standings.slice(0, standingRows).map((row) => (
              <div
                key={row.rosterId}
                className={`flex items-center justify-between gap-2 text-xs ${
                  row.isSelf ? "font-semibold text-primary" : ""
                }`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-4 flex-shrink-0 tabular-nums text-muted-foreground">
                    {row.rank}
                  </span>
                  <span className="truncate">{row.teamName}</span>
                </span>
                <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                  {row.wins}-{row.losses}
                  {row.ties > 0 ? `-${row.ties}` : ""} · {row.pointsFor.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {txRows > 0 && (
        <div className="space-y-1.5 min-h-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <ArrowRightLeft className="w-3 h-3" />
            Recent moves
          </div>
          <div
            className={listColumnClass(budget.columns, "space-y-1")}
            style={listColumnStyle(budget.columns)}
          >
            {transactions.slice(0, txRows).map((tx) => (
              <div key={tx.id} className="space-y-0.5">
                <div className="text-xs leading-snug truncate">{tx.playerName}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {transactionTypeLabel(tx.type)} · {tx.teamName}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
