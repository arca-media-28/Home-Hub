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
vi.mock("../lib/http.js", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
    post: (...args: unknown[]) => httpPost(...args),
  },
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

    // Reporting must be a POST with the graphs query.
    const [, postBody] = httpPost.mock.calls[0]!;
    expect(postBody.graphs).toEqual([{ name: "cpu" }, { name: "memory" }]);
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
    expect(res.body.torrents).toHaveLength(2);
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
      .mockResolvedValueOnce({ data: { dl_info_speed: 1000, up_info_speed: 50 } });

    const res = await request(app).get("/widgets/qbittorrent");
    expect(res.status).toBe(200);
    expect(res.body.torrents[0]).toMatchObject({ name: "ubuntu.iso", progress: 50, state: "downloading" });
    expect(res.body.downloadSpeed).toBe(1000);

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
      .mockResolvedValueOnce({ data: { dl_info_speed: 0, up_info_speed: 0 } });

    const res = await request(app).get("/widgets/qbittorrent");
    expect(res.status).toBe(200);
    // The full name=value pair must be sent back verbatim on the data calls.
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
      .mockResolvedValueOnce({ data: { dl_info_speed: 0, up_info_speed: 0 } });

    const res = await request(app).get("/widgets/qbittorrent");
    expect(res.status).toBe(200);
    // Logged in twice: initial + after the 403.
    expect(httpPost).toHaveBeenCalledTimes(2);
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
