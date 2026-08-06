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

describe("GET /api/widgets/videoplayer/browse", () => {
  it("rejects an unsupported server", async () => {
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=emby&kind=shows&libraryId=1",
    );
    expect(res.status).toBe(400);
  });

  it("rejects an unknown kind", async () => {
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=plex&kind=albums&libraryId=1",
    );
    expect(res.status).toBe(400);
  });

  it.each(["shows", "movies"])("requires libraryId for kind=%s", async (kind) => {
    const res = await request(makeApp()).get(
      `/api/widgets/videoplayer/browse?server=plex&kind=${kind}`,
    );
    expect(res.status).toBe(400);
  });

  it.each(["seasons", "episodes", "show_episodes"])(
    "requires id for kind=%s",
    async (kind) => {
      const res = await request(makeApp()).get(
        `/api/widgets/videoplayer/browse?server=plex&kind=${kind}`,
      );
      expect(res.status).toBe(400);
    },
  );

  it("returns sample when Plex is not connected", async () => {
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=plex&kind=shows&libraryId=1",
    );
    expect(res.status).toBe(200);
    expect(res.body.sample).toBe(true);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it("lists a TV library's shows with tokenized thumbnails", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "plex" ? plexRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          Metadata: [
            {
              ratingKey: 5,
              title: "A Show",
              type: "show",
              year: 2020,
              leafCount: 12,
              thumb: "/library/metadata/5/thumb/1",
            },
            // Non-show rows (e.g. mixed content) are dropped.
            { ratingKey: 6, title: "Stray Movie", type: "movie" },
          ],
        },
      },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=plex&kind=shows&libraryId=2",
    );
    expect(res.status).toBe(200);
    expect(httpGet.mock.calls[0]![0]).toBe(
      "http://plex.local:32400/library/sections/2/all",
    );
    expect(res.body.containers).toEqual([
      {
        id: "5",
        kind: "show",
        title: "A Show",
        subtitle: "2020 · 12 episodes",
        thumb:
          "http://plex.local:32400/library/metadata/5/thumb/1?X-Plex-Token=plex-token",
      },
    ]);
  });

  it("lists a show's seasons via children, dropping pseudo-entries", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "plex" ? plexRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          Metadata: [
            // Plex "All episodes" pseudo-row has no season type.
            { ratingKey: 7, title: "All episodes", type: "directory" },
            { ratingKey: 8, title: "Season 1", type: "season", leafCount: 1 },
          ],
        },
      },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=plex&kind=seasons&id=5",
    );
    expect(res.status).toBe(200);
    expect(httpGet.mock.calls[0]![0]).toBe(
      "http://plex.local:32400/library/metadata/5/children",
    );
    expect(res.body.containers).toEqual([
      {
        id: "8",
        kind: "season",
        title: "Season 1",
        subtitle: "1 episode",
        thumb: null,
      },
    ]);
  });

  it("lists a season's playable episodes with index prefixes", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "plex" ? plexRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          Metadata: [
            {
              ratingKey: 9,
              title: "Pilot",
              type: "episode",
              index: 1,
              duration: 1800000,
              Media: [{ Part: [{ key: "/library/parts/9/ep.mkv" }] }],
            },
            // No playable part → dropped.
            { ratingKey: 10, title: "Broken", type: "episode", index: 2 },
          ],
        },
      },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=plex&kind=episodes&id=8",
    );
    expect(res.status).toBe(200);
    expect(res.body.videos).toEqual([
      {
        id: "9",
        title: "1. Pilot",
        streamUrl:
          "http://plex.local:32400/library/parts/9/ep.mkv?X-Plex-Token=plex-token",
        durationMs: 1800000,
        thumb: null,
      },
    ]);
  });

  it("lists a Plex movie library as playable posters for kind=movies", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "plex" ? plexRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          Metadata: [
            {
              ratingKey: 21,
              title: "Big Movie",
              type: "movie",
              index: 3,
              duration: 5400000,
              thumb: "/library/metadata/21/thumb/1",
              Media: [{ Part: [{ key: "/library/parts/21/file.mp4" }] }],
            },
            // No playable part → dropped.
            { ratingKey: 22, title: "Broken", type: "movie" },
          ],
        },
      },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=plex&kind=movies&libraryId=1",
    );
    expect(res.status).toBe(200);
    expect(httpGet.mock.calls[0]![0]).toBe(
      "http://plex.local:32400/library/sections/1/all",
    );
    expect(res.body.videos).toEqual([
      {
        id: "21",
        // Movies never get an index prefix, even when Plex reports one.
        title: "Big Movie",
        streamUrl:
          "http://plex.local:32400/library/parts/21/file.mp4?X-Plex-Token=plex-token",
        durationMs: 5400000,
        thumb:
          "http://plex.local:32400/library/metadata/21/thumb/1?X-Plex-Token=plex-token",
      },
    ]);
  });

  it("flattens a whole show via allLeaves for kind=show_episodes", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "plex" ? plexRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: { MediaContainer: { Metadata: [] } },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=plex&kind=show_episodes&id=5",
    );
    expect(res.status).toBe(200);
    expect(httpGet.mock.calls[0]![0]).toBe(
      "http://plex.local:32400/library/metadata/5/allLeaves",
    );
    expect(res.body.videos).toEqual([]);
  });

  it("pages Plex results and reports nextOffset/total when truncated", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "plex" ? plexRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          totalSize: 500,
          Metadata: Array.from({ length: 200 }, (_, i) => ({
            ratingKey: i,
            title: `Show ${i}`,
            type: "show",
          })),
        },
      },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=plex&kind=shows&libraryId=2&offset=200",
    );
    expect(res.status).toBe(200);
    expect(httpGet.mock.calls[0]![1]).toMatchObject({
      params: {
        "X-Plex-Container-Start": "200",
        "X-Plex-Container-Size": "200",
      },
    });
    expect(res.body.total).toBe(500);
    expect(res.body.nextOffset).toBe(400);
    expect(res.body.containers).toHaveLength(200);
  });

  it("pages Jellyfin results via StartIndex and reports nextOffset/total", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "jellyfin" ? jellyfinRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        TotalRecordCount: 450,
        Items: Array.from({ length: 200 }, (_, i) => ({
          Id: `m${i}`,
          Name: `Movie ${i}`,
          Type: "Movie",
        })),
      },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=jellyfin&kind=movies&libraryId=lib1&offset=200",
    );
    expect(res.status).toBe(200);
    expect(httpGet.mock.calls[0]![1]).toMatchObject({
      params: expect.objectContaining({ StartIndex: "200", Limit: "200" }),
    });
    expect(res.body.total).toBe(450);
    expect(res.body.nextOffset).toBe(400);
    expect(res.body.videos).toHaveLength(200);
  });

  it("returns nextOffset null when the Plex level fits in one page", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "plex" ? plexRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          totalSize: 2,
          Metadata: [
            { ratingKey: 1, title: "A", type: "show" },
            { ratingKey: 2, title: "B", type: "show" },
          ],
        },
      },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=plex&kind=shows&libraryId=2",
    );
    expect(res.status).toBe(200);
    expect(res.body.nextOffset).toBeNull();
    expect(res.body.total).toBe(2);
  });

  it("returns 502 when a configured Plex fails (never sample fallback)", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "plex" ? plexRow : undefined,
    );
    httpGet.mockRejectedValue(new Error("boom"));
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=plex&kind=shows&libraryId=1",
    );
    expect(res.status).toBe(502);
  });

  // ── Jellyfin ───────────────────────────────────────────────────────────────

  it("returns sample when Jellyfin is not connected", async () => {
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=jellyfin&kind=shows&libraryId=lib1",
    );
    expect(res.status).toBe(200);
    expect(res.body.sample).toBe(true);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it("lists a Jellyfin library's series with Primary-image thumbnails", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "jellyfin" ? jellyfinRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        Items: [
          {
            Id: "s1",
            Name: "A Show",
            Type: "Series",
            ProductionYear: 2020,
            RecursiveItemCount: 12,
            ImageTags: { Primary: "tag1" },
          },
          // No Primary image → thumb null.
          { Id: "s2", Name: "Plain Show", Type: "Series" },
        ],
      },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=jellyfin&kind=shows&libraryId=lib1",
    );
    expect(res.status).toBe(200);
    expect(httpGet.mock.calls[0]![0]).toBe("http://jf.local:8096/Items");
    const params = (httpGet.mock.calls[0]![1] as { params: Record<string, string> }).params;
    expect(params["ParentId"]).toBe("lib1");
    expect(params["IncludeItemTypes"]).toBe("Series");
    expect(params["Recursive"]).toBe("true");
    expect(res.body.containers).toEqual([
      {
        id: "s1",
        kind: "show",
        title: "A Show",
        subtitle: "2020 · 12 episodes",
        thumb: "http://jf.local:8096/Items/s1/Images/Primary?api_key=jf-key",
      },
      { id: "s2", kind: "show", title: "Plain Show", subtitle: null, thumb: null },
    ]);
  });

  it("lists a Jellyfin show's seasons", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "jellyfin" ? jellyfinRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        Items: [
          { Id: "se1", Name: "Season 1", Type: "Season", RecursiveItemCount: 1 },
        ],
      },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=jellyfin&kind=seasons&id=s1",
    );
    expect(res.status).toBe(200);
    const params = (httpGet.mock.calls[0]![1] as { params: Record<string, string> }).params;
    expect(params["ParentId"]).toBe("s1");
    expect(params["IncludeItemTypes"]).toBe("Season");
    expect(res.body.containers).toEqual([
      { id: "se1", kind: "season", title: "Season 1", subtitle: "1 episode", thumb: null },
    ]);
  });

  it("lists a Jellyfin season's playable episodes with index prefixes", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "jellyfin" ? jellyfinRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        Items: [
          {
            Id: "e1",
            Name: "Pilot",
            Type: "Episode",
            IndexNumber: 1,
            RunTimeTicks: 18_000_000_000,
          },
        ],
      },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=jellyfin&kind=episodes&id=se1",
    );
    expect(res.status).toBe(200);
    const params = (httpGet.mock.calls[0]![1] as { params: Record<string, string> }).params;
    expect(params["ParentId"]).toBe("se1");
    expect(params["IncludeItemTypes"]).toBe("Episode");
    expect(res.body.videos).toEqual([
      {
        id: "e1",
        title: "1. Pilot",
        streamUrl: "http://jf.local:8096/Videos/e1/stream?static=true&api_key=jf-key",
        durationMs: 1_800_000,
        thumb: null,
      },
    ]);
  });

  it("lists a Jellyfin movie library as playable posters for kind=movies", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "jellyfin" ? jellyfinRow : undefined,
    );
    httpGet.mockResolvedValue({
      data: {
        Items: [
          {
            Id: "m1",
            Name: "Big Movie",
            Type: "Movie",
            RunTimeTicks: 54_000_000_000,
            ImageTags: { Primary: "tag1" },
          },
        ],
      },
    });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=jellyfin&kind=movies&libraryId=lib1",
    );
    expect(res.status).toBe(200);
    const params = (httpGet.mock.calls[0]![1] as { params: Record<string, string> }).params;
    expect(params["ParentId"]).toBe("lib1");
    expect(params["IncludeItemTypes"]).toBe("Movie,Video,MusicVideo");
    expect(res.body.videos).toEqual([
      {
        id: "m1",
        title: "Big Movie",
        streamUrl: "http://jf.local:8096/Videos/m1/stream?static=true&api_key=jf-key",
        durationMs: 5_400_000,
        thumb: "http://jf.local:8096/Items/m1/Images/Primary?api_key=jf-key",
      },
    ]);
  });

  it("flattens a Jellyfin show recursively for kind=show_episodes", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "jellyfin" ? jellyfinRow : undefined,
    );
    httpGet.mockResolvedValue({ data: { Items: [] } });
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=jellyfin&kind=show_episodes&id=s1",
    );
    expect(res.status).toBe(200);
    const params = (httpGet.mock.calls[0]![1] as { params: Record<string, string> }).params;
    expect(params["ParentId"]).toBe("s1");
    expect(params["Recursive"]).toBe("true");
    expect(params["IncludeItemTypes"]).toBe("Episode");
    expect(params["SortBy"]).toBe("ParentIndexNumber,IndexNumber,SortName");
    expect(res.body.videos).toEqual([]);
  });

  it("returns 502 when a configured Jellyfin fails (never sample fallback)", async () => {
    findByService.mockImplementation((_userId: number, service: string) =>
      service === "jellyfin" ? jellyfinRow : undefined,
    );
    httpGet.mockRejectedValue(new Error("boom"));
    const res = await request(makeApp()).get(
      "/api/widgets/videoplayer/browse?server=jellyfin&kind=shows&libraryId=lib1",
    );
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
