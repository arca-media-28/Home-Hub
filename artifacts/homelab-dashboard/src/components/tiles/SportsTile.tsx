import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Newspaper, Shield } from "lucide-react";
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

// Small team crest shown beside each team name. Falls back to a neutral shield
// glyph when ESPN omits the logo or the image fails to load, so the row stays
// aligned either way. Sized in pixels (not utility classes) so the caller can
// scale it with tile density without touching the row-height budget math.
function TeamLogo({
  src,
  alt,
  size,
}: {
  src: string | null;
  alt: string;
  size: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        className="flex-shrink-0 inline-flex items-center justify-center text-muted-foreground"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <Shield className="w-full h-full opacity-50" />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="flex-shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}

// One game row: away @ home with scores, plus a status pill ("Live", "Final",
// or the start time). Live games highlight the status in the accent color.
// When ESPN supplies a game page, the whole row becomes a link that opens the
// box score in a new tab; otherwise it renders inert.
function ScoreRow({ game, logoSize }: { game: SportsScore; logoSize: number }) {
  const live = game.state === "in";
  const statusClass = live
    ? "text-primary font-semibold"
    : "text-muted-foreground";
  const status =
    game.state === "in" ? game.detail || "Live" : game.detail || "—";

  const body = (
    <>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 min-w-0">
            <TeamLogo src={game.away.logo} alt={game.away.name} size={logoSize} />
            <span className="truncate">{game.away.name}</span>
          </span>
          <span className="tabular-nums font-semibold flex-shrink-0">
            {game.away.score ?? ""}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 min-w-0">
            <TeamLogo src={game.home.logo} alt={game.home.name} size={logoSize} />
            <span className="truncate">{game.home.name}</span>
          </span>
          <span className="tabular-nums font-semibold flex-shrink-0">
            {game.home.score ?? ""}
          </span>
        </div>
      </div>
      <span className={`flex-shrink-0 w-16 text-right text-[11px] leading-tight ${statusClass}`}>
        {status}
      </span>
    </>
  );

  if (game.link) {
    return (
      <a
        href={game.link}
        target="_blank"
        rel="noreferrer"
        title={`${game.away.name} @ ${game.home.name} — open on ESPN`}
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-between gap-2 text-xs rounded-sm hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {body}
      </a>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 text-xs">{body}</div>
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
        title={`${item.headline} — open on ESPN`}
        onClick={(e) => e.stopPropagation()}
        className="block space-y-0.5 rounded-sm hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

  // Logos scale with tile density but stay within a single text-xs line, so the
  // two-line SCORE_ROW_PX budget below is unaffected.
  const logoSize = density.level === "lg" ? 18 : density.level === "md" ? 16 : 14;

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
    // Each row's vertical cost is amortized across the resolved columns, so a
    // wide tile reveals proportionally more rows (they flow into the grid).
    const colDiv = budget.columns;
    const scoreCost = SCORE_ROW_PX / colDiv;
    const headlineCost = HEADLINE_ROW_PX / colDiv;
    let pool = budget.remaining - 2 * SECTION_PX - scoreCost - headlineCost;
    scoreRows = 1;
    headlineRows = 1;
    for (;;) {
      const canScore = scoreRows < scores.length && pool >= scoreCost;
      const canNews = headlineRows < headlines.length && pool >= headlineCost;
      if (!canScore && !canNews) break;
      const scoreDeficit = scores.length - scoreRows;
      const newsDeficit = headlines.length - headlineRows;
      if (canScore && (!canNews || scoreDeficit >= newsDeficit)) {
        scoreRows++;
        pool -= scoreCost;
      } else {
        headlineRows++;
        pool -= headlineCost;
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
          <div
            className={listColumnClass(budget.columns, "space-y-1.5")}
            style={listColumnStyle(budget.columns)}
          >
            {scores.slice(0, scoreRows).map((g) => (
              <ScoreRow key={g.id} game={g} logoSize={logoSize} />
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
          <div
            className={listColumnClass(budget.columns, "space-y-1.5")}
            style={listColumnStyle(budget.columns)}
          >
            {headlines.slice(0, headlineRows).map((h) => (
              <HeadlineRow key={h.id} item={h} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
