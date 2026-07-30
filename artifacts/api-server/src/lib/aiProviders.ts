import { cloudHttpClient, httpClient } from "./http.js";
import type { AiAccount, AiProvider } from "./aiAccounts.js";

// ── AI chat provider abstraction ─────────────────────────────────────────────
// One small adapter per provider (OpenAI, Google Gemini, Anthropic Claude),
// each exposing the same three operations: send a chat completion, list the
// available models, and test an API key. Adding a provider means adding one
// adapter object here plus the provider key in aiAccounts.ts.
//
// All calls go to public cloud APIs bearing the user's API key, so they MUST
// use the TLS-verifying cloudHttpClient (never the insecure homelab client).

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// AI completions routinely take longer than the default 6s widget timeout.
const CHAT_TIMEOUT = 60_000;
const LIST_TIMEOUT = 10_000;

// Static fallback model lists, used when the provider's model-list endpoint is
// unreachable (or for providers whose list needs filtering anyway).
export const FALLBACK_MODELS: Record<AiProvider, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  anthropic: [
    "claude-sonnet-4-20250514",
    "claude-3-7-sonnet-latest",
    "claude-3-5-haiku-latest",
  ],
  // Local servers: no meaningful static list — whatever the box has pulled.
  ollama: [],
  openai_compatible: [],
};

// Empty string = no sensible default; the chat route asks the user to pick a
// model (local servers can host anything).
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
  anthropic: "claude-3-5-haiku-latest",
  ollama: "",
  openai_compatible: "",
};

// Accounts carry the credentials (apiKey) and, for local providers, the
// base URL of the self-hosted server.
type Creds = Pick<AiAccount, "apiKey" | "baseUrl">;

// Called with each incremental piece of reply text as the provider streams it.
export type StreamDelta = (text: string) => void;

interface ProviderAdapter {
  chat(creds: Creds, model: string, messages: ChatMessage[]): Promise<string>;
  // Streams the reply incrementally via onDelta; resolves with the full text.
  chatStream(
    creds: Creds,
    model: string,
    messages: ChatMessage[],
    onDelta: StreamDelta,
    signal?: AbortSignal,
  ): Promise<string>;
  listModels(creds: Creds): Promise<string[]>;
  // Cheap key/connectivity check; throws on failure.
  test(creds: Creds): Promise<void>;
}

// ── Streaming plumbing ───────────────────────────────────────────────────────
// Providers stream over HTTP as either SSE ("data: {...}" lines) or NDJSON
// (one JSON object per line). Both reduce to: split the byte stream on
// newlines, hand each non-empty line to a parser that extracts the text delta.

// Iterates the lines of a Node readable stream (axios responseType:"stream").
async function* streamLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      yield buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer.trim()) yield buffer;
}

// Consumes an SSE or NDJSON body, calling extract on each JSON payload and
// forwarding any extracted text to onDelta. Returns the accumulated reply.
async function consumeJsonStream(
  stream: NodeJS.ReadableStream,
  extract: (payload: unknown) => string | null | undefined,
  onDelta: StreamDelta,
): Promise<string> {
  let full = "";
  for await (const line of streamLines(stream)) {
    let data = line;
    if (data.startsWith("data:")) data = data.slice(5).trim();
    else data = data.trim();
    if (!data || data === "[DONE]" || data.startsWith("event:") || data.startsWith(":"))
      continue;
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      continue; // ignore non-JSON keep-alives / partial noise
    }
    const text = extract(payload);
    if (text) {
      full += text;
      onDelta(text);
    }
  }
  return full;
}

// Providers put SSE error payloads inside the stream too; surface them.
function streamedError(payload: unknown): string | null {
  const err = (payload as { error?: { message?: string } | string })?.error;
  if (!err) return null;
  return typeof err === "string" ? err : (err.message ?? "provider stream error");
}

function extractOpenAiDelta(payload: unknown): string | null {
  const msg = streamedError(payload);
  if (msg) throw new Error(msg);
  const p = payload as { choices?: Array<{ delta?: { content?: unknown } }> };
  const c = p?.choices?.[0]?.delta?.content;
  return typeof c === "string" ? c : null;
}

const openai: ProviderAdapter = {
  async chat({ apiKey }, model, messages) {
    const r = await cloudHttpClient.post(
      "https://api.openai.com/v1/chat/completions",
      { model, messages },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: CHAT_TIMEOUT },
    );
    const text = r.data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("OpenAI returned no reply text");
    return text;
  },
  async chatStream({ apiKey }, model, messages, onDelta, signal) {
    const r = await cloudHttpClient.post(
      "https://api.openai.com/v1/chat/completions",
      { model, messages, stream: true },
      {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "text/event-stream" },
        timeout: CHAT_TIMEOUT,
        responseType: "stream",
        ...(signal ? { signal } : {}),
      },
    );
    const text = await consumeJsonStream(r.data, extractOpenAiDelta, onDelta);
    if (!text) throw new Error("OpenAI returned no reply text");
    return text;
  },
  async listModels({ apiKey }) {
    const r = await cloudHttpClient.get("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: LIST_TIMEOUT,
    });
    const ids = ((r.data?.data ?? []) as Array<{ id?: string }>)
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string")
      // The raw list is huge (embeddings, TTS, images…) — keep chat models.
      .filter((id) => /^(gpt-|o\d)/.test(id) && !/(audio|realtime|search|transcribe|tts|image)/.test(id));
    ids.sort();
    return ids;
  },
  async test({ apiKey }) {
    await cloudHttpClient.get("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: LIST_TIMEOUT,
    });
  },
};

const gemini: ProviderAdapter = {
  async chat({ apiKey }, model, messages) {
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const r = await cloudHttpClient.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { contents },
      { headers: { "x-goog-api-key": apiKey }, timeout: CHAT_TIMEOUT },
    );
    const parts = r.data?.candidates?.[0]?.content?.parts as Array<{ text?: string }> | undefined;
    const text = (parts ?? []).map((p) => p.text ?? "").join("");
    if (!text) throw new Error("Gemini returned no reply text");
    return text;
  },
  async chatStream({ apiKey }, model, messages, onDelta, signal) {
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const r = await cloudHttpClient.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      { contents },
      {
        headers: { "x-goog-api-key": apiKey, Accept: "text/event-stream" },
        timeout: CHAT_TIMEOUT,
        responseType: "stream",
        ...(signal ? { signal } : {}),
      },
    );
    const text = await consumeJsonStream(
      r.data,
      (payload) => {
        const msg = streamedError(payload);
        if (msg) throw new Error(msg);
        const parts = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
          ?.candidates?.[0]?.content?.parts;
        return (parts ?? []).map((p) => p.text ?? "").join("");
      },
      onDelta,
    );
    if (!text) throw new Error("Gemini returned no reply text");
    return text;
  },
  async listModels({ apiKey }) {
    const r = await cloudHttpClient.get(
      "https://generativelanguage.googleapis.com/v1beta/models",
      { headers: { "x-goog-api-key": apiKey }, params: { pageSize: 200 }, timeout: LIST_TIMEOUT },
    );
    const models = (r.data?.models ?? []) as Array<{
      name?: string;
      supportedGenerationMethods?: string[];
    }>;
    const ids = models
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter(Boolean);
    ids.sort();
    return ids;
  },
  async test({ apiKey }) {
    await cloudHttpClient.get("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": apiKey },
      params: { pageSize: 1 },
      timeout: LIST_TIMEOUT,
    });
  },
};

const anthropic: ProviderAdapter = {
  async chat({ apiKey }, model, messages) {
    const r = await cloudHttpClient.post(
      "https://api.anthropic.com/v1/messages",
      { model, max_tokens: 1024, messages },
      {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        timeout: CHAT_TIMEOUT,
      },
    );
    const blocks = r.data?.content as Array<{ type?: string; text?: string }> | undefined;
    const text = (blocks ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    if (!text) throw new Error("Claude returned no reply text");
    return text;
  },
  async chatStream({ apiKey }, model, messages, onDelta, signal) {
    const r = await cloudHttpClient.post(
      "https://api.anthropic.com/v1/messages",
      { model, max_tokens: 1024, messages, stream: true },
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          Accept: "text/event-stream",
        },
        timeout: CHAT_TIMEOUT,
        responseType: "stream",
        ...(signal ? { signal } : {}),
      },
    );
    const text = await consumeJsonStream(
      r.data,
      (payload) => {
        const p = payload as {
          type?: string;
          delta?: { type?: string; text?: string };
          error?: { message?: string };
        };
        if (p?.type === "error") throw new Error(p.error?.message ?? "Claude stream error");
        if (p?.type === "content_block_delta" && p.delta?.type === "text_delta")
          return p.delta.text ?? "";
        return null;
      },
      onDelta,
    );
    if (!text) throw new Error("Claude returned no reply text");
    return text;
  },
  async listModels({ apiKey }) {
    const r = await cloudHttpClient.get("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      params: { limit: 100 },
      timeout: LIST_TIMEOUT,
    });
    const ids = ((r.data?.data ?? []) as Array<{ id?: string }>)
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string");
    return ids;
  },
  async test({ apiKey }) {
    await cloudHttpClient.get("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      params: { limit: 1 },
      timeout: LIST_TIMEOUT,
    });
  },
};

// ── Local providers ──────────────────────────────────────────────────────────
// These run on the user's own network (Ollama, LM Studio, LocalAI, vLLM…), so
// they use the homelab httpClient (accepts self-signed certs) and a base URL
// from the account instead of a cloud endpoint. No API key required.

function requireBaseUrl(creds: Creds): string {
  const base = creds.baseUrl?.trim().replace(/\/+$/, "");
  if (!base) throw new Error("This local AI account has no server URL configured");
  return base;
}

// Native Ollama API.
const ollama: ProviderAdapter = {
  async chat(creds, model, messages) {
    const base = requireBaseUrl(creds);
    const r = await httpClient.post(
      `${base}/api/chat`,
      { model, messages, stream: false },
      { timeout: CHAT_TIMEOUT },
    );
    const text = r.data?.message?.content;
    if (typeof text !== "string" || !text) throw new Error("Ollama returned no reply text");
    return text;
  },
  async chatStream(creds, model, messages, onDelta, signal) {
    const base = requireBaseUrl(creds);
    const r = await httpClient.post(
      `${base}/api/chat`,
      { model, messages, stream: true },
      { timeout: CHAT_TIMEOUT, responseType: "stream", ...(signal ? { signal } : {}) },
    );
    // Ollama streams NDJSON: {"message":{"content":"…"},"done":false} per line.
    const text = await consumeJsonStream(
      r.data,
      (payload) => {
        const p = payload as { message?: { content?: string }; error?: string };
        if (p?.error) throw new Error(p.error);
        return p?.message?.content ?? null;
      },
      onDelta,
    );
    if (!text) throw new Error("Ollama returned no reply text");
    return text;
  },
  async listModels(creds) {
    const base = requireBaseUrl(creds);
    const r = await httpClient.get(`${base}/api/tags`, { timeout: LIST_TIMEOUT });
    const ids = ((r.data?.models ?? []) as Array<{ name?: string }>)
      .map((m) => m.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    ids.sort();
    return ids;
  },
  async test(creds) {
    const base = requireBaseUrl(creds);
    await httpClient.get(`${base}/api/tags`, { timeout: LIST_TIMEOUT });
  },
};

// Any OpenAI-compatible local server (LM Studio, LocalAI, vLLM, llama.cpp…).
// The optional API key is sent as a Bearer token when present.
const openaiCompatible: ProviderAdapter = {
  async chat(creds, model, messages) {
    const base = requireBaseUrl(creds);
    const r = await httpClient.post(
      `${base}/v1/chat/completions`,
      { model, messages },
      {
        headers: creds.apiKey ? { Authorization: `Bearer ${creds.apiKey}` } : {},
        timeout: CHAT_TIMEOUT,
      },
    );
    const text = r.data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text)
      throw new Error("The local AI server returned no reply text");
    return text;
  },
  async chatStream(creds, model, messages, onDelta, signal) {
    const base = requireBaseUrl(creds);
    const r = await httpClient.post(
      `${base}/v1/chat/completions`,
      { model, messages, stream: true },
      {
        headers: {
          ...(creds.apiKey ? { Authorization: `Bearer ${creds.apiKey}` } : {}),
          Accept: "text/event-stream",
        },
        timeout: CHAT_TIMEOUT,
        responseType: "stream",
        ...(signal ? { signal } : {}),
      },
    );
    const text = await consumeJsonStream(r.data, extractOpenAiDelta, onDelta);
    if (!text) throw new Error("The local AI server returned no reply text");
    return text;
  },
  async listModels(creds) {
    const base = requireBaseUrl(creds);
    const r = await httpClient.get(`${base}/v1/models`, {
      headers: creds.apiKey ? { Authorization: `Bearer ${creds.apiKey}` } : {},
      timeout: LIST_TIMEOUT,
    });
    const ids = ((r.data?.data ?? []) as Array<{ id?: string }>)
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    ids.sort();
    return ids;
  },
  async test(creds) {
    const base = requireBaseUrl(creds);
    await httpClient.get(`${base}/v1/models`, {
      headers: creds.apiKey ? { Authorization: `Bearer ${creds.apiKey}` } : {},
      timeout: LIST_TIMEOUT,
    });
  },
};

const ADAPTERS: Record<AiProvider, ProviderAdapter> = {
  openai,
  gemini,
  anthropic,
  ollama,
  openai_compatible: openaiCompatible,
};

// Resolves to "" when the provider has no sensible default (local servers) and
// neither the account nor the tile picked a model — callers must handle that.
export function resolveModel(account: AiAccount, override?: string | null): string {
  return override?.trim() || account.model?.trim() || DEFAULT_MODELS[account.provider];
}

export async function aiChat(
  account: AiAccount,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  return ADAPTERS[account.provider].chat(account, model, messages);
}

// Streaming variant: onDelta fires for each incremental piece of reply text;
// resolves with the full reply once the provider closes the stream.
export async function aiChatStream(
  account: AiAccount,
  model: string,
  messages: ChatMessage[],
  onDelta: StreamDelta,
  signal?: AbortSignal,
): Promise<string> {
  return ADAPTERS[account.provider].chatStream(account, model, messages, onDelta, signal);
}

// Live model list for an account, falling back to the static list when the
// provider's endpoint fails (so the model picker always has options).
export async function aiListModels(
  account: AiAccount,
): Promise<{ models: string[]; live: boolean }> {
  try {
    const models = await ADAPTERS[account.provider].listModels(account);
    if (models.length > 0) return { models, live: true };
  } catch {
    // fall through to the static list
  }
  return { models: FALLBACK_MODELS[account.provider], live: false };
}

export async function aiTestKey(
  provider: AiProvider,
  creds: { apiKey: string; baseUrl?: string | null },
): Promise<void> {
  await ADAPTERS[provider].test(creds);
}
