---
name: AI chat streaming mode
description: How the AI Chat tile streams replies (NDJSON contract, provider stream quirks, error semantics)
---

# AI chat streaming

`POST /api/widgets/ai/chat` with `stream:true` answers chunked NDJSON
(`application/x-ndjson`): one `{"delta":"…"}` line per text piece, ending with
`{"done":true,"sample":bool,"model":"…"}` — or `{"error":"…"}` as the last line
if the provider fails mid-stream (200 already committed). Failures BEFORE the
first delta still return normal 400/404/502 JSON, keeping the widget
convention (configured-failure→502).

**Why NDJSON over SSE:** works with a plain `fetch` + reader in the tile (no
EventSource, which can't POST or send a bearer token) and one line-splitting
parser serves both server (provider streams) and client.

**Provider stream shapes** (all via axios `responseType:"stream"`):
- OpenAI / openai_compatible: `stream:true`, SSE `data:` lines,
  `choices[0].delta.content`, ends `[DONE]`; errors arrive in-stream as
  `{"error":{...}}`.
- Gemini: different endpoint `:streamGenerateContent?alt=sse` (not a flag).
- Anthropic: `stream:true`, only `content_block_delta`+`text_delta` events
  carry text; `type:"error"` events must throw.
- Ollama: NDJSON (no `data:` prefix), `message.content` per line.
All reduce to one `consumeJsonStream(lines→JSON→extract delta)` helper in
`aiProviders.ts`.

**How to apply:** set `X-Accel-Buffering: no` + `Cache-Control:
no-cache, no-transform` and `flushHeaders()` or proxies buffer the tokens.
Defer committing the 200 until the first delta so pre-stream provider
rejections (bad key/model) can still map to 502 hints. Tile keeps partial text
when a mid-stream error hits (partial bubble + error bubble). Demo mode
streams too, so the tile has a single code path.
