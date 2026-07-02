import { useGetCalendarEvents, getGetCalendarEventsQueryKey } from "@workspace/api-client-react";
import type { CalendarEvent } from "@workspace/api-client-react";
import { CalendarDays, AlertTriangle, MapPin } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";
import { tileColumns, listColumnClass, listColumnStyle } from "./metrics";

const CALENDAR_DEFAULT_DAYS = 14;
const CALENDAR_DEFAULT_MAX = 20;

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center gap-1 px-3 text-muted-foreground text-sm">
      <CalendarDays className="w-5 h-5 opacity-50" />
      <span>{children}</span>
    </div>
  );
}

// Local midnight of a day offset from today; used to bucket events under
// "Today" / "Tomorrow" / weekday headers.
function dayStart(offsetDays: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

// The local day an event belongs to. All-day events carry a date-only start
// ("2026-07-04") that must be read as a local calendar date, not UTC.
function eventDay(ev: CalendarEvent): Date {
  if (ev.allDay) {
    const m = ev.start.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(ev.start);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayLabel(day: Date): string {
  const today = dayStart(0);
  const diffDays = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 7) return day.toLocaleDateString(undefined, { weekday: "long" });
  return day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function timeLabel(ev: CalendarEvent): string {
  if (ev.allDay) return "All day";
  const start = new Date(ev.start);
  const fmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const s = start.toLocaleTimeString(undefined, fmt);
  if (!ev.end) return s;
  const end = new Date(ev.end);
  return `${s} – ${end.toLocaleTimeString(undefined, fmt)}`;
}

export default function CalendarTile({ density, tileSettings }: WidgetProps) {
  const accounts = tileSettings?.calendarAccounts ?? null;
  const days = tileSettings?.calendarDaysAhead ?? CALENDAR_DEFAULT_DAYS;
  const max = tileSettings?.calendarMaxEvents ?? CALENDAR_DEFAULT_MAX;

  // The route returns demo events when no calendar account is configured, so we
  // always run the query. All knobs live in the query key so distinct tile
  // configurations cache separately.
  const params = {
    accounts: accounts && accounts.length > 0 ? accounts.join(",") : undefined,
    days,
    max,
  };
  const { data, isLoading, isError } = useGetCalendarEvents(params, {
    query: {
      queryKey: getGetCalendarEventsQueryKey(params),
      refetchInterval: 300_000,
      staleTime: 120_000,
      retry: 1,
    },
  });

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (isError || !data) {
    return <Placeholder>Couldn't reach your calendars — check Settings.</Placeholder>;
  }

  if (data.events.length === 0) {
    return <Placeholder>Nothing coming up in the next {days} days.</Placeholder>;
  }

  const detailed = density.bodyHeight >= 150;
  const columns = tileColumns(density.bodyWidth);
  const accountCount = new Set(data.events.map((e) => e.account)).size;
  const failedAccounts = data.errors ?? [];

  // Group consecutive events under day headers (events arrive sorted).
  const groups: { label: string; events: CalendarEvent[] }[] = [];
  for (const ev of data.events) {
    const label = dayLabel(eventDay(ev));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.events.push(ev);
    else groups.push({ label, events: [ev] });
  }

  return (
    <div className="w-full h-full flex flex-col">
      {(data.sample || failedAccounts.length > 0) && (
        <div className="flex items-center gap-2 px-3 pt-2 text-[10px] text-muted-foreground">
          {data.sample && <span className="opacity-70">Sample data — connect an account</span>}
          {failedAccounts.length > 0 && (
            <span
              className="flex items-center gap-1 text-amber-500"
              title={failedAccounts.map((e) => `${e.account}: ${e.message}`).join("\n")}
            >
              <AlertTriangle className="w-3 h-3" />
              {failedAccounts.length === 1
                ? `${failedAccounts[0].account} unavailable`
                : `${failedAccounts.length} accounts unavailable`}
            </span>
          )}
        </div>
      )}
      <div
        className={`flex-1 min-h-0 p-3 overflow-y-auto text-foreground ${listColumnClass(columns, "flex flex-col gap-2")}`}
        style={listColumnStyle(columns)}
      >
        {groups.map((group) => (
          <div key={group.label} className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </div>
            {group.events.map((ev) => (
              <div key={ev.id} className="space-y-0.5">
                <div className="text-xs leading-snug truncate">{ev.title}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {timeLabel(ev)}
                  {detailed && ev.calendar ? ` · ${ev.calendar}` : ""}
                  {detailed && accountCount > 1 ? ` · ${ev.accountLabel}` : ""}
                </div>
                {detailed && ev.location && (
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70 truncate">
                    <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                    <span className="truncate">{ev.location}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
