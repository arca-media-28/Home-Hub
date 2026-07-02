import { randomBytes } from "crypto";
import { connectionStmts } from "./db.js";

// ── Multi-account storage for IMAP and CalDAV ─────────────────────────────────
// Unlike the single-connection services, users can add several IMAP mailboxes
// and several CalDAV calendars. Each list lives in the shared
// `service_connections` table as a JSON array in the `extra` column of the
// "imap" / "caldav" rows. Passwords stay server-side: the route layer must
// sanitize them out of every response.

export interface ImapAccount {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

export interface CalDavAccount {
  id: string;
  label: string;
  url: string;
  username: string;
  password: string;
}

function readAccounts<T>(service: string): T[] {
  const row = connectionStmts.findByService.get(service);
  if (!row?.extra) return [];
  try {
    const parsed = JSON.parse(row.extra) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeAccounts<T>(service: string, accounts: T[]): void {
  connectionStmts.upsert.run(
    service,
    null,
    null,
    null,
    null,
    accounts.length > 0 ? JSON.stringify(accounts) : null,
  );
}

function newId(): string {
  return randomBytes(6).toString("hex");
}

// ── IMAP ──────────────────────────────────────────────────────────────────────

export function listImapAccounts(): ImapAccount[] {
  return readAccounts<ImapAccount>("imap").filter(
    (a) => a && typeof a === "object" && typeof a.host === "string" && typeof a.username === "string",
  );
}

export function addImapAccount(input: {
  label?: string | null;
  host: string;
  port?: number | null;
  secure?: boolean | null;
  username: string;
  password: string;
}): ImapAccount[] {
  const accounts = listImapAccounts();
  accounts.push({
    id: newId(),
    label: input.label?.trim() || input.username,
    host: input.host.trim(),
    port: input.port && Number.isFinite(input.port) ? Math.trunc(input.port) : 993,
    secure: input.secure ?? true,
    username: input.username.trim(),
    password: input.password,
  });
  writeAccounts("imap", accounts);
  return accounts;
}

export function removeImapAccount(id: string): ImapAccount[] | null {
  const accounts = listImapAccounts();
  const next = accounts.filter((a) => a.id !== id);
  if (next.length === accounts.length) return null;
  writeAccounts("imap", next);
  return next;
}

// ── CalDAV ────────────────────────────────────────────────────────────────────

export function listCalDavAccounts(): CalDavAccount[] {
  return readAccounts<CalDavAccount>("caldav").filter(
    (a) => a && typeof a === "object" && typeof a.url === "string" && typeof a.username === "string",
  );
}

export function addCalDavAccount(input: {
  label?: string | null;
  url: string;
  username: string;
  password: string;
}): CalDavAccount[] {
  const accounts = listCalDavAccounts();
  accounts.push({
    id: newId(),
    label: input.label?.trim() || input.username,
    url: input.url.trim(),
    username: input.username.trim(),
    password: input.password,
  });
  writeAccounts("caldav", accounts);
  return accounts;
}

export function removeCalDavAccount(id: string): CalDavAccount[] | null {
  const accounts = listCalDavAccounts();
  const next = accounts.filter((a) => a.id !== id);
  if (next.length === accounts.length) return null;
  writeAccounts("caldav", next);
  return next;
}
