import { useQuery } from "@tanstack/react-query";
import { Trophy, Newspaper } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";
import {
  fetchSports,
  type SportsScore,
  type SportsHeadline,
} from "@/lib/sports";
import {
  tileBudget,
  SECTION_PX,
  TWO_LINE_ROW_PX,
} from "./metrics";

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center gap-1 px-3 text-muted-foreground text-sm">
      <Trophy className="w-5 h-5 opacity-50" />
      <span>{children}</span>
    </div>
  );
}

// One game row: away @ home with scores, plus a status pill ("Live", "Final",
// or the start time). Live games highlight the status in the accent color.
function ScoreRow({ game }: { game: SportsScore }) {
  const live = game.state === "in";
  const statusClass = live
    ? "text-primary font-semibold"
    : "text-muted-foreground";
  const status =
    game.state === "in" ? game.detail || "Live" : game.detail || "—";

  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{game.away.name}</span>
          <span className="tabular-nums font-semibold flex-shrink-0">
            {game.away.score ?? ""}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{game.home.name}</span>
          <span className="tabular-nums font-semibold flex-shrink-0">
            {game.home.score ?? ""}
          </span>
        </div>
      </div>
      <span className={`flex-shrink-0 w-16 text-right text-[11px] leading-tight ${statusClass}`}>
        {status}
      </span>
    </div>
  );
}

function HeadlineRow({ item }: { item: SportsHeadline }) {
  const body = (
    <>
      <div className="text-xs leading-snug line-clamp-2">{item.headline}</div>
      <div className="text-[10px] text-muted-foreground truncate">{item.league}</div>
    </>
  );
  if (item.link) {
    return (
      <a
        href={item.link}
        target="_blank"
        rel="noreferrer"
        className="block space-y-0.5 hover:text-primary transition-colors"
      >
        {body}
      </a>
    );
  }
  return <div className="space-y-0.5">{body}</div>;
}

export default function SportsTile({ density, tileSettings }: WidgetProps) {
  const leagues = tileSettings?.sportsLeagues ?? [];
  const teams = tileSettings?.sportsTeams ?? [];
  const showScores = tileSettings?.sportsShowScores ?? true;
  const showNews = tileSettings?.sportsShowNews ?? false;

  const hasLeagues = leagues.length > 0;

  const query = useQuery({
    queryKey: ["sports", leagues, teams, showScores, showNews],
    queryFn: () => fetchSports({ leagues, teams, showScores, showNews }),
    enabled: hasLeagues && (showScores || showNews),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  if (!hasLeagues) {
    return <Placeholder>Pick one or more leagues in this tile's settings.</Placeholder>;
  }

  if (!showScores && !showNews) {
    return <Placeholder>Enable scores or news in this tile's settings.</Placeholder>;
  }

  if (query.isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (query.isError || !query.data) {
    return <Placeholder>Sports data unavailable</Placeholder>;
  }

  const { scores, headlines } = query.data;

  if (scores.length === 0 && headlines.length === 0) {
    return <Placeholder>No games or news right now.</Placeholder>;
  }

  // Density-aware reveal: show as many score rows / headlines as fit. Each game
  // row is two lines (two teams); headlines are two-line clamped.
  const budget = tileBudget(density);

  const SCORE_ROW_PX = 42; // two team lines + spacing
  const HEADLINE_ROW_PX = TWO_LINE_ROW_PX;

  const scoresActive = showScores && scores.length > 0;
  const newsActive = showNews && headlines.length > 0;

  let scoreRows = 0;
  let headlineRows = 0;

  if (scoresActive && newsActive) {
    // Both sections enabled and non-empty: reserve one row for each (so news is
    // never starved by a long scoreboard), then hand the leftover space to
    // whichever section still has the most unshown items. The body clips
    // overflow, so on a very small tile both still show their guaranteed row.
    let pool = budget.remaining - 2 * SECTION_PX - SCORE_ROW_PX - HEADLINE_ROW_PX;
    scoreRows = 1;
    headlineRows = 1;
    for (;;) {
      const canScore = scoreRows < scores.length && pool >= SCORE_ROW_PX;
      const canNews = headlineRows < headlines.length && pool >= HEADLINE_ROW_PX;
      if (!canScore && !canNews) break;
      const scoreDeficit = scores.length - scoreRows;
      const newsDeficit = headlines.length - headlineRows;
      if (canScore && (!canNews || scoreDeficit >= newsDeficit)) {
        scoreRows++;
        pool -= SCORE_ROW_PX;
      } else {
        headlineRows++;
        pool -= HEADLINE_ROW_PX;
      }
    }
  } else if (scoresActive) {
    scoreRows = budget.list(SECTION_PX, SCORE_ROW_PX, scores.length);
  } else if (newsActive) {
    headlineRows = budget.list(SECTION_PX, HEADLINE_ROW_PX, headlines.length);
  }

  return (
    <div className="w-full h-full flex flex-col p-3 gap-2 overflow-hidden text-foreground">
      {scoreRows > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Trophy className="w-3 h-3" />
            Scores
          </div>
          <div className="space-y-1.5">
            {scores.slice(0, scoreRows).map((g) => (
              <ScoreRow key={g.id} game={g} />
            ))}
          </div>
        </div>
      )}

      {headlineRows > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Newspaper className="w-3 h-3" />
            News
          </div>
          <div className="space-y-1.5">
            {headlines.slice(0, headlineRows).map((h) => (
              <HeadlineRow key={h.id} item={h} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
