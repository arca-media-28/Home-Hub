import { useEffect, useRef, useState } from "react";
import type { Tile } from "@workspace/api-client-react";
import { useAiChat } from "@workspace/api-client-react";
import { Bot, Send, Eraser, Loader2 } from "lucide-react";

// Per-tile conversation history lives in localStorage under the app's legacy
// key prefix (kept for back-compat) so it survives refreshes without touching
// the server. Capped so a long-running chat can't grow unbounded.
const HISTORY_PREFIX = "homehub:aichat:";
const HISTORY_CAP = 50;
// Only the most recent turns are sent to the provider; the full capped history
// stays visible locally.
const CONTEXT_TURNS = 20;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  // Set on assistant messages produced by demo mode (no accounts configured).
  sample?: boolean;
  // Set when a send failed: rendered as an inline error bubble.
  error?: boolean;
}

// A canned conversation shown when the tile has no AI account selected, so an
// unconfigured tile demonstrates what it does (mock only when unconfigured).
const DEMO_CONVERSATION: ChatMessage[] = [
  { role: "user", content: "What can you do?" },
  {
    role: "assistant",
    content:
      "I'm your dashboard AI assistant. Add an AI account (OpenAI, Gemini, Anthropic, or a local server like Ollama) in Settings, then pick it in this tile's options to start a real conversation.",
    sample: true,
  },
];

function loadHistory(tileId: string | number): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_PREFIX + tileId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ChatMessage =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    );
  } catch {
    return [];
  }
}

function saveHistory(tileId: string | number, messages: ChatMessage[]): void {
  try {
    localStorage.setItem(
      HISTORY_PREFIX + tileId,
      JSON.stringify(messages.slice(-HISTORY_CAP)),
    );
  } catch {
    // Storage full/unavailable — the chat still works, it just won't persist.
  }
}

interface AiChatTileProps {
  tile: Tile;
  // In edit (layout) mode the tile is a drag/resize target, so the input is
  // disabled — chatting happens in locked mode.
  editMode: boolean;
}

// The AI Chat tile: a scrollable conversation backed by a saved AI account
// (selected in the tile editor). History persists per tile in localStorage.
export default function AiChatTile({ tile, editMode }: AiChatTileProps) {
  const accountId = tile.tileSettings?.aiAccountId ?? null;
  const model = tile.tileSettings?.aiModel ?? null;
  const configured = Boolean(accountId);

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadHistory(tile.id),
  );
  const [input, setInput] = useState("");
  const chat = useAiChat();
  const thinking = chat.isPending;

  // Keep the newest message in view as the conversation grows.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  // Persist every change (also covers the clear action writing []).
  useEffect(() => {
    saveHistory(tile.id, messages);
  }, [tile.id, messages]);

  function send() {
    const text = input.trim();
    if (!text || thinking) return;
    const next: ChatMessage[] = [
      ...messages.filter((m) => !m.error),
      { role: "user", content: text },
    ];
    setMessages(next.slice(-HISTORY_CAP));
    setInput("");
    chat.mutate(
      {
        data: {
          accountId: accountId || null,
          model: model || null,
          messages: next
            .filter((m) => !m.sample)
            .slice(-CONTEXT_TURNS)
            .map((m) => ({ role: m.role, content: m.content })),
        },
      },
      {
        onSuccess: (reply) => {
          setMessages((cur) =>
            [
              ...cur,
              {
                role: "assistant" as const,
                content: reply.reply,
                sample: reply.sample || undefined,
              },
            ].slice(-HISTORY_CAP),
          );
        },
        onError: (err: unknown) => {
          const e = err as { error?: string; message?: string } | undefined;
          const detail =
            (e && (e.error || e.message)) || "The AI request failed.";
          setMessages((cur) =>
            [
              ...cur,
              { role: "assistant" as const, content: detail, error: true },
            ].slice(-HISTORY_CAP),
          );
        },
      },
    );
  }

  const shown = messages.length > 0 || configured ? messages : DEMO_CONVERSATION;
  const canClear = messages.length > 0;

  return (
    <div className="w-full h-full flex flex-col bg-card text-card-foreground overflow-hidden">
      {/* Compact header: identity + clear-conversation action. */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border flex-shrink-0">
        <Bot className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs font-bold tracking-wide truncate">
          {tile.name || "AI Chat"}
        </span>
        {!configured && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground border border-border rounded px-1">
            Sample
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {canClear && !editMode && (
            <button
              type="button"
              aria-label="Clear conversation"
              title="Clear conversation"
              onClick={() => setMessages([])}
              className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
            >
              <Eraser className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Conversation. */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2 space-y-2">
        {shown.length === 0 && (
          <p className="text-xs text-muted-foreground pt-2">
            Ask anything — the conversation stays on this tile.
          </p>
        )}
        {shown.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs whitespace-pre-wrap break-words ${
                m.error
                  ? "bg-destructive/10 text-destructive border border-destructive/30"
                  : m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
              }`}
            >
              {m.content}
              {m.sample && configured === false && messages.length > 0 && (
                <span className="block mt-1 text-[10px] opacity-70">
                  Sample reply — pick an AI account in this tile's options.
                </span>
              )}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Input row. Disabled while arranging the layout. */}
      <form
        className="flex items-center gap-1.5 border-t border-border px-2 py-1.5 flex-shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={configured ? "Message…" : "Try it — replies are samples"}
          disabled={editMode || thinking}
          aria-label="Chat message"
          className="flex-1 min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground disabled:opacity-50"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={editMode || thinking || input.trim().length === 0}
          className="text-primary disabled:text-muted-foreground transition-colors p-1"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
