import { cloudHttpClient } from "./http.js";
import { getGoogleAccessToken } from "./google.js";
import type { ImapAccount } from "./mailAccounts.js";

// ── Mail fetchers (Gmail REST + generic IMAP) ─────────────────────────────────
// Both providers normalize into the same EmailMessage shape the widget route
// serves. imapflow is lazily imported so the (heavy) dependency only loads
// when an IMAP account is actually queried.

export interface EmailMessage {
  id: string;
  account: string;
  accountLabel: string;
  from: string;
  subject: string;
  snippet: string | null;
  date: string;
  unread: boolean;
  link: string | null;
}

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailHeader {
  name?: string;
  value?: string;
}
interface GmailMessage {
  id?: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { headers?: GmailHeader[] };
}

function gmailHeader(msg: GmailMessage, name: string): string {
  const h = msg.payload?.headers?.find(
    (x) => x.name?.toLowerCase() === name.toLowerCase(),
  );
  return h?.value ?? "";
}

// Strip the email address part from a From header ("Jane <j@x.com>" → "Jane").
function displayFrom(raw: string): string {
  const m = raw.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m?.[1] ?? raw).trim() || raw.trim();
}

export async function fetchGmailMessages(opts: {
  accountId: string;
  accountLabel: string;
  max: number;
  unreadOnly: boolean;
}): Promise<{ messages: EmailMessage[]; unread: number | null }> {
  const token = await getGoogleAccessToken(opts.accountId);
  const headers = { Authorization: `Bearer ${token}` };

  const listParams = new URLSearchParams({
    maxResults: String(opts.max),
    labelIds: "INBOX",
  });
  if (opts.unreadOnly) listParams.append("q", "is:unread");
  const list = await cloudHttpClient.get<{ messages?: { id: string }[] }>(
    `${GMAIL_BASE}/messages?${listParams.toString()}`,
    { headers },
  );
  const ids = (list.data.messages ?? []).slice(0, opts.max).map((m) => m.id);

  const details = await Promise.all(
    ids.map((id) =>
      cloudHttpClient.get<GmailMessage>(
        `${GMAIL_BASE}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers },
      ),
    ),
  );

  // Unread total from the INBOX label (threadsUnread is closer to what the
  // Gmail UI badge shows, but messagesUnread matches what we list here).
  let unread: number | null = null;
  try {
    const label = await cloudHttpClient.get<{ messagesUnread?: number }>(
      `${GMAIL_BASE}/labels/INBOX`,
      { headers },
    );
    unread = typeof label.data.messagesUnread === "number" ? label.data.messagesUnread : null;
  } catch {
    unread = null;
  }

  const messages = details.map((r) => {
    const msg = r.data;
    const id = msg.id ?? "";
    return {
      id: `gmail:${opts.accountId}:${id}`,
      account: opts.accountId,
      accountLabel: opts.accountLabel,
      from: displayFrom(gmailHeader(msg, "From")),
      subject: gmailHeader(msg, "Subject"),
      snippet: msg.snippet ?? null,
      date: msg.internalDate
        ? new Date(Number(msg.internalDate)).toISOString()
        : new Date().toISOString(),
      unread: msg.labelIds?.includes("UNREAD") ?? false,
      link: id ? `https://mail.google.com/mail/#inbox/${id}` : null,
    };
  });

  return { messages, unread };
}

// Hard cap on how long a single IMAP round-trip may take — a wedged server
// must not hang the whole aggregated inbox request.
const IMAP_TIMEOUT_MS = 15_000;

export async function fetchImapMessages(
  account: ImapAccount,
  opts: { max: number; unreadOnly: boolean },
): Promise<{ messages: EmailMessage[]; unread: number | null }> {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.username, pass: account.password },
    logger: false,
    socketTimeout: IMAP_TIMEOUT_MS,
    greetingTimeout: IMAP_TIMEOUT_MS,
    connectionTimeout: IMAP_TIMEOUT_MS,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      const total = mailbox && typeof mailbox === "object" ? mailbox.exists : 0;

      let unread: number | null = null;
      try {
        const status = await client.status("INBOX", { unseen: true });
        unread = typeof status.unseen === "number" ? status.unseen : null;
      } catch {
        unread = null;
      }

      let uids: number[];
      if (opts.unreadOnly) {
        const found = await client.search({ seen: false }, { uid: true });
        uids = Array.isArray(found) ? found.slice(-opts.max) : [];
      } else {
        if (total === 0) return { messages: [], unread };
        // Fetch the newest N by sequence number.
        const start = Math.max(1, total - opts.max + 1);
        const found = await client.search({ seq: `${start}:${total}` }, { uid: true });
        uids = Array.isArray(found) ? found : [];
      }
      if (uids.length === 0) return { messages: [], unread };

      const messages: EmailMessage[] = [];
      for await (const msg of client.fetch(
        uids,
        { uid: true, envelope: true, flags: true },
        { uid: true },
      )) {
        const env = msg.envelope;
        const fromAddr = env?.from?.[0];
        const from = fromAddr?.name?.trim() || fromAddr?.address || "Unknown sender";
        messages.push({
          id: `${account.id}:${msg.uid}`,
          account: account.id,
          accountLabel: account.label,
          from,
          subject: env?.subject ?? "",
          snippet: null,
          date: (env?.date ?? new Date()).toISOString(),
          unread: !(msg.flags?.has("\\Seen") ?? false),
          link: null,
        });
      }
      messages.sort((a, b) => (a.date < b.date ? 1 : -1));
      return { messages: messages.slice(0, opts.max), unread };
    } finally {
      lock.release();
    }
  } finally {
    // logout() can hang on broken servers; close() force-drops the socket.
    await client.logout().catch(() => client.close());
  }
}

// ── Demo data ─────────────────────────────────────────────────────────────────
// Shown only when no mail account is configured at all, so the tile still
// renders something representative.

export function demoEmailMessages(now = Date.now()): EmailMessage[] {
  const mins = (n: number) => new Date(now - n * 60_000).toISOString();
  const demo = [
    { from: "GitHub", subject: "[homelab] Build #142 passed", snippet: "All checks have passed on main.", unread: true, at: 12 },
    { from: "TrueNAS", subject: "Scrub of pool tank finished", snippet: "Scrub completed with 0 errors in 2:41:07.", unread: true, at: 55 },
    { from: "Sofia Nguyen", subject: "Re: Saturday dinner plans", snippet: "Sounds great — see you at 7! Should I bring anything?", unread: false, at: 130 },
    { from: "Let's Encrypt", subject: "Certificate expiration notice", snippet: "Your certificate for dash.local expires in 19 days.", unread: false, at: 260 },
    { from: "Newsletter Weekly", subject: "This week in self-hosting", snippet: "Top posts: pi-hole v6, ZFS tuning guide, and more.", unread: false, at: 420 },
  ];
  return demo.map((d, i) => ({
    id: `demo:${i}`,
    account: "demo",
    accountLabel: "Demo inbox",
    from: d.from,
    subject: d.subject,
    snippet: d.snippet,
    date: mins(d.at),
    unread: d.unread,
    link: null,
  }));
}
