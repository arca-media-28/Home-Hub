import { useGetEmailInbox, getGetEmailInboxQueryKey } from "@workspace/api-client-react";
import type { EmailMessage } from "@workspace/api-client-react";
import { Mail, AlertTriangle } from "lucide-react";
import type { WidgetProps } from "./IntegrationTile";
import { tileColumns, listColumnClass, listColumnStyle } from "./metrics";
import { normalizeTileUrl, openTileUrl } from "@/lib/utils";

const EMAIL_DEFAULT_MAX = 15;

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center gap-1 px-3 text-muted-foreground text-sm">
      <Mail className="w-5 h-5 opacity-50" />
      <span>{children}</span>
    </div>
  );
}

// Compact relative time (e.g. "5m", "3h", "2d"), falling back to a short date
// for older messages.
function relativeTime(iso: string): string | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60) return "now";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MessageRow({
  msg,
  detailed,
  showAccount,
}: {
  msg: EmailMessage;
  detailed: boolean;
  showAccount: boolean;
}) {
  const time = relativeTime(msg.date);
  const body = (
    <>
      <div className="flex items-baseline gap-1.5 min-w-0">
        {msg.unread && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 self-center" aria-label="Unread" />
        )}
        <span
          className={`text-xs leading-snug truncate ${msg.unread ? "font-semibold" : "text-muted-foreground"}`}
        >
          {msg.from}
        </span>
        {time && (
          <span className="ml-auto text-[10px] text-muted-foreground flex-shrink-0">{time}</span>
        )}
      </div>
      <div className={`text-xs leading-snug truncate ${msg.unread ? "" : "text-muted-foreground"}`}>
        {msg.subject || "(no subject)"}
      </div>
      {detailed && msg.snippet && (
        <div className="text-[10px] text-muted-foreground truncate">{msg.snippet}</div>
      )}
      {detailed && showAccount && (
        <div className="text-[10px] text-muted-foreground/70 truncate">{msg.accountLabel}</div>
      )}
    </>
  );

  if (msg.link) {
    const link = msg.link;
    return (
      <a
        href={normalizeTileUrl(link)}
        onClick={(e) => {
          e.preventDefault();
          openTileUrl(link);
        }}
        className="block space-y-0.5 hover:text-primary transition-colors cursor-pointer"
      >
        {body}
      </a>
    );
  }
  return <div className="space-y-0.5">{body}</div>;
}

export default function EmailTile({ density, tileSettings }: WidgetProps) {
  const accounts = tileSettings?.emailAccounts ?? null;
  const max = tileSettings?.emailMaxMessages ?? EMAIL_DEFAULT_MAX;
  const unreadOnly = tileSettings?.emailUnreadOnly ?? false;

  // The route returns demo messages when no mail account is configured, so we
  // always run the query. All knobs live in the query key so distinct tile
  // configurations cache separately.
  const params = {
    accounts: accounts && accounts.length > 0 ? accounts.join(",") : undefined,
    max,
    unreadOnly: unreadOnly ? "true" : undefined,
  };
  const { data, isLoading, isError } = useGetEmailInbox(params, {
    query: {
      queryKey: getGetEmailInboxQueryKey(params),
      refetchInterval: 60_000,
      staleTime: 30_000,
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
    return <Placeholder>Couldn't reach your mail accounts — check Settings.</Placeholder>;
  }

  if (data.messages.length === 0) {
    return (
      <Placeholder>{unreadOnly ? "No unread mail — inbox zero!" : "No messages here."}</Placeholder>
    );
  }

  const detailed = density.bodyHeight >= 150;
  const columns = tileColumns(density.bodyWidth);
  // Only bother labeling messages per-account when more than one is in play.
  const accountCount = new Set(data.messages.map((m) => m.account)).size;
  const failedAccounts = data.errors ?? [];

  return (
    <div className="w-full h-full flex flex-col">
      {(data.sample || typeof data.unreadTotal === "number" || failedAccounts.length > 0) && (
        <div className="flex items-center gap-2 px-3 pt-2 text-[10px] text-muted-foreground">
          {typeof data.unreadTotal === "number" && (
            <span className="font-medium">
              {data.unreadTotal} unread{data.sample ? "" : ""}
            </span>
          )}
          {data.sample && <span className="opacity-70">Sample data — connect an account</span>}
          {failedAccounts.length > 0 && (
            <span className="flex items-center gap-1 text-amber-500" title={failedAccounts.map((e) => `${e.account}: ${e.message}`).join("\n")}>
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
        {data.messages.map((msg) => (
          <MessageRow key={msg.id} msg={msg} detailed={detailed} showAccount={accountCount > 1} />
        ))}
      </div>
    </div>
  );
}
