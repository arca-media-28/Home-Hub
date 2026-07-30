---
name: AI Chat tile
description: AI Chat tile + multi-account AI providers (cloud OpenAI/Gemini/Anthropic + local Ollama/OpenAI-compatible) — storage, routes, and demo semantics
---

- AI accounts live as a JSON array in the per-user `service_connections` "ai" row extra (same pattern as IMAP/CalDAV); keys are masked (`••••` + last 4) in every response by the route layer.
- Provider adapters (chat/listModels/test) live in one place behind a `Record<AiProvider, ProviderAdapter>` and take `{apiKey, baseUrl}` creds; cloud adapters use the TLS-verifying cloudHttpClient, LOCAL adapters (ollama, openai_compatible) use the insecure LAN httpClient. Adding a provider = one adapter + provider key.
- Local providers: account requires baseUrl (trailing slashes stripped) instead of apiKey; keyless accounts have `apiKey:""` (the list filter drops non-string apiKey — fixtures must use "" not null) and `maskedKey:""`. Local providers have NO fallback/default model, so /widgets/ai/chat 400s "No model selected…" when none is set. Ollama = /api/chat + /api/tags; openai_compatible = {base}/v1/* with optional Bearer.
- Demo semantics: POST /widgets/ai/chat returns `sample:true` ONLY when the user has zero AI accounts; unknown accountId → 404; configured provider failure → 502 with a status-specific hint (401/403 key, 429 quota, 400/404 model). GET /widgets/ai/models never 502s (static fallback list, `live:false`).
- Key-test endpoint always answers 200 `{ok, message}` so the Settings card shows the outcome inline (service-connection test convention).
- Tile history is client-only: localStorage `homehub:aichat:<tileId>`, cap 50, only last 20 non-sample turns sent as context; error replies render as inline bubbles and are dropped from the next send.
- **Why:** matches house rules — mock only when unconfigured, explicit failures, per-user connections.
