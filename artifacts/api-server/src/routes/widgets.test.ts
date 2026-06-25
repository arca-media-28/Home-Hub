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
// Tailscale (and other cloud-only services) use the TLS-verifying cloud client.
const cloudGet = vi.fn();
vi.mock("../lib/http.js", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
    post: (...args: unknown[]) => httpPost(...args),
    delete: (...args: unknown[]) => httpDelete(...args),
  },
  cloudHttpClient: {
    get: (...args: unknown[]) => cloudGet(...args),
  },
  normalizeBaseUrl: (url: string | undefined | null) => {
    const trimmed = url?.trim();
    if (!trimmed) return undefined;
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return withScheme.replace(/\/+$/, "");
  },
  normalizeHttpError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  describeHttpError: (err: unknown) => {
    const e = err as { isAxiosError?: boolean; code?: string; message?: string; response?: { status?: number; data?: unknown } };
    if (e?.isAxiosError) {
      return {
        status: e.response?.status ?? null,
        code: e.code ?? null,
        message: e.message ?? "",
        body: e.response?.data ?? null,
      };
    }
    if (err instanceof Error) return { status: null, code: null, message: err.message, body: null };
    return { status: null, code: null, message: String(err), body: null };
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
  httpDelete.mockReset();
  cloudGet.mockReset();
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
    // Sample disks include a hot, SMART-failed drive so the tile preview shows
    // the degraded styling without a live connection.
    expect(res.body.disks).toHaveLength(3);
    expect(res.body.disks.some((d: { smartPassed: boolean | null }) => d.smartPassed === false)).toBe(true);
    // No upstream calls should be made for sample data.
    expect(httpGet).not.toHaveBeenCalled();
    expect(httpPost).not.toHaveBeenCalled();
  });

  it("normalizes live data: CPU = 100 - idle, memory buckets, pool capacity", async () => {
    findByService.mockReturnValue(
      connRow({ service: "truenas", url: "https://nas.local", api_key: "key" }),
    );

    // reporting/get_data → POST. The real response puts "time" first in the
    // legend and each data row is aligned to that full legend (timestamp first).
    // CPU legend includes idle=80 (→ 20% used). Memory values are in bytes; total
    // is the sum of present buckets.
    httpPost.mockResolvedValue({
      data: [
        {
          name: "cpu",
          legend: ["time", "user", "system", "idle"],
          data: [[1000, 15, 5, 80]],
        },
        {
          name: "memory",
          legend: ["time", "used", "free", "cached", "buffers"],
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
    // The window must end slightly in the past, not at "now" (the latest samples
    // aren't collected yet), so `end` is strictly before the current second.
    const [, postBody] = httpPost.mock.calls[0]!;
    expect(postBody.graphs).toEqual([{ name: "cpu" }, { name: "memory" }]);
    expect(Number.isInteger(postBody.reporting_query.start)).toBe(true);
    expect(Number.isInteger(postBody.reporting_query.end)).toBe(true);
    expect(postBody.reporting_query.end).toBeGreaterThan(postBody.reporting_query.start);
    expect(postBody.reporting_query.end).toBeLessThan(Math.floor(Date.now() / 1000));
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
        { name: "cpu", legend: ["time", "user", "idle"], data: [[1000, 20, 80]] },
        { name: "memory", legend: ["time", "used", "free"], data: [[1000, 8e9, 8e9]] },
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
    // `aggregations.mean` excludes the "time" column, so [10, 70] maps to
    // user=10, idle=70 against the time-stripped legend.
    httpPost.mockResolvedValue({
      data: [
        {
          name: "cpu",
          legend: ["time", "user", "idle"],
          data: [[1000, 1, 1]],
          aggregations: { mean: [10, 70] },
        },
        { name: "memory", legend: ["time", "used", "free"], data: [[1000, 1e9, 1e9]] },
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

  // Route GET responses by URL so the pool, disk-inventory and SMART-results
  // calls each return their own payload.
  function mockTruenasGets(opts: {
    pool?: unknown;
    poolError?: Error;
    disk?: unknown;
    diskError?: Error;
    smart?: unknown;
    smartError?: Error;
  }) {
    httpGet.mockImplementation((url: string) => {
      if (url.endsWith("/api/v2.0/pool")) {
        return opts.poolError ? Promise.reject(opts.poolError) : Promise.resolve({ data: opts.pool ?? [] });
      }
      if (url.endsWith("/api/v2.0/disk")) {
        return opts.diskError ? Promise.reject(opts.diskError) : Promise.resolve({ data: opts.disk ?? [] });
      }
      if (url.endsWith("/api/v2.0/smart/test/results")) {
        return opts.smartError ? Promise.reject(opts.smartError) : Promise.resolve({ data: opts.smart ?? [] });
      }
      return Promise.resolve({ data: [] });
    });
  }

  it("merges disk temperatures with SMART test results into per-disk health", async () => {
    findByService.mockReturnValue(
      connRow({ service: "truenas", url: "https://nas.local", api_key: "key" }),
    );
    httpPost.mockResolvedValue({
      data: [
        { name: "cpu", legend: ["time", "idle"], data: [[1000, 80]] },
        { name: "memory", legend: ["time", "used", "free"], data: [[1000, 1e9, 1e9]] },
      ],
    });
    mockTruenasGets({
      pool: [],
      disk: [
        { name: "sda", temperature: 34 },
        { name: "sdb", temperature: 55 },
      ],
      smart: [
        { disk: "sda", tests: [{ status: "SUCCESS" }] },
        { disk: "sdb", tests: [{ status: "RUNNING" }, { status: "FAILED" }] },
      ],
    });

    const res = await request(app).get("/widgets/truenas");
    expect(res.status).toBe(200);
    expect(res.body.disks).toEqual([
      { name: "sda", temperatureC: 34, smartPassed: true },
      { name: "sdb", temperatureC: 55, smartPassed: false },
    ]);
  });

  it("reports unknown SMART/temperature as null without dropping the disk", async () => {
    findByService.mockReturnValue(
      connRow({ service: "truenas", url: "https://nas.local", api_key: "key" }),
    );
    httpPost.mockResolvedValue({
      data: [{ name: "cpu", legend: ["time", "idle"], data: [[1000, 90]] }],
    });
    // Temperatures available, SMART call failed entirely → smartPassed null.
    mockTruenasGets({
      pool: [],
      disk: [{ name: "sda", temperature: 30 }, { name: "sdc" }],
      smartError: httpError(500),
    });

    const res = await request(app).get("/widgets/truenas");
    expect(res.status).toBe(200);
    expect(res.body.disks).toEqual([
      { name: "sda", temperatureC: 30, smartPassed: null },
      { name: "sdc", temperatureC: null, smartPassed: null },
    ]);
  });

  it("returns empty disks when the disk inventory call fails (additive, no 502)", async () => {
    findByService.mockReturnValue(
      connRow({ service: "truenas", url: "https://nas.local", api_key: "key" }),
    );
    httpPost.mockResolvedValue({
      data: [{ name: "cpu", legend: ["time", "idle"], data: [[1000, 70]] }],
    });
    mockTruenasGets({
      pool: [{ name: "tank", status: "ONLINE", topology: { data: [{ stats: { allocated: 1e12, size: 2e12 } }] } }],
      diskError: httpError(500),
      smart: [{ disk: "sda", tests: [{ status: "SUCCESS" }] }],
    });

    const res = await request(app).get("/widgets/truenas");
    expect(res.status).toBe(200);
    expect(res.body.pools).toHaveLength(1); // pool still renders
    expect(res.body.disks).toEqual([]); // no inventory → nothing to show
  });

  // Route the two reporting POSTs by their requested graph names: the core call
  // asks for cpu/memory, the extras call asks for interface/arcactualrate/arcsize.
  function mockTruenasReporting(opts: { core?: unknown; coreError?: Error; extras?: unknown; extrasError?: Error }) {
    httpPost.mockImplementation((_url: string, body: { graphs: Array<{ name?: string }> }) => {
      const names = body.graphs.map((g) => g.name);
      if (names.includes("interface")) {
        return opts.extrasError ? Promise.reject(opts.extrasError) : Promise.resolve({ data: opts.extras ?? [] });
      }
      return opts.coreError ? Promise.reject(opts.coreError) : Promise.resolve({ data: opts.core ?? [] });
    });
  }

  it("parses network throughput and ARC stats from the extras reporting call", async () => {
    findByService.mockReturnValue(
      connRow({ service: "truenas", url: "https://nas.local", api_key: "key" }),
    );
    mockTruenasReporting({
      core: [{ name: "cpu", legend: ["time", "idle"], data: [[1000, 80]] }],
      // interface throughput is kilobits/s (→ Mbps is /1000); arcactualrate is
      // hits/misses per second (→ 9000/(9000+1000) = 90% hit); arcsize is bytes.
      // Two data rows per graph so the route can build a per-sample series. The
      // current value is taken from the LAST row.
      extras: [
        {
          name: "interface",
          legend: ["time", "received", "sent"],
          data: [
            [1000, 120000, 30000],
            [1060, 184600, 42300],
          ],
        },
        {
          name: "arcactualrate",
          legend: ["time", "hits", "misses"],
          data: [
            [1000, 8000, 2000],
            [1060, 9000, 1000],
          ],
        },
        { name: "arcsize", legend: ["time", "arc_size"], data: [[1000, 31.4e9]] },
      ],
    });
    httpGet.mockResolvedValue({ data: [] });

    const res = await request(app).get("/widgets/truenas");
    expect(res.status).toBe(200);
    expect(res.body.netInMbps).toBe(184.6);
    expect(res.body.netOutMbps).toBe(42.3);
    expect(res.body.arcHitRatio).toBe(90);
    expect(res.body.arcSizeGb).toBeCloseTo(31.4, 1);
    // Per-sample series (kilobits/s → Mbps; ARC hit ratio per row).
    expect(res.body.netInSeries).toEqual([120, 184.6]);
    expect(res.body.netOutSeries).toEqual([30, 42.3]);
    expect(res.body.arcHitSeries).toEqual([80, 90]);
    // The extras call must request a longer, NON-aggregated window so the data
    // rows form a series (aggregate:true collapses them to a single mean).
    const extraReportingCall = httpPost.mock.calls.find(
      ([, body]: [string, { graphs: Array<{ name?: string }>; reporting_query?: { aggregate?: boolean } }]) =>
        body.graphs.some((g) => g.name === "interface"),
    );
    expect(extraReportingCall![1].reporting_query?.aggregate).toBe(false);
    // CPU still parsed from the core call.
    expect(res.body.cpuPercent).toBe(20);

    // The extras must ride a SEPARATE reporting POST, not be bundled with cpu/memory.
    const extraCall = httpPost.mock.calls.find(
      ([, body]: [string, { graphs: Array<{ name?: string }> }]) =>
        body.graphs.some((g) => g.name === "interface"),
    );
    expect(extraCall).toBeDefined();
    expect(extraCall![1].graphs).toEqual([
      { name: "interface" },
      { name: "arcactualrate" },
      { name: "arcsize" },
    ]);
  });

  it("nulls net/ARC when the extras call fails but keeps CPU/RAM (additive)", async () => {
    findByService.mockReturnValue(
      connRow({ service: "truenas", url: "https://nas.local", api_key: "key" }),
    );
    mockTruenasReporting({
      core: [
        { name: "cpu", legend: ["time", "idle"], data: [[1000, 70]] },
        { name: "memory", legend: ["time", "used", "free"], data: [[1000, 8e9, 8e9]] },
      ],
      extrasError: httpError(422), // interface graph rejected by the backend
    });
    httpGet.mockResolvedValue({ data: [] });

    const res = await request(app).get("/widgets/truenas");
    expect(res.status).toBe(200); // additive failure → never a 502
    expect(res.body.cpuPercent).toBe(30); // core reporting unaffected
    expect(res.body.memUsedGb).toBe(8);
    expect(res.body.netInMbps).toBeNull();
    expect(res.body.netOutMbps).toBeNull();
    expect(res.body.arcHitRatio).toBeNull();
    expect(res.body.arcSizeGb).toBeNull();
    // Series fall back to empty (not null) so the tile simply omits the sparkline.
    expect(res.body.netInSeries).toEqual([]);
    expect(res.body.netOutSeries).toEqual([]);
    expect(res.body.arcHitSeries).toEqual([]);
  });

  it("includes network and ARC sample values when unconfigured", async () => {
    const res = await request(app).get("/widgets/truenas");
    expect(res.status).toBe(200);
    expect(res.body.netInMbps).toBe(184.6);
    expect(res.body.netOutMbps).toBe(42.3);
    expect(res.body.arcHitRatio).toBe(98.7);
    expect(res.body.arcSizeGb).toBe(31.4);
    // Sample series are non-empty so the sparkline renders on dev/Replit.
    expect(res.body.netInSeries.length).toBeGreaterThan(2);
    expect(res.body.arcHitSeries.length).toBeGreaterThan(2);
    // ARC hit ratio is a percentage, so the sample stays within 0-100.
    expect(Math.max(...res.body.arcHitSeries)).toBeLessThanOrEqual(100);
  });
});

// ── TrueNAS reporting diagnostic ───────────────────────────────────────────────
describe("GET /widgets/truenas/diagnostics", () => {
  // An axios-style error that also carries a response BODY, so we can assert the
  // diagnostic surfaces the server's actual rejection message (not just status).
  function httpErrorWithBody(status: number, body: unknown): Error {
    return Object.assign(new Error(`status ${status}`), {
      isAxiosError: true,
      code: "ERR_BAD_REQUEST",
      response: { status, data: body },
    });
  }

  it("returns 409 (not configured) and makes no upstream calls when unconfigured", async () => {
    const res = await request(app).get("/widgets/truenas/diagnostics");
    expect(res.status).toBe(409);
    expect(res.body.configured).toBe(false);
    expect(res.body.message).toMatch(/not configured/i);
    expect(httpGet).not.toHaveBeenCalled();
    expect(httpPost).not.toHaveBeenCalled();
  });

  it("probes multiple request forms and surfaces each raw outcome", async () => {
    findByService.mockReturnValue(
      connRow({ service: "truenas", url: "https://nas.local", api_key: "key" }),
    );
    // The graphs-list GET succeeds; the get_data POSTs are rejected by the
    // backend with a body explaining why (the whole point of the diagnostic).
    httpGet.mockResolvedValue({
      status: 200,
      data: [{ name: "cpu", identifiers: null }, { name: "memory", identifiers: null }],
    });
    httpPost.mockRejectedValue(
      httpErrorWithBody(422, { message: "Invalid reporting_query: end must be in the past" }),
    );

    const res = await request(app).get("/widgets/truenas/diagnostics");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    // One graphs-list probe + several get_data candidate probes.
    expect(Array.isArray(res.body.probes)).toBe(true);
    expect(res.body.probes.length).toBeGreaterThan(2);

    const graphsProbe = res.body.probes[0];
    expect(graphsProbe.ok).toBe(true);
    expect(graphsProbe.request.method).toBe("GET");
    expect(graphsProbe.response).toEqual([
      { name: "cpu", identifiers: null },
      { name: "memory", identifiers: null },
    ]);

    // Every POST probe records the EXACT request body it sent and the raw error
    // (status + the server's response body), so the user can copy the real reason.
    const postProbes = res.body.probes.filter(
      (p: { request: { method: string } }) => p.request.method === "POST",
    );
    expect(postProbes.length).toBeGreaterThan(1);
    for (const p of postProbes) {
      expect(p.ok).toBe(false);
      expect(p.status).toBe(422);
      expect(p.body).toEqual({ message: "Invalid reporting_query: end must be in the past" });
      expect(p.request.body.graphs).toBeDefined();
      expect(p.request.body.reporting_query).toBeDefined();
    }
  });

  it("captures a successful probe's response body when a form is accepted", async () => {
    findByService.mockReturnValue(
      connRow({ service: "truenas", url: "https://nas.local", api_key: "key" }),
    );
    httpGet.mockResolvedValue({ status: 200, data: [] });
    httpPost.mockResolvedValue({
      status: 200,
      data: [{ name: "cpu", legend: ["time", "idle"], data: [[1000, 80]] }],
    });

    const res = await request(app).get("/widgets/truenas/diagnostics");
    expect(res.status).toBe(200);
    const postProbes = res.body.probes.filter(
      (p: { request: { method: string } }) => p.request.method === "POST",
    );
    expect(postProbes.every((p: { ok: boolean; status: number }) => p.ok && p.status === 200)).toBe(true);
    expect(postProbes[0].response).toEqual([
      { name: "cpu", legend: ["time", "idle"], data: [[1000, 80]] },
    ]);
  });

  it("never leaks the API key in the diagnostic payload", async () => {
    findByService.mockReturnValue(
      connRow({ service: "truenas", url: "https://nas.local", api_key: "super-secret-key" }),
    );
    httpGet.mockResolvedValue({ status: 200, data: [] });
    httpPost.mockRejectedValue(httpErrorWithBody(422, { message: "nope" }));

    const res = await request(app).get("/widgets/truenas/diagnostics");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("super-secret-key");
  });
});

// ── Media (Plex) ──────────────────────────────────────────────────────────────
describe("GET /widgets/media", () => {
  it("returns sample data when unconfigured", async () => {
    const res = await request(app).get("/widgets/media");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(3);
    // Sample items carry a demo deep link so the click-through can be tested
    // before a real Plex server is connected.
    expect(res.body[0].url).toBe(
      "https://app.plex.tv/desktop/#!/server/demo/details?key=%2Flibrary%2Fmetadata%2F1",
    );
    expect(res.body.every((i: { url: string | null }) => typeof i.url === "string")).toBe(true);
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

  it("builds a Plex deep link from the /identity machineIdentifier + ratingKey", async () => {
    findByService.mockReturnValue(
      connRow({
        service: "plex",
        url: "https://plex.local",
        extra: JSON.stringify({ token: "plex-token" }),
      }),
    );
    // The recentlyAdded container omits machineIdentifier; it is sourced from
    // the separate /identity call instead. Route GETs by URL so each returns its
    // own payload.
    httpGet.mockImplementation((url: string) => {
      if (String(url).endsWith("/identity")) {
        return Promise.resolve({ data: { MediaContainer: { machineIdentifier: "abc123" } } });
      }
      return Promise.resolve({
        data: { MediaContainer: { Metadata: [{ ratingKey: 42, title: "Severance", type: "show" }] } },
      });
    });

    const res = await request(app).get("/widgets/media");
    expect(res.status).toBe(200);
    // The cover deep link points at app.plex.tv with the server id and an
    // encoded /library/metadata/<ratingKey> key.
    expect(res.body[0].url).toBe(
      "https://app.plex.tv/desktop/#!/server/abc123/details?key=%2Flibrary%2Fmetadata%2F42",
    );
    // The machineIdentifier must come from a dedicated /identity request.
    expect(httpGet.mock.calls.some(([u]: [string]) => String(u).endsWith("/identity"))).toBe(true);
  });

  it("omits the deep link when /identity cannot resolve the machineIdentifier", async () => {
    findByService.mockReturnValue(
      connRow({
        service: "plex",
        url: "https://plex.local",
        extra: JSON.stringify({ token: "plex-token" }),
      }),
    );
    // /identity fails (or omits the id) → no deep link can be built, but the
    // recentlyAdded list still renders. The identity failure must not 502.
    httpGet.mockImplementation((url: string) => {
      if (String(url).endsWith("/identity")) {
        return Promise.reject(httpError(500));
      }
      return Promise.resolve({
        data: { MediaContainer: { Metadata: [{ ratingKey: 42, title: "Severance", type: "show" }] } },
      });
    });

    const res = await request(app).get("/widgets/media");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: "42", title: "Severance" });
    expect(res.body[0].url).toBeNull();
  });

  it("falls back to the server root when /identity omits the machineIdentifier", async () => {
    findByService.mockReturnValue(
      connRow({
        service: "plex",
        url: "https://plex.local",
        extra: JSON.stringify({ token: "plex-token" }),
      }),
    );
    // Some servers omit machineIdentifier from /identity; the server root
    // MediaContainer still carries it, so resolution must fall back to "/".
    httpGet.mockImplementation((url: string) => {
      const u = String(url);
      if (u.endsWith("/identity")) {
        return Promise.resolve({ data: { MediaContainer: {} } });
      }
      if (u.endsWith("/library/recentlyAdded")) {
        return Promise.resolve({
          data: { MediaContainer: { Metadata: [{ ratingKey: 42, title: "Severance", type: "show" }] } },
        });
      }
      // Server root ("/") carries the machineIdentifier.
      return Promise.resolve({ data: { MediaContainer: { machineIdentifier: "root-id" } } });
    });

    const res = await request(app).get("/widgets/media");
    expect(res.status).toBe(200);
    expect(res.body[0].url).toBe(
      "https://app.plex.tv/desktop/#!/server/root-id/details?key=%2Flibrary%2Fmetadata%2F42",
    );
  });

  it("parses the machineIdentifier out of an XML /identity response", async () => {
    findByService.mockReturnValue(
      connRow({
        service: "plex",
        url: "https://plex.local",
        extra: JSON.stringify({ token: "plex-token" }),
      }),
    );
    // Some setups ignore Accept: application/json and return XML as a string;
    // the identifier must still be extracted via regex.
    httpGet.mockImplementation((url: string) => {
      if (String(url).endsWith("/identity")) {
        return Promise.resolve({
          data: '<MediaContainer size="0" machineIdentifier="xml-id" version="1.0" />',
        });
      }
      return Promise.resolve({
        data: { MediaContainer: { Metadata: [{ ratingKey: 42, title: "Severance", type: "show" }] } },
      });
    });

    const res = await request(app).get("/widgets/media");
    expect(res.status).toBe(200);
    expect(res.body[0].url).toBe(
      "https://app.plex.tv/desktop/#!/server/xml-id/details?key=%2Flibrary%2Fmetadata%2F42",
    );
  });

  it("builds a Jellyfin deep link from the /System/Info ServerId + item id", async () => {
    findByService.mockReturnValue(
      connRow({ service: "jellyfin", url: "https://jelly.local", api_key: "jelly-key" }),
    );
    // The /Items list omits the ServerId; it is sourced from the separate
    // /System/Info call. Route GETs by URL so each returns its own payload.
    httpGet.mockImplementation((url: string) => {
      if (String(url).endsWith("/System/Info")) {
        return Promise.resolve({ data: { Id: "srv-abc" } });
      }
      return Promise.resolve({
        data: { Items: [{ Id: "item-9", Name: "Oppenheimer", Type: "Movie", ProductionYear: 2023 }] },
      });
    });

    const res = await request(app).get("/widgets/media?server=jellyfin");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: "item-9", title: "Oppenheimer", type: "movie" });
    // The deep link opens the Jellyfin web app for the exact item, scoped to the
    // resolved server id.
    expect(res.body[0].url).toBe(
      "https://jelly.local/web/index.html#!/details?id=item-9&serverId=srv-abc",
    );
    // The ServerId must come from a dedicated /System/Info request.
    expect(httpGet.mock.calls.some(([u]: [string]) => String(u).endsWith("/System/Info"))).toBe(true);
  });

  it("omits the Jellyfin deep link when /System/Info cannot resolve the ServerId", async () => {
    findByService.mockReturnValue(
      connRow({ service: "jellyfin", url: "https://jelly.local", api_key: "jelly-key" }),
    );
    // /System/Info fails → no deep link can be built, but the recently-added
    // list still renders. The System/Info failure must not 502.
    httpGet.mockImplementation((url: string) => {
      if (String(url).endsWith("/System/Info")) {
        return Promise.reject(httpError(500));
      }
      return Promise.resolve({
        data: { Items: [{ Id: "item-9", Name: "Oppenheimer", Type: "Movie" }] },
      });
    });

    const res = await request(app).get("/widgets/media?server=jellyfin");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: "item-9", title: "Oppenheimer" });
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
    // Sample items carry a demo deep link so the click-through can be tested
    // before a real Plex server is connected.
    expect(res.body[0].url).toBe(
      "https://app.plex.tv/desktop/#!/server/demo/details?key=%2Flibrary%2Fmetadata%2F1",
    );
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
    // onDeck omits machineIdentifier; the deep link sources it from /identity.
    httpGet.mockImplementation((url: string) => {
      if (String(url).endsWith("/identity")) {
        return Promise.resolve({ data: { MediaContainer: { machineIdentifier: "srv-1" } } });
      }
      return Promise.resolve({
        data: {
          MediaContainer: {
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
    // Deep link is built from the /identity machineIdentifier + ratingKey.
    expect(res.body[0].url).toBe(
      "https://app.plex.tv/desktop/#!/server/srv-1/details?key=%2Flibrary%2Fmetadata%2F55",
    );
    // Token rides as the X-Plex-Token header against the onDeck endpoint (the
    // first GET; /identity is fetched in parallel).
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

  it("normalizes Jellyfin Resume: SeriesName + PlaybackPositionTicks/RunTimeTicks progress", async () => {
    findByService.mockReturnValue(
      connRow({ service: "jellyfin", url: "https://jelly.local", api_key: "jelly-key" }),
    );
    // /Items/Resume omits the ServerId; the deep link sources it from the
    // separate /System/Info call. Route GETs by URL so each returns its payload.
    httpGet.mockImplementation((url: string) => {
      if (String(url).endsWith("/System/Info")) {
        return Promise.resolve({ data: { Id: "srv-abc" } });
      }
      return Promise.resolve({
        data: {
          Items: [
            {
              Id: "item-7",
              Name: "Chapter 7",
              Type: "Episode",
              SeriesName: "Severance",
              ImageTags: { Primary: "tag1" },
              UserData: { PlaybackPositionTicks: 6000000000 },
              RunTimeTicks: 12000000000,
            },
          ],
        },
      });
    });

    const res = await request(app).get("/widgets/media/continue?server=jellyfin");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      id: "item-7",
      title: "Chapter 7",
      type: "episode",
      seriesName: "Severance",
      progress: 50, // 6000000000 / 12000000000 → 50%
    });
    // Deep link opens the Jellyfin web app for the exact item, scoped to the
    // resolved server id.
    expect(res.body[0].url).toBe(
      "https://jelly.local/web/index.html#!/details?id=item-7&serverId=srv-abc",
    );
    // The resume list must come from the dedicated /Items/Resume endpoint.
    expect(httpGet.mock.calls.some(([u]: [string]) => String(u).endsWith("/Items/Resume"))).toBe(true);
  });

  it("falls back to the series poster when a Jellyfin episode has no primary image", async () => {
    findByService.mockReturnValue(
      connRow({ service: "jellyfin", url: "https://jelly.local", api_key: "jelly-key" }),
    );
    httpGet.mockImplementation((url: string) => {
      if (String(url).endsWith("/System/Info")) {
        return Promise.resolve({ data: { Id: "srv-abc" } });
      }
      return Promise.resolve({
        data: {
          Items: [
            {
              Id: "item-7",
              Name: "Chapter 7",
              Type: "Episode",
              SeriesName: "Severance",
              SeriesId: "series-1",
              SeriesPrimaryImageTag: "stag",
              UserData: { PlaybackPositionTicks: 3000000000 },
              RunTimeTicks: 12000000000,
            },
          ],
        },
      });
    });

    const res = await request(app).get("/widgets/media/continue?server=jellyfin");
    expect(res.status).toBe(200);
    expect(res.body[0].progress).toBe(25); // 3000000000 / 12000000000 → 25%
    // No episode still → thumb sources the series' primary image instead.
    expect(res.body[0].thumb).toContain("/Items/series-1/Images/Primary");
  });

  it("omits the Jellyfin deep link when /System/Info cannot resolve the ServerId", async () => {
    findByService.mockReturnValue(
      connRow({ service: "jellyfin", url: "https://jelly.local", api_key: "jelly-key" }),
    );
    // /System/Info fails → no deep link can be built, but the resume list still
    // renders. The System/Info failure must not 502.
    httpGet.mockImplementation((url: string) => {
      if (String(url).endsWith("/System/Info")) {
        return Promise.reject(httpError(500));
      }
      return Promise.resolve({
        data: { Items: [{ Id: "item-7", Name: "Dune: Part Two", Type: "Movie" }] },
      });
    });

    const res = await request(app).get("/widgets/media/continue?server=jellyfin");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: "item-7", title: "Dune: Part Two", seriesName: null, progress: null });
    expect(res.body[0].url).toBeNull();
  });

  it("degrades to an empty list (200, never 502) when the Jellyfin Resume call fails", async () => {
    findByService.mockReturnValue(
      connRow({ service: "jellyfin", url: "https://jelly.local", api_key: "jelly-key" }),
    );
    // The resume fetch is additive: a failure must NOT take the tile down with a
    // 502 — Continue Watching is a supplementary section, so the route returns an
    // empty list and the tile keeps its other sections (e.g. Recently Added).
    httpGet.mockImplementation((url: string) => {
      if (String(url).endsWith("/System/Info")) {
        return Promise.resolve({ data: { Id: "srv-abc" } });
      }
      return Promise.reject(httpError(500));
    });

    const res = await request(app).get("/widgets/media/continue?server=jellyfin");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
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

// ── Tailscale ───────────────────────────────────────────────────────────────
describe("GET /widgets/tailscale", () => {
  it("returns sample data when unconfigured", async () => {
    const res = await request(app).get("/widgets/tailscale");
    expect(res.status).toBe(200);
    expect(res.body.tailnet).toBe("example.ts.net");
    expect(res.body.deviceCount).toBe(4);
    expect(res.body.devices).toHaveLength(4);
    // Sample devices carry addresses so the tile preview renders without a
    // live connection.
    expect(res.body.devices[0].addresses).toEqual(["100.64.0.1", "fd7a:115c:a1e0::1"]);
    // Sample data must not hit the cloud API.
    expect(cloudGet).not.toHaveBeenCalled();
  });

  it("maps live devices: addresses, online and exit-node derivation", async () => {
    findByService.mockReturnValue(
      connRow({ service: "tailscale", url: "example.ts.net", api_key: "tskey-abc" }),
    );

    const now = Date.now();
    cloudGet.mockResolvedValue({
      data: {
        devices: [
          {
            // Online (seen 1 min ago) and an approved IPv4 exit node.
            id: "node-1",
            hostname: "homelab-nas",
            name: "homelab-nas.example.ts.net",
            os: "linux",
            lastSeen: new Date(now - 60_000).toISOString(),
            enabledRoutes: ["0.0.0.0/0", "192.168.1.0/24"],
            addresses: ["100.64.0.10", "fd7a:115c:a1e0::a"],
            keyExpiryDisabled: true,
          },
          {
            // Offline (seen 2 days ago); merely advertises (not enabled) the
            // default route, so it is NOT an exit node.
            nodeId: "node-2",
            name: "old-laptop.example.ts.net",
            os: "windows",
            lastSeen: new Date(now - 2 * 86400_000).toISOString(),
            enabledRoutes: [],
            advertisedRoutes: ["0.0.0.0/0"],
            addresses: ["100.64.0.20"],
          },
        ],
      },
    });

    const res = await request(app).get("/widgets/tailscale");
    expect(res.status).toBe(200);
    expect(res.body.tailnet).toBe("example.ts.net");
    expect(res.body.deviceCount).toBe(2);
    expect(res.body.onlineCount).toBe(1);
    expect(res.body.offlineCount).toBe(1);
    // Only online exit nodes are counted.
    expect(res.body.exitNodeCount).toBe(1);

    const [nas, laptop] = res.body.devices;
    expect(nas.id).toBe("node-1");
    // Prefers the short hostname over the full DNS name.
    expect(nas.name).toBe("homelab-nas");
    expect(nas.online).toBe(true);
    expect(nas.exitNode).toBe(true);
    expect(nas.addresses).toEqual(["100.64.0.10", "fd7a:115c:a1e0::a"]);

    expect(laptop.id).toBe("node-2");
    // Falls back to the first DNS label when there is no hostname.
    expect(laptop.name).toBe("old-laptop");
    expect(laptop.online).toBe(false);
    expect(laptop.exitNode).toBe(false);
    expect(laptop.addresses).toEqual(["100.64.0.20"]);

    // Cloud API is queried with the saved token and fields=all.
    const [url, opts] = cloudGet.mock.calls[0]!;
    expect(url).toContain("/tailnet/example.ts.net/devices");
    expect(opts.headers.Authorization).toBe("Bearer tskey-abc");
    expect(opts.params.fields).toBe("all");
    // Live data must not produce a missing-address field.
    expect(httpGet).not.toHaveBeenCalled();
  });

  it("defaults addresses to an empty array when absent", async () => {
    findByService.mockReturnValue(
      connRow({ service: "tailscale", url: "example.ts.net", api_key: "tskey-abc" }),
    );
    cloudGet.mockResolvedValue({
      data: { devices: [{ id: "n", hostname: "h", os: "linux", lastSeen: new Date().toISOString() }] },
    });

    const res = await request(app).get("/widgets/tailscale");
    expect(res.status).toBe(200);
    expect(res.body.devices[0].addresses).toEqual([]);
  });

  it("returns 502 on upstream failure (no sample fallback)", async () => {
    findByService.mockReturnValue(
      connRow({ service: "tailscale", url: "example.ts.net", api_key: "tskey-abc" }),
    );
    cloudGet.mockRejectedValue(httpError(500));

    const res = await request(app).get("/widgets/tailscale");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/tailscale/i);
  });
});
