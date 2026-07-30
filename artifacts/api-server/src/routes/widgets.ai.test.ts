import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Same harness as widgets.videoplayer.test.ts: pass-through auth, stubbed DB +
// HTTP clients, quiet logger.
vi.mock("../lib/auth.js", () => ({
  requireAuth: (req: { user?: { userId: number } }, _res: unknown, next: () => void) => {
    req.user = { userId: 1 };
    next();
  },
}));

const findByService = vi.fn();
const upsertRun = vi.fn();
vi.mock("../lib/db.js", () => ({
  connectionStmts: {
    findByService: { get: (...args: unknown[]) => findByService(...args) },
    upsert: { run: (...args: unknown[]) => upsertRun(...args) },
  },
}));

const cloudGet = vi.fn();
const cloudPost = vi.fn();
const localGet = vi.fn();
const localPost = vi.fn();
vi.mock("../lib/http.js", () => ({
  httpClient: {
    get: (...args: unknown[]) => localGet(...args),
    post: (...args: unknown[]) => localPost(...args),
    put: vi.fn(),
    delete: vi.fn(),
  },
  cloudHttpClient: {
    get: (...args: unknown[]) => cloudGet(...args),
    post: (...args: unknown[]) => cloudPost(...args),
  },
  normalizeBaseUrl: (url: string | undefined | null) => {
    const trimmed = url?.trim();
    if (!trimmed) return undefined;
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return withScheme.replace(/\/+$/, "");
  },
  normalizeHttpError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  describeHttpError: (err: unknown) => {
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    return {
      status: e?.response?.status ?? null,
      code: null,
      message: e?.message ?? String(err),
      body: e?.response?.data ?? null,
    };
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// No real game-server queries when the widgets router loads.
vi.mock("../lib/gameQuery.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/gameQuery.js")>();
  return { ...real, queryGamePlayers: vi.fn() };
});

const { default: widgetsRouter } = await import("./widgets.js");

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/widgets", widgetsRouter);
  return app;
}

const app = makeApp();

// One saved OpenAI account in the per-user "ai" row.
const aiRow = (accounts: unknown[]) => ({
  service: "ai",
  url: null,
  api_key: null,
  extra: JSON.stringify(accounts),
});
const openaiAccount = {
  id: "acc1",
  label: "OpenAI",
  provider: "openai",
  apiKey: "sk-test",
  model: "gpt-4o-mini",
};
const ollamaAccount = {
  id: "oll1",
  label: "Ollama",
  provider: "ollama",
  apiKey: "",
  baseUrl: "http://10.0.0.5:11434",
  model: "llama3.2",
};

beforeEach(() => {
  vi.clearAllMocks();
  findByService.mockReturnValue(undefined);
});

describe("POST /api/widgets/ai/chat", () => {
  it("400s when there is no usable message", async () => {
    const res = await request(app).post("/api/widgets/ai/chat").send({ messages: [] });
    expect(res.status).toBe(400);
  });

  it("returns a sample reply when no accounts are configured", async () => {
    const res = await request(app)
      .post("/api/widgets/ai/chat")
      .send({ messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    expect(res.body.sample).toBe(true);
    expect(res.body.model).toBe("demo");
    // No provider call happened.
    expect(cloudPost).not.toHaveBeenCalled();
  });

  it("404s for an unknown account when accounts exist", async () => {
    findByService.mockReturnValue(aiRow([openaiAccount]));
    const res = await request(app)
      .post("/api/widgets/ai/chat")
      .send({ accountId: "nope", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(404);
  });

  it("proxies to the provider and returns the reply (never sample) when configured", async () => {
    findByService.mockReturnValue(aiRow([openaiAccount]));
    cloudPost.mockResolvedValueOnce({
      data: { choices: [{ message: { content: "Hello there!" } }] },
    });
    const res = await request(app)
      .post("/api/widgets/ai/chat")
      .send({ accountId: "acc1", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sample: false,
      reply: "Hello there!",
      model: "gpt-4o-mini",
    });
    // The bearer key was sent to OpenAI's endpoint.
    const [url, , opts] = cloudPost.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string> },
    ];
    expect(url).toContain("api.openai.com");
    expect(opts.headers["Authorization"]).toBe("Bearer sk-test");
  });

  it("honors a per-tile model override", async () => {
    findByService.mockReturnValue(aiRow([openaiAccount]));
    cloudPost.mockResolvedValueOnce({
      data: { choices: [{ message: { content: "ok" } }] },
    });
    const res = await request(app)
      .post("/api/widgets/ai/chat")
      .send({
        accountId: "acc1",
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
      });
    expect(res.body.model).toBe("gpt-4o");
    const [, body] = cloudPost.mock.calls[0] as [string, { model: string }];
    expect(body.model).toBe("gpt-4o");
  });

  it("returns 502 with an explicit key hint when the provider rejects the key", async () => {
    findByService.mockReturnValue(aiRow([openaiAccount]));
    cloudPost.mockRejectedValueOnce({ response: { status: 401 }, message: "401" });
    const res = await request(app)
      .post("/api/widgets/ai/chat")
      .send({ accountId: "acc1", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("API key was rejected");
    // Configured failure never falls back to sample data.
    expect(res.body.sample).toBeUndefined();
  });

  it("maps 429 to a quota hint", async () => {
    findByService.mockReturnValue(aiRow([openaiAccount]));
    cloudPost.mockRejectedValueOnce({ response: { status: 429 }, message: "429" });
    const res = await request(app)
      .post("/api/widgets/ai/chat")
      .send({ accountId: "acc1", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("quota");
  });

  it("chats with a local Ollama server via the LAN client", async () => {
    findByService.mockReturnValue(aiRow([ollamaAccount]));
    localPost.mockResolvedValueOnce({
      data: { message: { content: "hi from llama" } },
    });
    const res = await request(app)
      .post("/api/widgets/ai/chat")
      .send({ accountId: "oll1", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sample: false, reply: "hi from llama", model: "llama3.2" });
    const [url, body] = localPost.mock.calls[0] as [string, { model: string; stream: boolean }];
    expect(url).toBe("http://10.0.0.5:11434/api/chat");
    expect(body.model).toBe("llama3.2");
    expect(body.stream).toBe(false);
    expect(cloudPost).not.toHaveBeenCalled();
  });

  it("400s when a local account has no model configured", async () => {
    findByService.mockReturnValue(aiRow([{ ...ollamaAccount, model: null }]));
    const res = await request(app)
      .post("/api/widgets/ai/chat")
      .send({ accountId: "oll1", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("No model selected");
    expect(localPost).not.toHaveBeenCalled();
  });

  it("routes gemini accounts to the Gemini endpoint", async () => {
    findByService.mockReturnValue(
      aiRow([{ id: "g1", label: "Gem", provider: "gemini", apiKey: "AIza-x", model: null }]),
    );
    cloudPost.mockResolvedValueOnce({
      data: { candidates: [{ content: { parts: [{ text: "hi from gemini" }] } }] },
    });
    const res = await request(app)
      .post("/api/widgets/ai/chat")
      .send({ accountId: "g1", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("hi from gemini");
    const [url] = cloudPost.mock.calls[0] as [string];
    expect(url).toContain("generativelanguage.googleapis.com");
  });
});

describe("GET /api/widgets/ai/models", () => {
  it("404s for an unknown account", async () => {
    const res = await request(app).get("/api/widgets/ai/models?accountId=nope");
    expect(res.status).toBe(404);
  });

  it("returns the live provider list when reachable", async () => {
    findByService.mockReturnValue(aiRow([openaiAccount]));
    cloudGet.mockResolvedValueOnce({
      data: { data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }, { id: "tts-1" }] },
    });
    const res = await request(app).get("/api/widgets/ai/models?accountId=acc1");
    expect(res.status).toBe(200);
    expect(res.body.live).toBe(true);
    expect(res.body.models).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(res.body.default).toBe("gpt-4o-mini");
  });

  it("lists Ollama models from /api/tags via the LAN client", async () => {
    findByService.mockReturnValue(aiRow([ollamaAccount]));
    localGet.mockResolvedValueOnce({
      data: { models: [{ name: "llama3.2" }, { name: "mistral" }] },
    });
    const res = await request(app).get("/api/widgets/ai/models?accountId=oll1");
    expect(res.status).toBe(200);
    expect(res.body.live).toBe(true);
    expect(res.body.models).toEqual(["llama3.2", "mistral"]);
    const [url] = localGet.mock.calls[0] as [string];
    expect(url).toBe("http://10.0.0.5:11434/api/tags");
    expect(cloudGet).not.toHaveBeenCalled();
  });

  it("falls back to the static list (never 502s) when the provider fails", async () => {
    findByService.mockReturnValue(aiRow([openaiAccount]));
    cloudGet.mockRejectedValueOnce(new Error("boom"));
    const res = await request(app).get("/api/widgets/ai/models?accountId=acc1");
    expect(res.status).toBe(200);
    expect(res.body.live).toBe(false);
    expect(res.body.models.length).toBeGreaterThan(0);
  });
});
