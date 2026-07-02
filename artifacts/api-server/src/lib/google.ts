import { randomBytes } from "crypto";
import { cloudHttpClient } from "./http.js";
import { connectionStmts } from "./db.js";
import { logger } from "./logger.js";
import { invalidateFetchCache } from "./fetchCache.js";

// The linked-account list changed (link/unlink/re-link) — drop cached Gmail
// inbox and Google Calendar responses so tiles reflect it immediately.
function invalidateGoogleWidgetCaches(): void {
  invalidateFetchCache("mail:gmail:");
  invalidateFetchCache("mail:gcal:");
}

// ── Google OAuth helper (Gmail + Google Calendar) ────────────────────────────
// The app credentials (OAuth client ID/secret) come from either the
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET environment variables or, more
// commonly, from Settings: they're stored in the shared `service_connections`
// table under a dedicated "google" row's JSON `extra` blob. Env vars take
// precedence when both are present. The linked account's OAuth tokens are
// persisted under the "gmail" row's `extra` blob (the "google_calendar" row
// mirrors it so both features read the same link). All Google calls go over
// the TLS-verifying `cloudHttpClient`.

const AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const CALLBACK_PATH = "/api/widgets/gmail/callback";

// Read-only mail + calendar, plus the email address for display in Settings.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

// Refresh a little early so a token never expires mid-request.
const EXPIRY_SKEW_MS = 60_000;

interface StoredGoogleCredentials {
  clientId?: string;
  clientSecret?: string;
}

export function getStoredGoogleCredentials(): StoredGoogleCredentials {
  const row = connectionStmts.findByService.get("google");
  if (!row?.extra) return {};
  try {
    return JSON.parse(row.extra) as StoredGoogleCredentials;
  } catch {
    return {};
  }
}

// Saving new credentials also clears any linked account: existing refresh
// tokens are bound to the old OAuth client and would fail to refresh anyway.
export function setGoogleCredentials(clientId: string, clientSecret: string): void {
  const extra = JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
  connectionStmts.upsert.run("google", null, null, null, null, extra);
  clearGoogleTokens();
}

export function clearGoogleCredentials(): void {
  connectionStmts.upsert.run("google", null, null, null, null, null);
  clearGoogleTokens();
}

export function getGoogleClientId(): string | null {
  return process.env["GOOGLE_CLIENT_ID"]?.trim() || getStoredGoogleCredentials().clientId?.trim() || null;
}
export function getGoogleClientSecret(): string | null {
  return (
    process.env["GOOGLE_CLIENT_SECRET"]?.trim() ||
    getStoredGoogleCredentials().clientSecret?.trim() ||
    null
  );
}
export function isGoogleConfigured(): boolean {
  return Boolean(getGoogleClientId() && getGoogleClientSecret());
}
// Where the active credentials come from — drives the Settings UI (env-provided
// credentials cannot be edited in the app).
export function getGoogleCredentialSource(): "env" | "stored" | null {
  if (process.env["GOOGLE_CLIENT_ID"]?.trim() && process.env["GOOGLE_CLIENT_SECRET"]?.trim()) {
    return "env";
  }
  const stored = getStoredGoogleCredentials();
  if (stored.clientId?.trim() && stored.clientSecret?.trim()) return "stored";
  return null;
}

interface GoogleTokens {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  scope?: string;
  email?: string;
}

// Short-lived CSRF `state` values issued by /auth and consumed by /callback.
// Kept in-process — the OAuth round-trip is seconds long and a server restart
// simply means the user clicks "Connect" again.
interface PendingAuth {
  redirectUri: string;
  returnTo: string;
  createdAt: number;
}
const pendingAuth = new Map<string, PendingAuth>();
const PENDING_TTL_MS = 10 * 60_000;

function prunePending(): void {
  const now = Date.now();
  for (const [state, entry] of pendingAuth) {
    if (now - entry.createdAt > PENDING_TTL_MS) pendingAuth.delete(state);
  }
}

export function createGooglePendingAuth(redirectUri: string, returnTo: string): string {
  prunePending();
  const state = randomBytes(16).toString("hex");
  pendingAuth.set(state, { redirectUri, returnTo, createdAt: Date.now() });
  return state;
}

export function consumeGooglePendingAuth(state: string): PendingAuth | null {
  prunePending();
  const entry = pendingAuth.get(state);
  if (!entry) return null;
  pendingAuth.delete(state);
  return entry;
}

// ── Auth intents ──────────────────────────────────────────────────────────────
// /widgets/gmail/auth is a top-level popup navigation, so it cannot carry the
// bearer token. Without a guard, ANY unauthenticated visitor could start the
// OAuth flow and bind their own Google account to this instance (the link is
// app-wide). Settings therefore first calls the authenticated
// POST /connections/google/auth-intent to mint a short-lived single-use token,
// which the popup URL must present before the flow may begin.
const authIntents = new Map<string, number>(); // token → createdAt
const INTENT_TTL_MS = 5 * 60_000;

function pruneIntents(): void {
  const now = Date.now();
  for (const [token, createdAt] of authIntents) {
    if (now - createdAt > INTENT_TTL_MS) authIntents.delete(token);
  }
}

export function createGoogleAuthIntent(): string {
  pruneIntents();
  const token = randomBytes(24).toString("hex");
  authIntents.set(token, Date.now());
  return token;
}

export function consumeGoogleAuthIntent(token: string): boolean {
  pruneIntents();
  if (!authIntents.has(token)) return false;
  authIntents.delete(token);
  return true;
}

// ── Persistence ───────────────────────────────────────────────────────────────
// Multiple Google accounts can be linked; each carries its own token set.
// Stored as { accounts: GoogleAccount[] } in the "gmail" row's extra blob
// (mirrored into "google_calendar"). A legacy single-token blob (pre
// multi-account) is migrated on read into a one-element accounts array.

export interface GoogleAccount extends GoogleTokens {
  id: string;
  email?: string;
}

interface GoogleStore {
  accounts: GoogleAccount[];
}

function parseStore(raw: string | null | undefined): GoogleStore {
  if (!raw) return { accounts: [] };
  try {
    const parsed = JSON.parse(raw) as GoogleStore & GoogleTokens;
    if (Array.isArray(parsed.accounts)) {
      return { accounts: parsed.accounts.filter((a) => a && typeof a.id === "string") };
    }
    // Legacy shape: a single token blob at the top level. Use a stable id —
    // this runs on every read until the next write persists the new shape.
    if (parsed.refreshToken) {
      return { accounts: [{ ...parsed, id: "legacy" }] };
    }
    return { accounts: [] };
  } catch {
    return { accounts: [] };
  }
}

function getStore(): GoogleStore {
  return parseStore(connectionStmts.findByService.get("gmail")?.extra);
}

function persistStore(store: GoogleStore): void {
  const extra = store.accounts.length > 0 ? JSON.stringify(store) : null;
  // Both the Email and Calendar features read the same Google links; mirror
  // into both service rows so either can be inspected independently.
  connectionStmts.upsert.run("gmail", null, null, null, null, extra);
  connectionStmts.upsert.run("google_calendar", null, null, null, null, extra);
}

// Linked Google accounts (only those with a usable refresh token).
export function listGoogleAccounts(): GoogleAccount[] {
  return getStore().accounts.filter((a) => Boolean(a.refreshToken));
}

export function getGoogleAccount(id: string): GoogleAccount | null {
  return getStore().accounts.find((a) => a.id === id) ?? null;
}

// Add or replace (matched by email — re-linking the same address refreshes it
// in place rather than duplicating). Returns the stored account.
export function upsertGoogleAccount(tokens: GoogleTokens & { email?: string }): GoogleAccount {
  const store = getStore();
  const existing = tokens.email
    ? store.accounts.find((a) => a.email?.toLowerCase() === tokens.email?.toLowerCase())
    : undefined;
  if (existing) {
    Object.assign(existing, tokens);
    persistStore(store);
    invalidateGoogleWidgetCaches();
    return existing;
  }
  const account: GoogleAccount = { id: randomBytes(6).toString("hex"), ...tokens };
  store.accounts.push(account);
  persistStore(store);
  invalidateGoogleWidgetCaches();
  return account;
}

function updateGoogleAccount(id: string, tokens: GoogleTokens): void {
  const store = getStore();
  const account = store.accounts.find((a) => a.id === id);
  if (!account) return;
  Object.assign(account, tokens);
  persistStore(store);
}

export function removeGoogleAccount(id: string): boolean {
  const store = getStore();
  const before = store.accounts.length;
  store.accounts = store.accounts.filter((a) => a.id !== id);
  persistStore(store);
  invalidateGoogleWidgetCaches();
  return store.accounts.length < before;
}

export function clearGoogleTokens(): void {
  persistStore({ accounts: [] });
  invalidateGoogleWidgetCaches();
}

export function isGoogleLinked(): boolean {
  return isGoogleConfigured() && listGoogleAccounts().length > 0;
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

export function buildGoogleAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: getGoogleClientId() ?? "",
    response_type: "code",
    redirect_uri: redirectUri,
    scope: GOOGLE_SCOPES,
    state,
    access_type: "offline",
    // "consent" forces the consent screen so Google always returns a refresh
    // token; "select_account" shows the account chooser so a second/third
    // Google account can be linked even while another one is signed in.
    prompt: "consent select_account",
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<void> {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const r = await cloudHttpClient.post<TokenResponse>(TOKEN_URL, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data = r.data;

  // Fetch the account's email address for display in Settings.
  let email: string | undefined;
  try {
    const profile = await cloudHttpClient.get<{ email?: string }>(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${data.access_token}` } },
    );
    email = profile.data.email;
  } catch (err) {
    logger.warn({ err }, "Google userinfo fetch failed");
  }

  upsertGoogleAccount({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
    ...(email ? { email } : {}),
  });
}

// Return a valid access token for one linked account, refreshing when expired.
// Throws when Google is not configured or the account is not linked.
export async function getGoogleAccessToken(accountId: string): Promise<string> {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured");
  const account = getGoogleAccount(accountId);
  if (!account?.refreshToken) throw new Error("Google account is not linked");
  if (
    account.accessToken &&
    account.expiresAt &&
    Date.now() < account.expiresAt - EXPIRY_SKEW_MS
  ) {
    return account.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const r = await cloudHttpClient.post<TokenResponse>(TOKEN_URL, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data = r.data;
  updateGoogleAccount(account.id, {
    accessToken: data.access_token,
    // Google only returns a refresh token on the initial consent; keep ours.
    refreshToken: data.refresh_token ?? account.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope ?? account.scope,
  });
  return data.access_token;
}
