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

// In-memory stand-in for the service_connections table: findByService reads
// the row that upsert last wrote, so add/list round-trips work like the real DB.
// Keyed by `${userId}:${service}` now that connections are per-user.
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
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// The connections router also imports http + integration health helpers for
// the single-connection routes; stub them so importing the module is cheap.
vi.mock("../lib/http.js", () => ({
  httpClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  cloudHttpClient: { get: vi.fn(), post: vi.fn() },
  normalizeBaseUrl: (url: string | undefined | null) => url ?? undefined,
  normalizeHttpError: (err: unknown) => String(err),
  HTTP_TIMEOUT: 1000,
}));

const { default: connectionsRouter } = await import("./connections.js");
const { default: googleRouter } = await import("./google.js");

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/connections", connectionsRouter);
  app.use("/connections/google", googleRouter);
  return app;
}

const app = makeApp();

beforeEach(() => {
  rows.clear();
  findByService.mockClear();
  upsertRun.mockClear();
});

// ── IMAP accounts ────────────────────────────────────────────────────────────
describe("POST /connections/imap/accounts", () => {
  it("stores secure=false for plain/STARTTLS setups and defaults port to 143 semantics", async () => {
    const res = await request(app).post("/connections/imap/accounts").send({
      label: "Plain box",
      host: "mail.lan",
      port: 143,
      secure: false,
      username: "u",
      password: "pw",
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ host: "mail.lan", port: 143, secure: false });
    // Never leak the password back to the browser.
    expect(res.body[0]).not.toHaveProperty("password");
    // The persisted row must carry secure:false too (it drives the imapflow
    // connection options later).
    const stored = JSON.parse(rows.get("1:imap")?.extra ?? "[]");
    expect(stored[0].secure).toBe(false);
    expect(stored[0].password).toBe("pw");
  });

  it("defaults secure to true and port to 993 when omitted", async () => {
    const res = await request(app).post("/connections/imap/accounts").send({
      host: "imap.example.com",
      username: "u",
      password: "pw",
    });
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ port: 993, secure: true });
  });

  it("rejects a submission missing required fields", async () => {
    const res = await request(app)
      .post("/connections/imap/accounts")
      .send({ host: "imap.example.com", username: "u" });
    expect(res.status).toBe(400);
  });

  it("stores and returns an optional webmail URL", async () => {
    const res = await request(app).post("/connections/imap/accounts").send({
      host: "imap.example.com",
      username: "u",
      password: "pw",
      webmailUrl: "  https://mail.example.com/inbox  ",
    });
    expect(res.status).toBe(200);
    expect(res.body[0].webmailUrl).toBe("https://mail.example.com/inbox");
    const stored = JSON.parse(rows.get("1:imap")?.extra ?? "[]");
    expect(stored[0].webmailUrl).toBe("https://mail.example.com/inbox");
  });

  it("drops non-http(s) webmail URLs instead of storing them", async () => {
    const res = await request(app).post("/connections/imap/accounts").send({
      host: "imap.example.com",
      username: "u",
      password: "pw",
      // eslint-disable-next-line no-script-url
      webmailUrl: "javascript:alert(1)",
    });
    expect(res.status).toBe(200);
    expect(res.body[0].webmailUrl).toBeNull();
  });

  it("returns webmailUrl null for accounts saved before the field existed", async () => {
    const res = await request(app).post("/connections/imap/accounts").send({
      host: "imap.example.com",
      username: "u",
      password: "pw",
    });
    expect(res.status).toBe(200);
    expect(res.body[0].webmailUrl).toBeNull();
  });
});

// ── Google OAuth credentials (Settings-managed) ─────────────────────────────
describe("PUT/DELETE /connections/google/credentials", () => {
  it("rejects a submission missing clientId or clientSecret", async () => {
    const res = await request(app)
      .put("/connections/google/credentials")
      .send({ clientId: "abc.apps.googleusercontent.com" });
    expect(res.status).toBe(400);
  });

  it("saves credentials, reports configured + stored source, and never echoes the secret", async () => {
    const res = await request(app).put("/connections/google/credentials").send({
      clientId: "  abc.apps.googleusercontent.com  ",
      clientSecret: "GOCSPX-secret",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      connected: false,
      credentialSource: "stored",
      clientId: "abc.apps.googleusercontent.com",
    });
    expect(JSON.stringify(res.body)).not.toContain("GOCSPX-secret");
    // Persisted (trimmed) in the dedicated "google" row.
    const stored = JSON.parse(rows.get("1:google")?.extra ?? "{}");
    expect(stored).toEqual({
      clientId: "abc.apps.googleusercontent.com",
      clientSecret: "GOCSPX-secret",
    });
  });

  it("clears any existing account link when credentials change", async () => {
    rows.set("1:gmail", { service: "gmail", extra: JSON.stringify({ refreshToken: "r1" }) });
    rows.set("1:google_calendar", {
      service: "google_calendar",
      extra: JSON.stringify({ refreshToken: "r1" }),
    });
    const res = await request(app)
      .put("/connections/google/credentials")
      .send({ clientId: "new-id", clientSecret: "new-secret" });
    expect(res.status).toBe(200);
    // Old tokens are bound to the old OAuth client — both mirrored rows reset.
    expect(JSON.parse(rows.get("1:gmail")?.extra ?? "null")).toBeNull();
    expect(JSON.parse(rows.get("1:google_calendar")?.extra ?? "null")).toBeNull();
  });

  it("removes stored credentials and reports unconfigured", async () => {
    await request(app)
      .put("/connections/google/credentials")
      .send({ clientId: "id", clientSecret: "sec" });
    const res = await request(app).delete("/connections/google/credentials");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: false,
      credentialSource: null,
      clientId: null,
    });
    expect(rows.get("1:google")?.extra ?? null).toBeNull();
  });

  it("migrates a legacy single-token blob and lists it as one account", async () => {
    await request(app)
      .put("/connections/google/credentials")
      .send({ clientId: "id", clientSecret: "sec" });
    // Pre-multi-account shape: a single token blob at the top level. A fresh
    // (unexpired) access token means status can validate without a refresh.
    rows.set("1:gmail", {
      service: "gmail",
      extra: JSON.stringify({
        refreshToken: "r1",
        accessToken: "a1",
        expiresAt: Date.now() + 3_600_000,
        email: "old@gmail.com",
      }),
    });
    const res = await request(app).get("/connections/google/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: true, email: "old@gmail.com" });
    expect(res.body.accounts).toEqual([
      { id: "legacy", email: "old@gmail.com", connected: true },
    ]);
  });

  it("lists multiple linked accounts and disconnects a single one by id", async () => {
    await request(app)
      .put("/connections/google/credentials")
      .send({ clientId: "id", clientSecret: "sec" });
    const account = (id: string, email: string) => ({
      id,
      email,
      refreshToken: `r-${id}`,
      accessToken: `a-${id}`,
      expiresAt: Date.now() + 3_600_000,
    });
    rows.set("1:gmail", {
      service: "gmail",
      extra: JSON.stringify({
        accounts: [account("acc1", "one@gmail.com"), account("acc2", "two@gmail.com")],
      }),
    });

    const status = await request(app).get("/connections/google/status");
    expect(status.body.accounts).toEqual([
      { id: "acc1", email: "one@gmail.com", connected: true },
      { id: "acc2", email: "two@gmail.com", connected: true },
    ]);
    expect(status.body).toMatchObject({ connected: true, email: "one@gmail.com" });

    // Unlink only the first account.
    const one = await request(app)
      .post("/connections/google/disconnect")
      .send({ accountId: "acc1" });
    expect(one.status).toBe(200);
    expect(one.body.accounts).toEqual([
      { id: "acc2", email: "two@gmail.com", connected: true },
    ]);
    // The mirrored calendar row tracks the same remaining account.
    const mirrored = JSON.parse(rows.get("1:google_calendar")?.extra ?? "{}");
    expect(mirrored.accounts).toHaveLength(1);
    expect(mirrored.accounts[0].id).toBe("acc2");

    // A bodyless disconnect removes everything.
    const all = await request(app).post("/connections/google/disconnect").send();
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ connected: false, accounts: [] });
    expect(rows.get("1:gmail")?.extra ?? null).toBeNull();
  });

  it("returns 409 when credentials come from environment variables", async () => {
    process.env["GOOGLE_CLIENT_ID"] = "env-id";
    process.env["GOOGLE_CLIENT_SECRET"] = "env-secret";
    try {
      const put = await request(app)
        .put("/connections/google/credentials")
        .send({ clientId: "id", clientSecret: "sec" });
      expect(put.status).toBe(409);
      const del = await request(app).delete("/connections/google/credentials");
      expect(del.status).toBe(409);
      // Env-provided creds surface as source "env" in status.
      const status = await request(app).get("/connections/google/status");
      expect(status.body).toMatchObject({ configured: true, credentialSource: "env" });
    } finally {
      delete process.env["GOOGLE_CLIENT_ID"];
      delete process.env["GOOGLE_CLIENT_SECRET"];
    }
  });
});
