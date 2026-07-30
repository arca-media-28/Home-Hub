import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// Pass-through auth so routes can be exercised without a real JWT.
vi.mock("../lib/auth.js", () => ({
  requireAuth: (req: { user?: { userId: number } }, _res: unknown, next: () => void) => {
    req.user = { userId: 1 };
    next();
  },
}));

// In-memory stand-in for the service_connections table, keyed per user+service.
const rows = new Map<string, { service: string; extra: string | null }>();
const findByService = vi.fn((userId: number, service: string) => rows.get(`${userId}:${service}`));
const upsertRun = vi.fn(
  (
    userId: number,
    service: string,
    _url: unknown,
    _apiKey: unknown,
    _username: unknown,
    _password: unknown,
    extra: string | null,
  ) => {
    rows.set(`${userId}:${service}`, { service, extra });
  },
);
vi.mock("../lib/db.js", () => ({
  connectionStmts: {
    findByService: { get: (...args: unknown[]) => findByService(...(args as [number, string])) },
    upsert: {
      run: (...args: unknown[]) =>
        upsertRun(
          ...(args as [number, string, unknown, unknown, unknown, unknown, string | null]),
        ),
    },
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const cloudGet = vi.fn();
const localGet = vi.fn();
vi.mock("../lib/http.js", () => ({
  httpClient: { get: (...args: unknown[]) => localGet(...args), post: vi.fn(), delete: vi.fn() },
  cloudHttpClient: { get: (...args: unknown[]) => cloudGet(...args), post: vi.fn() },
  normalizeBaseUrl: (url: string | undefined | null) => url ?? undefined,
  normalizeHttpError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  describeHttpError: (err: unknown) => ({
    status: null,
    code: null,
    message: err instanceof Error ? err.message : String(err),
    body: null,
  }),
  HTTP_TIMEOUT: 1000,
}));

const { default: connectionsRouter } = await import("./connections.js");

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/connections", connectionsRouter);
  return app;
}

const app = makeApp();

beforeEach(() => {
  rows.clear();
  vi.clearAllMocks();
});

const KEY = "sk-test-1234567890abcd";

describe("AI account CRUD", () => {
  it("adds an account, defaults the label, and masks the key everywhere", async () => {
    const res = await request(app)
      .post("/connections/ai/accounts")
      .send({ provider: "openai", apiKey: KEY });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ provider: "openai", label: "OpenAI", model: null });
    // The raw key never leaves the server — only the masked hint does.
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(res.body[0].maskedKey).toBe("••••abcd");
    // But the stored row keeps the full key for provider calls.
    const stored = JSON.parse(rows.get("1:ai")?.extra ?? "[]");
    expect(stored[0].apiKey).toBe(KEY);
  });

  it("rejects a bad provider and a missing key", async () => {
    const bad = await request(app)
      .post("/connections/ai/accounts")
      .send({ provider: "grok", apiKey: KEY });
    expect(bad.status).toBe(400);
    const noKey = await request(app)
      .post("/connections/ai/accounts")
      .send({ provider: "openai" });
    expect(noKey.status).toBe(400);
  });

  it("lists accounts with masked keys only", async () => {
    await request(app)
      .post("/connections/ai/accounts")
      .send({ provider: "gemini", apiKey: "AIza-secret-key-9999", label: "Home Gemini" });
    const res = await request(app).get("/connections/ai/accounts");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ label: "Home Gemini", provider: "gemini" });
    expect(JSON.stringify(res.body)).not.toContain("AIza-secret-key-9999");
  });

  it("updates label/model and keeps the stored key when apiKey is omitted", async () => {
    const added = await request(app)
      .post("/connections/ai/accounts")
      .send({ provider: "anthropic", apiKey: KEY });
    const id = added.body[0].id;
    const res = await request(app)
      .put(`/connections/ai/accounts/${id}`)
      .send({ label: "Claude work", model: "claude-3-5-haiku-latest" });
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      label: "Claude work",
      model: "claude-3-5-haiku-latest",
    });
    const stored = JSON.parse(rows.get("1:ai")?.extra ?? "[]");
    expect(stored[0].apiKey).toBe(KEY);
  });

  it("rotates the key when a new apiKey is provided", async () => {
    const added = await request(app)
      .post("/connections/ai/accounts")
      .send({ provider: "openai", apiKey: KEY });
    const id = added.body[0].id;
    await request(app)
      .put(`/connections/ai/accounts/${id}`)
      .send({ apiKey: "sk-new-key-000000wxyz" });
    const stored = JSON.parse(rows.get("1:ai")?.extra ?? "[]");
    expect(stored[0].apiKey).toBe("sk-new-key-000000wxyz");
  });

  it("404s update/delete of an unknown id and removes an existing account", async () => {
    const miss = await request(app).put("/connections/ai/accounts/nope").send({ label: "x" });
    expect(miss.status).toBe(404);
    const added = await request(app)
      .post("/connections/ai/accounts")
      .send({ provider: "openai", apiKey: KEY });
    const id = added.body[0].id;
    const del = await request(app).delete(`/connections/ai/accounts/${id}`);
    expect(del.status).toBe(200);
    expect(del.body).toEqual([]);
    const again = await request(app).delete(`/connections/ai/accounts/${id}`);
    expect(again.status).toBe(404);
  });
});

describe("POST /connections/ai/accounts/:id/test", () => {
  it("answers ok:true when the provider accepts the key", async () => {
    cloudGet.mockResolvedValueOnce({ data: {} });
    const added = await request(app)
      .post("/connections/ai/accounts")
      .send({ provider: "openai", apiKey: KEY });
    const res = await request(app).post(
      `/connections/ai/accounts/${added.body[0].id}/test`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("answers 200 ok:false with a message when the key is rejected", async () => {
    cloudGet.mockRejectedValueOnce(new Error("401 Unauthorized"));
    const added = await request(app)
      .post("/connections/ai/accounts")
      .send({ provider: "gemini", apiKey: KEY });
    const res = await request(app).post(
      `/connections/ai/accounts/${added.body[0].id}/test`,
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toContain("401");
  });

  it("404s for an unknown account", async () => {
    const res = await request(app).post("/connections/ai/accounts/nope/test");
    expect(res.status).toBe(404);
  });
});

describe("local AI accounts (ollama / openai_compatible)", () => {
  it("requires a base URL to add a local account, but no API key", async () => {
    const noUrl = await request(app)
      .post("/connections/ai/accounts")
      .send({ provider: "ollama" });
    expect(noUrl.status).toBe(400);

    const res = await request(app)
      .post("/connections/ai/accounts")
      .send({ provider: "ollama", baseUrl: "http://192.168.1.10:11434/" });
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ provider: "ollama", label: "Ollama" });
    // Keyless account shows an empty masked hint, and the trailing slash is
    // stripped from the stored base URL.
    expect(res.body[0].maskedKey).toBe("");
    expect(res.body[0].baseUrl).toBe("http://192.168.1.10:11434");
  });

  it("accepts an optional key for an openai_compatible server", async () => {
    const res = await request(app)
      .post("/connections/ai/accounts")
      .send({
        provider: "openai_compatible",
        baseUrl: "http://lmstudio.local:1234",
        apiKey: "lm-secret-key-abcd",
      });
    expect(res.status).toBe(200);
    expect(res.body[0].maskedKey).toBe("••••abcd");
    expect(JSON.stringify(res.body)).not.toContain("lm-secret-key-abcd");
  });

  it("tests a local account against its server via the LAN client", async () => {
    localGet.mockResolvedValueOnce({ data: { models: [] } });
    const added = await request(app)
      .post("/connections/ai/accounts")
      .send({ provider: "ollama", baseUrl: "http://10.0.0.5:11434" });
    const res = await request(app).post(
      `/connections/ai/accounts/${added.body[0].id}/test`,
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toContain("reachable");
    const [url] = localGet.mock.calls[0] as [string];
    expect(url).toBe("http://10.0.0.5:11434/api/tags");
    expect(cloudGet).not.toHaveBeenCalled();
  });

  it("reports ok:false when the local server is unreachable", async () => {
    localGet.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    const added = await request(app)
      .post("/connections/ai/accounts")
      .send({ provider: "ollama", baseUrl: "http://10.0.0.5:11434" });
    const res = await request(app).post(
      `/connections/ai/accounts/${added.body[0].id}/test`,
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toContain("ECONNREFUSED");
  });
});
