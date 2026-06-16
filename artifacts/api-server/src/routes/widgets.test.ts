import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Replace the auth middleware with a pass-through so we can exercise the routes
// without minting a real JWT.
vi.mock("../lib/auth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Stub the DB layer so no real SQLite file is opened and we can dictate, per
// test, whether a service is "configured" (has a stored connection row).
const findByService = vi.fn();
vi.mock("../lib/db.js", () => ({
  connectionStmts: {
    findByService: { get: (...args: unknown[]) => findByService(...args) },
  },
}));

// Stub the shared axios instance so we control every upstream HTTP response and
// never hit the network.
const httpGet = vi.fn();
const httpPost = vi.fn();
const httpDelete = vi.fn();
vi.mock("../lib/http.js", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
    post: (...args: unknown[]) => httpPost(...args),
    delete: (...args: unknown[]) => httpDelete(...args),
  },
  normalizeBaseUrl: (url: string | undefined | null) => {
    const trimmed = url?.trim();
    if (!trimmed) return undefined;
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return withScheme.replace(/\/+$/, "");
  },
  normalizeHttpError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

// Keep the logger quiet during tests.
vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Imported after the mocks are registered (vi.mock is hoisted above imports).
const { default: widgetsRouter } = await import("./widgets.js");

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/widgets", widgetsRouter);
  return app;
}

// Build a stored-connection row as the DB layer would return it.
function connRow(overrides: Record<string, unknown> = {}) {
  return {
    service: "x",
    url: null,
    api_key: null,
    username: null,
    password: null,
    extra: null,
    updated_at: "now",
    ...overrides,
  };
}

const app = makeApp();

// An axios-style error carrying an HTTP status (used to assert 502 behavior).
function httpError(status = 500): Error {
  return Object.assign(new Error(`status ${status}`), {
    response: { status },
  });
}

beforeEach(() => {
  findByService.mockReset();
  httpGet.mockReset();
  httpPost.mockReset();
  httpDelete.mockReset();
  httpDelete.mockResolvedValue({ data: {} });
  // Default: every service is unconfigured unless a test says otherwise.
  findByService.mockReturnValue(undefined);
});

// ── TrueNAS ─────────────────────────────────────────────────────────────────
describe("GET /widgets/truenas", () => {
  it("returns sample data when unconfigured", async () => {
    const res = await request(app).get("/widgets/truenas");
    expect(res.status).toBe(200);
    expect(res.body.cpuPercent).toBe(12.4);
    expect(res.body.pools).toHaveLength(2);
    // No upstream calls should be made for sample data.
    expect(httpGet).not.toHaveBeenCalled();
    expect(httpPost).not.toHaveBeenCalled();
  });

  it("normalizes live data: CPU = 100 - idle, memory buckets, pool capacity", async () => {
    findByService.mockReturnValue(
      connRow({ service: "truenas", url: "https://nas.local", api_key: "key" }),
    );

    // reporting/get_data → POST. CPU legend includes idle=80 (→ 20% used).
    // Memory legend values are in bytes; total is the sum of present buckets.
    httpPost.mockResolvedValue({
      data: [
        {
          name: "cpu",
          legend: ["user", "system", "idle"],
          data: [[1000, 15, 5, 80]],
        },
        {
          name: "memory",
          legend: ["used", "free", "cached", "buffers"],
          data: [[1000, 8e9, 4e9, 3e9, 1e9]],
        },
      ],
    });
    // pool → GET. Capacity summed from the data vdev stats.
    httpGet.mockResolvedValue({
      data: [
        {
          name: "tank",
          status: "ONLINE",
          topology: {
            data: [{ stats: { allocated: 2e12, size: 10e12 } }],
          },
        },
      ],
    });

    const res = await request(app).get("/widgets/truenas");
    expect(res.status).toBe(200);
    expect(res.body.cpuPercent).toBe(20); // 100 - 80
    expect(res.body.memUsedGb).toBe(8); // 8e9 bytes / 1e9
    expect(res.body.memTotalGb).toBe(16); // (8+4+3+1)e9 / 1e9
    expect(res.body.pools).toEqual([
      { name: "tank", status: "ONLINE", usedBytes: 2e12, totalBytes: 10e12 },
    ]);

    // Reporting must be a POST with the graphs query and integer unix-timestamp
    // start/end (the modern Netdata backend rejects relative "now-30s" strings).
    const [, postBody] = httpPost.mock.calls[0]!;
    expect(postBody.graphs).toEqual([{ name: "cpu" }, { name: "memory" }]);
    expect(Number.isInteger(postBody.reporting_query.start)).toBe(true);
    expect(Number.isInteger(postBody.reporting_query.end)).toBe(true);
    expect(postBody.reporting_query.end).toBeGreaterThan(postBody.reporting_query.start);
    expect(postBody.reporting_query.aggregate).toBe(true);
  });

  it("renders pool data when only reporting fails (partial)", async () => {
    findByService.mockReturnValue(
      connRow({ service: "truenas", url: "https://nas.local", api_key: "key" }),
    );
    httpPost.mockRejectedValue(httpError(422)); // modern backend rejected the query
    httpGet.mockResolvedValue({
      data: [
        {
          name: "tank",
          status: "ONLINE",
          topology: { data: [{ stats: { allocated: 2e12, size: 10e12 } }] },
        },
      ],
    });

    const res = await request(app).get("/widgets/truenas");
    expect(res.status).toBe(200);
    // Reporting missing → zeroed CPU/RAM, but pools still render.
    expect(res.body.cpuPercent).toBe(0);
    expect(res.body.memUsedGb).toBe(0);
    expect(res.body.memTotalGb).toBe(0);
    expect(res.body.pools).toEqual([
      { name: "tank", status: "ONLINE", usedBytes: 2e12, totalBytes: 10e12 },
    ]);
  });

  it("renders CPU/RAM when only the pool call fails (partial)", async () => {
    findByService.mockReturnValue(
      connRow({ service: "truenas", url: "https://nas.local", api_key: "key" }),
    );
    httpPost.mockResolvedValue({
      data: [
        { name: "cpu", legend: ["user", "idle"], data: [[1000, 20, 80]] },
        { name: "memory", legend: ["used", "free"], data: [[1000, 8e9, 8e9]] },
      ],
    });
    httpGet.mockRejectedValue(httpError(500));

    const res = await request(app).get("/widgets/truenas");
    expect(res.status).toBe(200);
    expect(res.body.cpuPercent).toBe(20);
    expect(res.body.memUsedGb).toBe(8);
    expect(res.body.pools).toEqual([]);
  });

  it("prefers aggregated mean over the last data row", async () => {
    findByService.mockReturnValue(
      connRow({ service: "truenas", url: "https://nas.local", api_key: "key" }),
    );
    httpPost.mockResolvedValue({
      data: [
        {
          name: "cpu",
          legend: ["user", "idle"],
          data: [[1000, 1, 1]],
          aggregations: { mean: [10, 70] },
        },
        { name: "memory", legend: ["used", "free"], data: [[1000, 1e9, 1e9]] },
      ],
    });
    httpGet.mockResolvedValue({ data: [] });

    const res = await request(app).get("/widgets/truenas");
    expect(res.body.cpuPercent).toBe(30); // 100 - 70 (from mean)
  });

  it("returns 502 on upstream failure (no mock fallback)", async () => {
    findByService.mockReturnValue(
      connRow({ service: "truenas", url: "https://nas.local", api_key: "key" }),
    );
    httpPost.mockRejectedValue(httpError(500));
    httpGet.mockRejectedValue(httpError(500));

    const res = await request(app).get("/widgets/truenas");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/TrueNAS/);
  });
});

// ── Media (Plex) ──────────────────────────────────────────────────────────────
describe("GET /widgets/media", () => {
  it("returns sample data when unconfigured", async () => {
    const res = await request(app).get("/widgets/media");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(3);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it("normalizes live Plex recently-added items", async () => {
    // A saved Plex token in the `extra` blob makes the route use Plex.
    findByService.mockReturnValue(
      connRow({
        service: "plex",
        url: "https://plex.local",
        extra: JSON.stringify({ token: "plex-token" }),
      }),
    );
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          Metadata: [
            { ratingKey: 42, title: "Severance", type: "show", year: 2022, thumb: "/t.jpg", addedAt: 1700000000 },
          ],
        },
      },
    });

    const res = await request(app).get("/widgets/media");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: "42", title: "Severance", type: "show", year: 2022 });
    expect(res.body[0].thumb).toContain("X-Plex-Token=plex-token");

    // Token must ride as the X-Plex-Token header.
    const [, opts] = httpGet.mock.calls[0]!;
    expect(opts.headers["X-Plex-Token"]).toBe("plex-token");
  });

  it("derives the show name + season label from parentTitle for season items", async () => {
    findByService.mockReturnValue(
      connRow({
        service: "plex",
        url: "https://plex.local",
        extra: JSON.stringify({ token: "plex-token" }),
      }),
    );
    // Plex "recently added" surfaces TV as a season item: the show name lives in
    // parentTitle and the per-season label is the item's own title.
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          Metadata: [
            { ratingKey: 7, title: "Season 2", type: "season", parentTitle: "Severance" },
          ],
        },
      },
    });

    const res = await request(app).get("/widgets/media");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      title: "Season 2",
      type: "season",
      seriesName: "Severance",
      seasonLabel: "Season 2",
    });
  });

  it("derives the show name from grandparentTitle for episode items", async () => {
    findByService.mockReturnValue(
      connRow({
        service: "plex",
        url: "https://plex.local",
        extra: JSON.stringify({ token: "plex-token" }),
      }),
    );
    // Episodes carry the show name in grandparentTitle and the season label in
    // parentTitle ("Severance · Season 3").
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          Metadata: [
            {
              ratingKey: 9,
              title: "Chapter 7",
              type: "episode",
              grandparentTitle: "Severance",
              parentTitle: "Season 3",
            },
          ],
        },
      },
    });

    const res = await request(app).get("/widgets/media");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      title: "Chapter 7",
      type: "episode",
      seriesName: "Severance",
      seasonLabel: "Season 3",
    });
  });

  it("builds a Plex deep link from machineIdentifier + ratingKey", async () => {
    findByService.mockReturnValue(
      connRow({
        service: "plex",
        url: "https://plex.local",
        extra: JSON.stringify({ token: "plex-token" }),
      }),
    );
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          machineIdentifier: "abc123",
          Metadata: [{ ratingKey: 42, title: "Severance", type: "show" }],
        },
      },
    });

    const res = await request(app).get("/widgets/media");
    expect(res.status).toBe(200);
    // The cover deep link points at app.plex.tv with the server id and an
    // encoded /library/metadata/<ratingKey> key.
    expect(res.body[0].url).toBe(
      "https://app.plex.tv/desktop/#!/server/abc123/details?key=%2Flibrary%2Fmetadata%2F42",
    );
  });

  it("omits the deep link when the server machineIdentifier is missing", async () => {
    findByService.mockReturnValue(
      connRow({
        service: "plex",
        url: "https://plex.local",
        extra: JSON.stringify({ token: "plex-token" }),
      }),
    );
    // No machineIdentifier on the container root → no deep link can be built.
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          Metadata: [{ ratingKey: 42, title: "Severance", type: "show" }],
        },
      },
    });

    const res = await request(app).get("/widgets/media");
    expect(res.status).toBe(200);
    expect(res.body[0].url).toBeNull();
  });

  it("returns 502 on upstream failure (no mock fallback)", async () => {
    findByService.mockReturnValue(
      connRow({
        service: "plex",
        url: "https://plex.local",
        extra: JSON.stringify({ token: "plex-token" }),
      }),
    );
    httpGet.mockRejectedValue(httpError(401));

    const res = await request(app).get("/widgets/media");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/media/);
  });
});

// ── Media: Continue Watching (Plex On Deck) ───────────────────────────────────
describe("GET /widgets/media/continue", () => {
  it("returns sample data when unconfigured", async () => {
    const res = await request(app).get("/widgets/media/continue");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ title: "Chapter 7", seriesName: "Severance", progress: 42 });
    expect(httpGet).not.toHaveBeenCalled();
  });

  it("normalizes On Deck: grandparentTitle show name + viewOffset/duration progress", async () => {
    findByService.mockReturnValue(
      connRow({
        service: "plex",
        url: "https://plex.local",
        extra: JSON.stringify({ token: "plex-token" }),
      }),
    );
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          machineIdentifier: "srv-1",
          Metadata: [
            {
              ratingKey: 55,
              title: "Chapter 7",
              type: "episode",
              grandparentTitle: "Severance",
              viewOffset: 600000,
              duration: 1200000,
              thumb: "/t.jpg",
            },
          ],
        },
      },
    });

    const res = await request(app).get("/widgets/media/continue");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      id: "55",
      title: "Chapter 7",
      type: "episode",
      seriesName: "Severance",
      progress: 50, // 600000 / 1200000 → 50%
    });
    // Deep link is built from machineIdentifier + ratingKey.
    expect(res.body[0].url).toBe(
      "https://app.plex.tv/desktop/#!/server/srv-1/details?key=%2Flibrary%2Fmetadata%2F55",
    );
    // Token rides as the X-Plex-Token header against the onDeck endpoint.
    const [url, opts] = httpGet.mock.calls[0]!;
    expect(String(url)).toContain("/library/onDeck");
    expect(opts.headers["X-Plex-Token"]).toBe("plex-token");
  });

  it("leaves progress null when viewOffset or duration is missing", async () => {
    findByService.mockReturnValue(
      connRow({
        service: "plex",
        url: "https://plex.local",
        extra: JSON.stringify({ token: "plex-token" }),
      }),
    );
    // Movies (non-episode) carry no series name; without a duration there is no
    // played fraction to compute.
    httpGet.mockResolvedValue({
      data: {
        MediaContainer: {
          Metadata: [{ ratingKey: 8, title: "Dune: Part Two", type: "movie", viewOffset: 1000 }],
        },
      },
    });

    const res = await request(app).get("/widgets/media/continue");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ title: "Dune: Part Two", type: "movie", seriesName: null, progress: null });
  });

  it("returns 502 on upstream failure (no mock fallback)", async () => {
    findByService.mockReturnValue(
      connRow({
        service: "plex",
        url: "https://plex.local",
        extra: JSON.stringify({ token: "plex-token" }),
      }),
    );
    httpGet.mockRejectedValue(httpError(500));

    const res = await request(app).get("/widgets/media/continue");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/continue watching/i);
  });
});

// ── Sonarr ──────────────────────────────────────────────────────────────────
describe("GET /widgets/sonarr", () => {
  it("returns sample data when unconfigured", async () => {
    const res = await request(app).get("/widgets/sonarr");
    expect(res.status).toBe(200);
    expect(res.body.queue).toHaveLength(2);
    expect(res.body.upcoming).toHaveLength(2);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it("normalizes live queue + calendar", async () => {
    findByService.mockReturnValue(
      connRow({ service: "sonarr", url: "https://sonarr.local", api_key: "key" }),
    );
    httpGet
      .mockResolvedValueOnce({
        data: {
          records: [
            { id: 1, title: "raw", status: "downloading", sizeleft: 25, size: 100, series: { title: "The Bear" } },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: [
          { id: 101, title: "Episode 5", series: { title: "The Bear" }, airDateUtc: "2026-06-14T00:00:00Z", seasonNumber: 3, episodeNumber: 5 },
        ],
      });

    const res = await request(app).get("/widgets/sonarr");
    expect(res.status).toBe(200);
    expect(res.body.queue[0]).toMatchObject({ id: 1, title: "The Bear", status: "downloading", progress: 75 });
    expect(res.body.upcoming[0]).toMatchObject({ seriesTitle: "The Bear", airDate: "2026-06-14", seasonNumber: 3 });

    // Auth must ride as X-Api-Key.
    const [, opts] = httpGet.mock.calls[0]!;
    expect(opts.headers["X-Api-Key"]).toBe("key");
  });

  it("returns 502 on upstream failure (no mock fallback)", async () => {
    findByService.mockReturnValue(
      connRow({ service: "sonarr", url: "https://sonarr.local", api_key: "key" }),
    );
    httpGet.mockRejectedValue(httpError(500));

    const res = await request(app).get("/widgets/sonarr");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Sonarr/);
  });
});

// ── Radarr ──────────────────────────────────────────────────────────────────
describe("GET /widgets/radarr", () => {
  it("returns sample data when unconfigured", async () => {
    const res = await request(app).get("/widgets/radarr");
    expect(res.status).toBe(200);
    expect(res.body.queue).toHaveLength(2);
    expect(res.body.upcoming).toHaveLength(2);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it("normalizes live queue + calendar (prefers digital release)", async () => {
    findByService.mockReturnValue(
      connRow({ service: "radarr", url: "https://radarr.local", api_key: "key" }),
    );
    httpGet
      .mockResolvedValueOnce({
        data: {
          records: [
            { id: 1, title: "raw", status: "downloading", sizeleft: 20, size: 200, movie: { title: "Dune: Part Two" } },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: [
          { id: 201, title: "Furiosa", year: 2024, inCinemas: "2024-05-24T00:00:00Z", digitalRelease: "2024-07-16T00:00:00Z" },
        ],
      });

    const res = await request(app).get("/widgets/radarr");
    expect(res.status).toBe(200);
    expect(res.body.queue[0]).toMatchObject({ title: "Dune: Part Two", progress: 90 });
    expect(res.body.upcoming[0]).toMatchObject({ title: "Furiosa", releaseDate: "2024-07-16", year: 2024 });
  });

  it("returns 502 on upstream failure (no mock fallback)", async () => {
    findByService.mockReturnValue(
      connRow({ service: "radarr", url: "https://radarr.local", api_key: "key" }),
    );
    httpGet.mockRejectedValue(httpError(500));

    const res = await request(app).get("/widgets/radarr");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Radarr/);
  });
});

// ── qBittorrent ─────────────────────────────────────────────────────────────
describe("GET /widgets/qbittorrent", () => {
  it("returns sample data when unconfigured", async () => {
    const res = await request(app).get("/widgets/qbittorrent");
    expect(res.status).toBe(200);
    expect(res.body.torrents).toHaveLength(3);
    // The mock fallback advertises a representative category catalog so the
    // tile filter has something to list even without a live qBittorrent.
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(res.body.categories.length).toBeGreaterThan(0);
    expect(httpPost).not.toHaveBeenCalled();
  });

  it("logs in for a SID cookie, then reuses it on the data calls", async () => {
    // Unique URL so the module-level SID cache key is isolated per test.
    const baseUrl = "https://qb-login.local";
    findByService.mockReturnValue(
      connRow({ service: "qbittorrent", url: baseUrl, username: "admin", password: "pw" }),
    );
    // Login → returns a Set-Cookie with the SID.
    httpPost.mockResolvedValue({ data: "Ok.", headers: { "set-cookie": ["SID=abc123; HttpOnly; path=/"] } });
    httpGet
      .mockResolvedValueOnce({
        data: [{ name: "ubuntu.iso", progress: 0.5, state: "downloading", dlspeed: 1000, upspeed: 50 }],
      })
      .mockResolvedValueOnce({ data: { dl_info_speed: 1000, up_info_speed: 50 } })
      // Categories endpoint: the dedicated catalog includes a category with no
      // active torrents ("Archive") that must still surface in the response.
      .mockResolvedValueOnce({
        data: {
          "Linux ISOs": { name: "Linux ISOs", savePath: "" },
          Archive: { name: "Archive", savePath: "" },
        },
      });

    const res = await request(app).get("/widgets/qbittorrent");
    expect(res.status).toBe(200);
    expect(res.body.torrents[0]).toMatchObject({ name: "ubuntu.iso", progress: 50, state: "downloading" });
    expect(res.body.downloadSpeed).toBe(1000);
    // Sorted catalog of all defined categories, including the empty "Archive".
    expect(res.body.categories).toEqual(["Archive", "Linux ISOs"]);

    // Login posts a form to the auth/login endpoint.
    expect(httpPost.mock.calls[0]![0]).toBe(`${baseUrl}/api/v2/auth/login`);
    // Both data calls must carry the extracted SID cookie.
    for (const call of httpGet.mock.calls) {
      const opts = call[1] as { headers: Record<string, string> };
      expect(opts.headers.Cookie).toBe("SID=abc123");
    }
  });

  it("handles the qBittorrent 5.x QBT_SID_<port> session cookie", async () => {
    const baseUrl = "https://qb-v5.local";
    findByService.mockReturnValue(
      connRow({ service: "qbittorrent", url: baseUrl, username: "admin", password: "pw" }),
    );
    // qBittorrent 5.x renamed the session cookie to "QBT_SID_<port>".
    httpPost.mockResolvedValue({
      data: "Ok.",
      headers: { "set-cookie": ["QBT_SID_8080=v5token; HttpOnly; SameSite=Strict; path=/"] },
    });
    httpGet
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: { dl_info_speed: 0, up_info_speed: 0 } })
      .mockResolvedValueOnce({ data: {} });

    const res = await request(app).get("/widgets/qbittorrent");
    expect(res.status).toBe(200);
    // The full name=value pair must be sent back verbatim on the data calls
    // (torrents, transfer, and the categories catalog call).
    for (const call of httpGet.mock.calls) {
      const opts = call[1] as { headers: Record<string, string> };
      expect(opts.headers.Cookie).toBe("QBT_SID_8080=v5token");
    }
  });

  it("re-authenticates once when the cached session returns 403", async () => {
    const baseUrl = "https://qb-403.local";
    findByService.mockReturnValue(
      connRow({ service: "qbittorrent", url: baseUrl, username: "admin", password: "pw" }),
    );
    httpPost.mockResolvedValue({ data: "Ok.", headers: { "set-cookie": ["SID=first; path=/"] } });
    // First data fetch 403s (expired session); after re-login the retry succeeds.
    // Each fetch issues two GETs (torrents + transfer), so the first pair 403s
    // and the second pair resolves.
    httpGet
      .mockRejectedValueOnce(httpError(403))
      .mockRejectedValueOnce(httpError(403))
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: { dl_info_speed: 0, up_info_speed: 0 } })
      .mockResolvedValueOnce({ data: {} });

    const res = await request(app).get("/widgets/qbittorrent");
    expect(res.status).toBe(200);
    // Logged in twice: initial + after the 403.
    expect(httpPost).toHaveBeenCalledTimes(2);
  });

  it("still returns torrents/transfer when the categories fetch fails", async () => {
    const baseUrl = "https://qb-cats-fail.local";
    findByService.mockReturnValue(
      connRow({ service: "qbittorrent", url: baseUrl, username: "admin", password: "pw" }),
    );
    httpPost.mockResolvedValue({ data: "Ok.", headers: { "set-cookie": ["SID=cats; path=/"] } });
    // Torrents + transfer succeed, but the dedicated categories call errors.
    // The catalog must degrade to an empty list without failing the response.
    httpGet
      .mockResolvedValueOnce({
        data: [{ name: "ubuntu.iso", progress: 0.5, state: "downloading", dlspeed: 1000, upspeed: 50 }],
      })
      .mockResolvedValueOnce({ data: { dl_info_speed: 1000, up_info_speed: 50 } })
      .mockRejectedValueOnce(httpError(500));

    const res = await request(app).get("/widgets/qbittorrent");
    expect(res.status).toBe(200);
    expect(res.body.torrents).toHaveLength(1);
    expect(res.body.categories).toEqual([]);
  });

  it("returns 502 when authentication fails", async () => {
    const baseUrl = "https://qb-fail.local";
    findByService.mockReturnValue(
      connRow({ service: "qbittorrent", url: baseUrl, username: "admin", password: "wrong" }),
    );
    httpPost.mockResolvedValue({ data: "Fails.", headers: {} });

    const res = await request(app).get("/widgets/qbittorrent");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/authentication failed/i);
  });

  it("returns 502 on upstream failure (no mock fallback)", async () => {
    const baseUrl = "https://qb-err.local";
    findByService.mockReturnValue(
      connRow({ service: "qbittorrent", url: baseUrl, username: "admin", password: "pw" }),
    );
    httpPost.mockRejectedValue(httpError(500));

    const res = await request(app).get("/widgets/qbittorrent");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/qBittorrent/);
  });
});

// ── Pi-hole ─────────────────────────────────────────────────────────────────
describe("GET /widgets/pihole", () => {
  it("returns 503 (not configured) when no base URL is saved", async () => {
    const res = await request(app).get("/widgets/pihole");
    expect(res.status).toBe(503);
    expect(httpPost).not.toHaveBeenCalled();
    expect(httpGet).not.toHaveBeenCalled();
  });

  it("reads stats from a v6 instance (session login + REST API)", async () => {
    const baseUrl = "https://pi6.local";
    findByService.mockReturnValue(connRow({ service: "pihole", url: baseUrl, api_key: "app-pw" }));
    // v6 login succeeds and returns a session id.
    httpPost.mockResolvedValue({ data: { session: { valid: true, sid: "sid-123" } } });
    httpGet
      .mockResolvedValueOnce({
        data: {
          queries: { total: 5000, blocked: 1000, percent_blocked: 20 },
          gravity: { domains_being_blocked: 123456 },
        },
      })
      .mockResolvedValueOnce({ data: { blocking: "enabled" } });

    const res = await request(app).get("/widgets/pihole");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      queriesTotal: 5000,
      adsBlocked: 1000,
      adsPercentage: 20,
      domainsBlocked: 123456,
      status: "enabled",
    });
    // v6 path: POST /api/auth, GET stats + blocking carrying the SID header.
    expect(httpPost.mock.calls[0]![0]).toBe(`${baseUrl}/api/auth`);
    for (const call of httpGet.mock.calls) {
      const opts = call[1] as { headers: Record<string, string> };
      expect(opts.headers["X-FTL-SID"]).toBe("sid-123");
    }
    // The session is cleaned up afterward.
    expect(httpDelete.mock.calls[0]![0]).toBe(`${baseUrl}/api/auth`);
    // Never touched the legacy endpoint.
    expect(httpGet.mock.calls.some((c) => String(c[0]).includes("admin/api.php"))).toBe(false);
  });

  it("falls back to the v5 endpoint when /api/auth is absent (404)", async () => {
    const baseUrl = "https://pi5.local";
    findByService.mockReturnValue(connRow({ service: "pihole", url: baseUrl, api_key: "token" }));
    // v5 hosts have no /api/auth — lighttpd answers 404.
    httpPost.mockRejectedValue(httpError(404));
    httpGet.mockResolvedValue({
      data: {
        dns_queries_today: 4200,
        ads_blocked_today: 800,
        ads_percentage_today: 19.04,
        domains_being_blocked: 99999,
        status: "enabled",
      },
    });

    const res = await request(app).get("/widgets/pihole");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      queriesTotal: 4200,
      adsBlocked: 800,
      domainsBlocked: 99999,
      status: "enabled",
    });
    expect(String(httpGet.mock.calls[0]![0])).toContain("admin/api.php");
  });

  it("surfaces a clear error when the v6 password is wrong (401)", async () => {
    const baseUrl = "https://pi6-bad.local";
    findByService.mockReturnValue(connRow({ service: "pihole", url: baseUrl, api_key: "wrong" }));
    httpPost.mockRejectedValue(httpError(401));

    const res = await request(app).get("/widgets/pihole");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/invalid api key\/password/i);
    // Did not fall back to v5 on an auth failure.
    expect(httpGet).not.toHaveBeenCalled();
  });

  it("surfaces a clear error on a bad/zeroed v5 payload (no zeros tile)", async () => {
    const baseUrl = "https://pi5-bad.local";
    findByService.mockReturnValue(connRow({ service: "pihole", url: baseUrl, api_key: "nope" }));
    httpPost.mockRejectedValue(httpError(404));
    // v5 returns 200 with the privileged fields absent when the token is wrong.
    httpGet.mockResolvedValue({ data: [] });

    const res = await request(app).get("/widgets/pihole");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/invalid pi-hole response/i);
  });
});

// ── News (RSS / Atom) ─────────────────────────────────────────────────────────
describe("GET /widgets/news", () => {
  const RSS_SAMPLE = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <item>
      <title>First headline</title>
      <link>https://example.com/a</link>
      <pubDate>Tue, 16 Jun 2026 05:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second headline</title>
      <link>https://example.com/b</link>
      <pubDate>Tue, 16 Jun 2026 04:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Third headline</title>
      <link>https://example.com/c</link>
    </item>
  </channel>
</rss>`;

  it("returns demo headlines when no feed URL is supplied", async () => {
    const res = await request(app).get("/widgets/news");
    expect(res.status).toBe(200);
    expect(res.body.feedTitle).toBe("Demo Feed");
    expect(res.body.items.length).toBeGreaterThan(0);
    // Demo content must not hit the network.
    expect(httpGet).not.toHaveBeenCalled();
  });

  it("honors the limit param for demo headlines", async () => {
    const res = await request(app).get("/widgets/news?limit=2");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(httpGet).not.toHaveBeenCalled();
  });

  it("fetches and parses a configured RSS feed", async () => {
    httpGet.mockResolvedValue({ data: RSS_SAMPLE });

    const res = await request(app).get("/widgets/news?url=https://example.com/feed.xml");
    expect(res.status).toBe(200);
    expect(res.body.feedTitle).toBe("Example Feed");
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[0]).toMatchObject({
      title: "First headline",
      link: "https://example.com/a",
    });
    expect(res.body.items[0].published).toBe("2026-06-16T05:00:00.000Z");
    // An item without a date yields a null published rather than an invalid one.
    expect(res.body.items[2].published).toBeNull();

    // Feed must be fetched as text so rss-parser receives raw XML.
    const [, opts] = httpGet.mock.calls[0]!;
    expect(opts.responseType).toBe("text");
  });

  it("caps the number of items at the requested limit", async () => {
    httpGet.mockResolvedValue({ data: RSS_SAMPLE });

    const res = await request(app).get("/widgets/news?url=https://example.com/feed.xml&limit=1");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe("First headline");
  });

  it("returns 502 when the feed cannot be fetched", async () => {
    httpGet.mockRejectedValue(httpError(500));

    const res = await request(app).get("/widgets/news?url=https://down.example.com/feed.xml");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/feed/i);
  });

  it("returns 502 when the response is not a parseable feed", async () => {
    httpGet.mockResolvedValue({ data: "<html><body>not a feed</body></html>" });

    const res = await request(app).get("/widgets/news?url=https://example.com/notafeed");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/feed/i);
  });
});
