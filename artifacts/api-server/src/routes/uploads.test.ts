import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";

// Use a throwaway data dir so the real SQLite DB + uploads folder are isolated.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-test-"));
process.env["DATA_DIR"] = tmpDir;
const uploadsDir = path.join(tmpDir, "uploads");

// Auth is replaced with a pass-through that reads the user id from a header so a
// single test app can act as different users (default user 1).
vi.mock("../lib/auth.js", () => ({
  requireAuth: (
    req: { user?: { userId: number }; headers: Record<string, unknown> },
    _res: unknown,
    next: () => void,
  ) => {
    const header = req.headers["x-user-id"];
    req.user = { userId: header ? Number(header) : 1 };
    next();
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Imported after mocks (and after DATA_DIR is set) so the DB binds to tmpDir.
const { db } = await import("../lib/db.js");
const { default: uploadsRouter } = await import("./uploads.js");

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/uploads", uploadsRouter);
  return app;
}

const app = makeApp();

// Resolve the on-disk path of a stored upload from the URL returned by POST.
function diskPathFromUrl(url: string): string {
  return path.join(uploadsDir, path.basename(url));
}

beforeAll(() => {
  // The uploaded_files foreign key requires real user rows.
  db.prepare("INSERT INTO users (id, username, password) VALUES (1, 'tester', 'x')").run();
  db.prepare("INSERT INTO users (id, username, password) VALUES (2, 'other', 'x')").run();
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("POST /uploads (optimization)", () => {
  it("downscales a large raster image to MAX_EDGE (1024) and re-encodes it", async () => {
    // A 2000x1500 PNG — bigger than MAX_EDGE on its long edge.
    const big = await sharp({
      create: { width: 2000, height: 1500, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();

    const res = await request(app)
      .post("/uploads")
      .attach("file", big, { filename: "big.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf("number");

    const stored = diskPathFromUrl(res.body.url);
    expect(fs.existsSync(stored)).toBe(true);

    const meta = await sharp(fs.readFileSync(stored)).metadata();
    // Long edge clamped to MAX_EDGE, aspect ratio preserved.
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1024);
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(768);
    // Re-encoded as PNG (format preserved) and ends with .png.
    expect(meta.format).toBe("png");
    expect(stored.endsWith(".png")).toBe(true);
  });
});

describe("POST /uploads (passthrough formats)", () => {
  it("stores an SVG untouched", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="red"/></svg>',
    );

    const res = await request(app)
      .post("/uploads")
      .attach("file", svg, { filename: "icon.svg", contentType: "image/svg+xml" });

    expect(res.status).toBe(201);
    const stored = diskPathFromUrl(res.body.url);
    expect(stored.endsWith(".svg")).toBe(true);
    // Bytes are stored exactly as uploaded (no re-encoding).
    expect(fs.readFileSync(stored).equals(svg)).toBe(true);
  });

  it("stores a GIF untouched", async () => {
    const gif = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 128, b: 0 } },
    })
      .gif()
      .toBuffer();

    const res = await request(app)
      .post("/uploads")
      .attach("file", gif, { filename: "anim.gif", contentType: "image/gif" });

    expect(res.status).toBe(201);
    const stored = diskPathFromUrl(res.body.url);
    expect(stored.endsWith(".gif")).toBe(true);
    expect(fs.readFileSync(stored).equals(gif)).toBe(true);
  });
});

describe("POST /uploads (corrupt input fallback)", () => {
  it("falls back to storing the original bytes when optimization fails", async () => {
    // Not a real image — sharp cannot decode it, so the route should store it as-is.
    const garbage = Buffer.from("this is definitely not a valid PNG payload");

    const res = await request(app)
      .post("/uploads")
      .attach("file", garbage, { filename: "broken.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    const stored = diskPathFromUrl(res.body.url);
    expect(fs.existsSync(stored)).toBe(true);
    // Original bytes preserved (extension taken from the original name).
    expect(stored.endsWith(".png")).toBe(true);
    expect(fs.readFileSync(stored).equals(garbage)).toBe(true);
  });
});

describe("GET /uploads (library listing)", () => {
  it("lists only the current user's images", async () => {
    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();

    // Upload one image as user 2.
    const u2 = await request(app)
      .post("/uploads")
      .set("x-user-id", "2")
      .attach("file", png, { filename: "u2.png", contentType: "image/png" });
    expect(u2.status).toBe(201);

    const listU2 = await request(app).get("/uploads").set("x-user-id", "2");
    expect(listU2.status).toBe(200);
    expect(listU2.body.every((f: { id: number }) => f.id === u2.body.id)).toBe(true);
    expect(listU2.body).toHaveLength(1);

    // User 1 (default) has uploaded several images above but none of user 2's.
    const listU1 = await request(app).get("/uploads");
    expect(listU1.status).toBe(200);
    expect(listU1.body.some((f: { id: number }) => f.id === u2.body.id)).toBe(false);
    expect(listU1.body.length).toBeGreaterThan(0);
  });
});

describe("DELETE /uploads/:id", () => {
  it("removes the row and unlinks the file", async () => {
    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 5, g: 6, b: 7 } },
    })
      .png()
      .toBuffer();

    const created = await request(app)
      .post("/uploads")
      .attach("file", png, { filename: "todelete.png", contentType: "image/png" });
    expect(created.status).toBe(201);
    const stored = diskPathFromUrl(created.body.url);
    expect(fs.existsSync(stored)).toBe(true);

    const del = await request(app).delete(`/uploads/${created.body.id}`);
    expect(del.status).toBe(204);

    // File is gone from disk and the row no longer lists.
    expect(fs.existsSync(stored)).toBe(false);
    const list = await request(app).get("/uploads");
    expect(list.body.some((f: { id: number }) => f.id === created.body.id)).toBe(false);
  });

  it("404s when deleting another user's image and leaves it intact", async () => {
    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .png()
      .toBuffer();

    // Owned by user 1.
    const created = await request(app)
      .post("/uploads")
      .attach("file", png, { filename: "owned.png", contentType: "image/png" });
    expect(created.status).toBe(201);
    const stored = diskPathFromUrl(created.body.url);

    // User 2 cannot delete it.
    const del = await request(app)
      .delete(`/uploads/${created.body.id}`)
      .set("x-user-id", "2");
    expect(del.status).toBe(404);

    // Row + file untouched for the real owner.
    expect(fs.existsSync(stored)).toBe(true);
    const list = await request(app).get("/uploads");
    expect(list.body.some((f: { id: number }) => f.id === created.body.id)).toBe(true);
  });
});
