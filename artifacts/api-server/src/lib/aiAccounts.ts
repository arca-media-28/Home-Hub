import { randomBytes } from "crypto";
import { connectionStmts } from "./db.js";

// ── Multi-account storage for AI chat providers ───────────────────────────────
// Users can add several AI accounts (OpenAI, Google Gemini, Anthropic Claude),
// each with its own API key and default model. The list lives in the per-user
// `service_connections` table as a JSON array in the `extra` column of that
// user's "ai" row — the same pattern as IMAP/CalDAV accounts. API keys stay
// server-side: the route layer must mask them out of every response.

export const AI_PROVIDERS = [
  "openai",
  "gemini",
  "anthropic",
  "ollama",
  "openai_compatible",
] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

// Local/self-hosted providers: reached via a base URL on the user's network,
// no API key required (openai_compatible may still send one if provided).
export const LOCAL_AI_PROVIDERS: readonly AiProvider[] = ["ollama", "openai_compatible"];

export function isLocalAiProvider(p: AiProvider): boolean {
  return LOCAL_AI_PROVIDERS.includes(p);
}

export function isAiProvider(v: unknown): v is AiProvider {
  return typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);
}

export interface AiAccount {
  id: string;
  label: string;
  provider: AiProvider;
  // Empty for local providers that don't need a key.
  apiKey: string;
  // Base URL of a local/self-hosted server (Ollama, LM Studio, vLLM…).
  // Only set for local providers.
  baseUrl?: string | null;
  // Default model for this account. Empty/absent means the provider default.
  model?: string | null;
}

function readAccounts(userId: number): AiAccount[] {
  const row = connectionStmts.findByService.get(userId, "ai");
  if (!row?.extra) return [];
  try {
    const parsed = JSON.parse(row.extra) as unknown;
    return Array.isArray(parsed) ? (parsed as AiAccount[]) : [];
  } catch {
    return [];
  }
}

function writeAccounts(userId: number, accounts: AiAccount[]): void {
  connectionStmts.upsert.run(
    userId,
    "ai",
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

export function listAiAccounts(userId: number): AiAccount[] {
  return readAccounts(userId).filter((a) => {
    if (!a || typeof a !== "object" || !isAiProvider(a.provider)) return false;
    if (typeof a.apiKey !== "string") return false;
    // Cloud providers need a key; local providers need a base URL instead.
    return isLocalAiProvider(a.provider)
      ? typeof a.baseUrl === "string" && a.baseUrl.length > 0
      : a.apiKey.length > 0;
  });
}

export function getAiAccount(userId: number, id: string): AiAccount | null {
  return listAiAccounts(userId).find((a) => a.id === id) ?? null;
}

// Mask an API key for display: only the last 4 characters survive, e.g.
// "••••abcd". Short keys are fully masked.
export function maskApiKey(key: string): string {
  const tail = key.length > 8 ? key.slice(-4) : "";
  return `••••${tail}`;
}

const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Claude",
  ollama: "Ollama",
  openai_compatible: "Local AI",
};

export function addAiAccount(
  userId: number,
  input: {
    label?: string | null;
    provider: AiProvider;
    apiKey: string;
    baseUrl?: string | null;
    model?: string | null;
  },
): AiAccount[] {
  const accounts = listAiAccounts(userId);
  accounts.push({
    id: newId(),
    label: input.label?.trim() || PROVIDER_LABELS[input.provider],
    provider: input.provider,
    apiKey: input.apiKey,
    baseUrl: isLocalAiProvider(input.provider)
      ? input.baseUrl?.trim().replace(/\/+$/, "") || null
      : null,
    model: input.model?.trim() || null,
  });
  writeAccounts(userId, accounts);
  return accounts;
}

// Update label / model / apiKey of one account. An absent apiKey keeps the
// stored key (so the client never needs to resend it); an absent provider
// keeps the stored provider.
export function updateAiAccount(
  userId: number,
  id: string,
  patch: {
    label?: string | null;
    provider?: AiProvider | null;
    apiKey?: string | null;
    baseUrl?: string | null;
    model?: string | null;
  },
): AiAccount[] | null {
  const accounts = listAiAccounts(userId);
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  const cur = accounts[idx]!;
  const provider = patch.provider && isAiProvider(patch.provider) ? patch.provider : cur.provider;
  accounts[idx] = {
    ...cur,
    provider,
    label: patch.label !== undefined && patch.label !== null && patch.label.trim()
      ? patch.label.trim()
      : cur.label,
    apiKey: patch.apiKey ? patch.apiKey : cur.apiKey,
    baseUrl: !isLocalAiProvider(provider)
      ? null
      : patch.baseUrl !== undefined && patch.baseUrl !== null && patch.baseUrl.trim()
        ? patch.baseUrl.trim().replace(/\/+$/, "")
        : (cur.baseUrl ?? null),
    model: patch.model !== undefined ? (patch.model?.trim() || null) : (cur.model ?? null),
  };
  writeAccounts(userId, accounts);
  return accounts;
}

export function removeAiAccount(userId: number, id: string): AiAccount[] | null {
  const accounts = listAiAccounts(userId);
  const next = accounts.filter((a) => a.id !== id);
  if (next.length === accounts.length) return null;
  writeAccounts(userId, next);
  return next;
}
