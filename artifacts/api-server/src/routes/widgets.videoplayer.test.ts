import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Same harness as widgets.photos.test.ts: pass-through auth, stubbed DB + HTTP
// clients, quiet logger.
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
vi.mock("../lib/http.js", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
  cloudHttpClient: { get: vi.fn(), post: vi.fn() },
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

const { default: widgetsRouter } = await import("./widgets.js");

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/widgets", widgetsRouter);
  return app;
}

// Rows as stored in service_connections. token lives in extra JSON for Plex.
const plexRow = {
  url: "http://plex.local:32400",
  api_key: null,
  extra: JSON.stringify({ token: "plex-token" }),
};
const jellyfinRow = {
  url: "http://jf.local:8096",
  api_key: "jf-key",
  extra: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  findByService.mockReturnValue(undefined);
  delete process.env["MEDIA_SERVER_URL"];
  delete process.env["MEDIA_SERVER_API_KEY"];
  delete process.env["MEDIA_SERVER_TYPE"];
});

describe("GET /api/widgets/videoplayer/libraries", () => {
  it("rejects a bad server param", async () => {
    const res = await request(makeApp()).get("/api/widgets/videoplayer/libraries?server=emby");
    expect(res.status).toBe(400);
  });

  it("returns sample when Plex is not connected", async () => {
    const res = await request(makeApp()).get("/api/widgets/videoplayer/libraries?server=plex");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sample: true, libraries: [] });
    expect(httpGet).not.toHaveBeenCalled();
  });

  it("returns sample when Jellyfin is not connected", async () => {
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/libraries?server=jellyfin",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sample: true, libraries: [] });
  });

  it("lists Plex movie and show libraries only", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "plex" ? plexRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          Directory: [
            { key: 1, title: "Movies", type: "movie" },
            { key: 2, title: "TV", type: "show" },
            { key: 3, title: "Music", type: "artist" },
          ],
        },
      },
    });
    const res = await request(makeApp()).get("/api/widgets/videoplayer/libraries?server=plex");
    expect(res.status).toBe(200);
    expect(res.body.sample).toBe(false);
    expect(res.body.libraries).toEqual([
      { id: "1", title: "Movies", kind: "movies" },
      { id: "2", title: "TV", kind: "shows" },
    ]);
  });

  it("lists Jellyfin video libraries only", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "jellyfin" ? jellyfinRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        Items: [
          { Id: "a", Name: "Movies", CollectionType: "movies" },
          { Id: "b", Name: "Shows", CollectionType: "tvshows" },
          { Id: "c", Name: "Music", CollectionType: "music" },
          { Id: "d", Name: "Home Videos", CollectionType: "homevideos" },
        ],
      },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/libraries?server=jellyfin",
    );
    expect(res.status).toBe(200);
    expect(res.body.libraries.map((l: { id: string }) => l.id)).toEqual(["a", "b", "d"]);
  });

  it("returns 502 when a configured Plex fails (never sample fallback)", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "plex" ? plexRow : undefined,
    );
    httpGet.mockRejectedValue(new Error("boom"));
    const res = await request(makeApp()).get("/api/widgets/videoplayer/libraries?server=plex");
    expect(res.status).toBe(502);
  });
});

describe("GET /api/widgets/videoplayer", () => {
  it("rejects a bad server param", async () => {
    const res = await request(makeApp()).get("/api/widgets/videoplayer?server=nope&libraryId=1");
    expect(res.status).toBe(400);
  });

  it("returns sample when unconfigured even without libraryId", async () => {
    const res = await request(makeApp()).get("/api/widgets/videoplayer?server=plex");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sample: true, videos: [] });
  });

  it("requires libraryId when Plex is configured", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "plex" ? plexRow : undefined,
    );
    const res = await request(makeApp()).get("/api/widgets/videoplayer?server=plex");
    expect(res.status).toBe(400);
  });

  it("maps a Plex movie library to direct-play videos with tokenized URLs", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "plex" ? plexRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          Metadata: [
            {
              ratingKey: 10,
              title: "Big Movie",
              type: "movie",
              duration: 5400000,
              Media: [{ Part: [{ key: "/library/parts/1/file.mp4" }] }],
            },
            // No playable part → dropped.
            { ratingKey: 11, title: "Broken", type: "movie" },
          ],
        },
      },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer?server=plex&libraryId=1",
    );
    expect(res.status).toBe(200);
    expect(res.body.videos).toEqual([
      {
        id: "10",
        title: "Big Movie",
        streamUrl:
          "http://plex.local:32400/library/parts/1/file.mp4?X-Plex-Token=plex-token",
        durationMs: 5400000,
      },
    ]);
  });

  it("re-queries a Plex show library for episodes", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "plex" ? plexRow : undefined,
    );
    httpGet
      .mockResolvedValueOnce({
        data: { MediaContainer: { Metadata: [{ ratingKey: 1, title: "A Show", type: "show" }] } },
      })
      .mockResolvedValueOnce({
        data: {
          MediaContainer: {
            Metadata: [
              {
                ratingKey: 2,
                title: "Pilot",
                grandparentTitle: "A Show",
                type: "episode",
                duration: 1800000,
                Media: [{ Part: [{ key: "/library/parts/2/ep.mkv" }] }],
              },
            ],
          },
        },
      });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer?server=plex&libraryId=2",
    );
    expect(res.status).toBe(200);
    expect(httpGet).toHaveBeenCalledTimes(2);
    const secondCall = httpGet.mock.calls[1] as [string, { params?: Record<string, string> }];
    expect(secondCall[1]?.params).toEqual({ type: "4" });
    expect(res.body.videos[0].title).toBe("A Show — Pilot");
  });

  it("maps Jellyfin items to static stream URLs and ms durations", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "jellyfin" ? jellyfinRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        Items: [
          { Id: "x1", Name: "Ep 1", SeriesName: "Show", RunTimeTicks: 18_000_000_000 },
          { Id: "x2", Name: "Solo Movie" },
        ],
      },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer?server=jellyfin&libraryId=lib1",
    );
    expect(res.status).toBe(200);
    expect(res.body.videos).toEqual([
      {
        id: "x1",
        title: "Show — Ep 1",
        streamUrl: "http://jf.local:8096/Videos/x1/stream?static=true&api_key=jf-key",
        durationMs: 1_800_000,
      },
      {
        id: "x2",
        title: "Solo Movie",
        streamUrl: "http://jf.local:8096/Videos/x2/stream?static=true&api_key=jf-key",
        durationMs: null,
      },
    ]);
  });

  it("returns 502 when a configured Jellyfin fails", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "jellyfin" ? jellyfinRow : undefined,
    );
    httpGet.mockRejectedValue(new Error("down"));
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer?server=jellyfin&libraryId=lib1",
    );
    expect(res.status).toBe(502);
  });
});
