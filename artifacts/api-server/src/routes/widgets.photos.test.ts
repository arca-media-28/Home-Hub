import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Same harness as widgets.test.ts (pass-through auth, stubbed DB + HTTP
// clients, quiet logger), plus a mocked google lib so the Google Photos
// routes can be driven through linked/unlinked and token states without any
// real OAuth machinery.
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

const httpGet = vi.fn();
const httpPost = vi.fn();
const cloudGet = vi.fn();
const cloudPost = vi.fn();
vi.mock("../lib/http.js", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
    post: (...args: unknown[]) => httpPost(...args),
    put: vi.fn(),
    delete: vi.fn().mockResolvedValue({ data: {} }),
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

// No real game-server queries.
vi.mock("../lib/gameQuery.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/gameQuery.js")>();
  return { ...real, queryGamePlayers: vi.fn() };
});

// Google lib: fully stubbed so tests dictate linked/unlinked and the token.
const isGoogleConfigured = vi.fn();
const isGoogleLinked = vi.fn();
const listGoogleAccounts = vi.fn();
const getGoogleAccessToken = vi.fn();
vi.mock("../lib/google.js", () => ({
  isGoogleConfigured: (...args: unknown[]) => isGoogleConfigured(...args),
  isGoogleLinked: (...args: unknown[]) => isGoogleLinked(...args),
  listGoogleAccounts: (...args: unknown[]) => listGoogleAccounts(...args),
  getGoogleAccessToken: (...args: unknown[]) => getGoogleAccessToken(...args),
  buildGoogleAuthUrl: vi.fn(),
  exchangeGoogleCode: vi.fn(),
  createGooglePendingAuth: vi.fn(),
  consumeGooglePendingAuth: vi.fn(),
  consumeGoogleAuthIntent: vi.fn(),
  createGoogleAuthIntent: vi.fn(),
  CALLBACK_PATH: "/api/widgets/gmail/oauth/callback",
}));

const { default: widgetsRouter } = await import("./widgets.js");

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/widgets", widgetsRouter);
  return app;
}

const app = makeApp();

function connRow(overrides: Record<string, unknown> = {}) {
  return {
    service: "immich",
    url: null,
    api_key: null,
    username: null,
    password: null,
    extra: null,
    updated_at: "now",
    ...overrides,
  };
}

function httpError(status = 500): Error {
  return Object.assign(new Error(`status ${status}`), { response: { status } });
}

function googleLinked() {
  isGoogleConfigured.mockReturnValue(true);
  isGoogleLinked.mockReturnValue(true);
  listGoogleAccounts.mockReturnValue([{ id: "acct-1", email: "a@b.c" }]);
  getGoogleAccessToken.mockResolvedValue("tok-123");
}

beforeEach(() => {
  findByService.mockReset();
  httpGet.mockReset();
  httpPost.mockReset();
  cloudGet.mockReset();
  cloudPost.mockReset();
  isGoogleConfigured.mockReset();
  isGoogleLinked.mockReset();
  listGoogleAccounts.mockReset();
  getGoogleAccessToken.mockReset();
  // Default: nothing configured anywhere.
  findByService.mockReturnValue(undefined);
  isGoogleConfigured.mockReturnValue(false);
  isGoogleLinked.mockReturnValue(false);
  listGoogleAccounts.mockReturnValue([]);
});

// ── Album listing ────────────────────────────────────────────────────────────
describe("GET /widgets/photos/albums", () => {
  it("rejects an unknown source", async () => {
    const res = await request(app).get("/widgets/photos/albums?source=nope");
    expect(res.status).toBe(400);
  });

  it("returns sample albums when Google is not linked", async () => {
    const res = await request(app).get("/widgets/photos/albums?source=google");
    expect(res.status).toBe(200);
    expect(res.body.sample).toBe(true);
    expect(res.body.albums.length).toBeGreaterThan(0);
    expect(res.body.albums[0].id).toMatch(/^sample-/);
  });

  it("lists Google albums when linked", async () => {
    googleLinked();
    cloudGet.mockResolvedValueOnce({
      data: {
        albums: [
          { id: "g1", title: "Trip", mediaItemsCount: "12" },
          { id: "g2" },
        ],
      },
    });
    const res = await request(app).get("/widgets/photos/albums?source=google");
    expect(res.status).toBe(200);
    expect(res.body.sample).toBeUndefined();
    expect(res.body.albums).toEqual([
      { id: "g1", title: "Trip", count: 12 },
      { id: "g2", title: "Untitled album", count: null },
    ]);
    // The Photos API call carried the bearer token.
    expect(cloudGet.mock.calls[0][1].headers.Authorization).toBe("Bearer tok-123");
  });

  it("502s with a re-link hint when Google returns 403", async () => {
    googleLinked();
    cloudGet.mockRejectedValueOnce(httpError(403));
    const res = await request(app).get("/widgets/photos/albums?source=google");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/re-link/i);
  });

  it("returns sample albums when Immich is unconfigured", async () => {
    const res = await request(app).get("/widgets/photos/albums?source=immich");
    expect(res.status).toBe(200);
    expect(res.body.sample).toBe(true);
  });

  it("lists Immich albums when configured", async () => {
    findByService.mockReturnValue(
      connRow({ url: "http://immich.local", api_key: "key-1" }),
    );
    httpGet.mockResolvedValueOnce({
      data: [
        { id: "i1", albumName: "Family", assetCount: 7 },
        { id: "i2" },
      ],
    });
    const res = await request(app).get("/widgets/photos/albums?source=immich");
    expect(res.status).toBe(200);
    expect(res.body.albums).toEqual([
      { id: "i1", title: "Family", count: 7 },
      { id: "i2", title: "Untitled album", count: null },
    ]);
    expect(httpGet.mock.calls[0][0]).toBe("http://immich.local/api/albums");
    expect(httpGet.mock.calls[0][1].headers["x-api-key"]).toBe("key-1");
  });

  it("502s when a configured Immich fails", async () => {
    findByService.mockReturnValue(
      connRow({ url: "http://immich.local", api_key: "key-1" }),
    );
    httpGet.mockRejectedValueOnce(httpError(500));
    const res = await request(app).get("/widgets/photos/albums?source=immich");
    expect(res.status).toBe(502);
  });
});

// ── Photo listing ────────────────────────────────────────────────────────────
describe("GET /widgets/photos", () => {
  it("rejects an unknown source", async () => {
    const res = await request(app).get("/widgets/photos?source=nope");
    expect(res.status).toBe(400);
  });

  it("returns sample mode when Google is not linked", async () => {
    const res = await request(app).get("/widgets/photos?source=google&albumId=abc");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sample: true, photos: [] });
  });

  it("returns sample mode for a sample album even when linked", async () => {
    googleLinked();
    const res = await request(app).get(
      "/widgets/photos?source=google&albumId=sample-family",
    );
    expect(res.status).toBe(200);
    expect(res.body.sample).toBe(true);
    expect(cloudPost).not.toHaveBeenCalled();
  });

  it("returns proxy-path photos for a Google album", async () => {
    googleLinked();
    cloudPost.mockResolvedValueOnce({
      data: {
        mediaItems: [
          { id: "m1", mimeType: "image/jpeg" },
          { id: "vid", mimeType: "video/mp4" },
          { id: "m2", mimeType: "image/png" },
        ],
      },
    });
    const res = await request(app).get("/widgets/photos?source=google&albumId=alb-1");
    expect(res.status).toBe(200);
    // Videos are filtered out; URLs are authenticated server proxy paths.
    expect(res.body.photos).toEqual([
      { id: "m1", url: "/api/widgets/photos/google/media/m1" },
      { id: "m2", url: "/api/widgets/photos/google/media/m2" },
    ]);
    expect(cloudPost.mock.calls[0][1]).toMatchObject({ albumId: "alb-1" });
  });

  it("502s when a linked Google album fetch fails", async () => {
    googleLinked();
    cloudPost.mockRejectedValueOnce(httpError(500));
    const res = await request(app).get("/widgets/photos?source=google&albumId=alb-1");
    expect(res.status).toBe(502);
  });

  it("returns sample mode when Immich is configured but no album chosen", async () => {
    findByService.mockReturnValue(
      connRow({ url: "http://immich.local", api_key: "key-1" }),
    );
    const res = await request(app).get("/widgets/photos?source=immich");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sample: true, photos: [] });
  });

  it("returns proxy-path photos for an Immich album (images only)", async () => {
    findByService.mockReturnValue(
      connRow({ url: "http://immich.local", api_key: "key-1" }),
    );
    httpGet.mockResolvedValueOnce({
      data: {
        assets: [
          { id: "a1", type: "IMAGE" },
          { id: "v1", type: "VIDEO" },
          { id: "a2", type: "IMAGE" },
        ],
      },
    });
    const res = await request(app).get("/widgets/photos?source=immich&albumId=alb-9");
    expect(res.status).toBe(200);
    expect(res.body.photos).toEqual([
      { id: "a1", url: "/api/widgets/photos/immich/asset/a1" },
      { id: "a2", url: "/api/widgets/photos/immich/asset/a2" },
    ]);
    expect(httpGet.mock.calls[0][0]).toBe("http://immich.local/api/albums/alb-9");
  });

  it("502s when a configured Immich album fetch fails", async () => {
    findByService.mockReturnValue(
      connRow({ url: "http://immich.local", api_key: "key-1" }),
    );
    httpGet.mockRejectedValueOnce(httpError(500));
    const res = await request(app).get("/widgets/photos?source=immich&albumId=alb-9");
    expect(res.status).toBe(502);
  });
});

// ── Byte proxies ─────────────────────────────────────────────────────────────
describe("GET /widgets/photos/google/media/:id", () => {
  it("400s when Google is not linked", async () => {
    const res = await request(app).get("/widgets/photos/google/media/m1");
    expect(res.status).toBe(400);
  });

  it("re-resolves the baseUrl and streams the bytes", async () => {
    googleLinked();
    cloudGet
      .mockResolvedValueOnce({
        data: { baseUrl: "https://lh3.example/fresh", mimeType: "image/png" },
      })
      .mockResolvedValueOnce({ data: Buffer.from([1, 2, 3]) });
    const res = await request(app).get("/widgets/photos/google/media/m1");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    // Second call downloads a display-sized rendition off the fresh baseUrl.
    expect(cloudGet.mock.calls[1][0]).toBe("https://lh3.example/fresh=w2048-h2048");
  });

  it("502s when the media item has no baseUrl", async () => {
    googleLinked();
    cloudGet.mockResolvedValueOnce({ data: {} });
    const res = await request(app).get("/widgets/photos/google/media/m1");
    expect(res.status).toBe(502);
  });
});

describe("GET /widgets/photos/immich/asset/:id", () => {
  it("400s when Immich is not configured", async () => {
    const res = await request(app).get("/widgets/photos/immich/asset/a1");
    expect(res.status).toBe(400);
  });

  it("proxies the thumbnail bytes with the API key server-side", async () => {
    findByService.mockReturnValue(
      connRow({ url: "http://immich.local", api_key: "key-1" }),
    );
    httpGet.mockResolvedValueOnce({
      data: Buffer.from([9, 9]),
      headers: { "content-type": "image/webp" },
    });
    const res = await request(app).get("/widgets/photos/immich/asset/a1");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/webp");
    expect(httpGet.mock.calls[0][0]).toBe(
      "http://immich.local/api/assets/a1/thumbnail",
    );
    expect(httpGet.mock.calls[0][1].headers["x-api-key"]).toBe("key-1");
  });

  it("502s when a configured Immich asset fetch fails", async () => {
    findByService.mockReturnValue(
      connRow({ url: "http://immich.local", api_key: "key-1" }),
    );
    httpGet.mockRejectedValueOnce(httpError(500));
    const res = await request(app).get("/widgets/photos/immich/asset/a1");
    expect(res.status).toBe(502);
  });
});
