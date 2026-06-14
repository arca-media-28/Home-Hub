import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { requireAuth, type AuthRequest } from "../lib/auth.js";
import { uploadStmts } from "../lib/db.js";
import { logger } from "../lib/logger.js";

const router = Router();

const dataDir = process.env["DATA_DIR"] || "./data";
const uploadsDir = path.join(dataDir, "uploads");

// Keep the upload in memory so we can optimize it with sharp before writing the
// final file to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

// Largest edge (px) we keep an uploaded raster image at. Tiles are small, so
// downscaling large photos here keeps the dashboard payloads light.
const MAX_EDGE = 1024;

// Optimize a raster image buffer: downscale to MAX_EDGE (never upscale) and
// re-encode with sensible compression while preserving the original format.
// SVG (vector) and GIF (often animated) are passed through untouched.
async function optimizeImage(
  buffer: Buffer,
  mimetype: string,
): Promise<{ buffer: Buffer; ext: string }> {
  if (mimetype === "image/svg+xml") return { buffer, ext: ".svg" };
  if (mimetype === "image/gif") return { buffer, ext: ".gif" };

  const pipeline = sharp(buffer, { failOn: "none" }).rotate().resize({
    width: MAX_EDGE,
    height: MAX_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });

  switch (mimetype) {
    case "image/png":
      return { buffer: await pipeline.png({ compressionLevel: 9 }).toBuffer(), ext: ".png" };
    case "image/webp":
      return { buffer: await pipeline.webp({ quality: 82 }).toBuffer(), ext: ".webp" };
    case "image/jpeg":
    default:
      return {
        buffer: await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer(),
        ext: ".jpg",
      };
  }
}

// POST /api/uploads — upload + optimize a single image
router.post("/", requireAuth, upload.single("file"), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    let optimized: { buffer: Buffer; ext: string };
    try {
      optimized = await optimizeImage(req.file.buffer, req.file.mimetype);
    } catch (err) {
      // If sharp can't process the image (corrupt/unsupported variant), fall
      // back to storing the original bytes so the upload still succeeds.
      logger.warn({ err }, "image optimization failed; storing original");
      optimized = {
        buffer: req.file.buffer,
        ext: path.extname(req.file.originalname).toLowerCase() || ".img",
      };
    }

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${optimized.ext}`;
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, filename), optimized.buffer);

    const url = `/api/uploads/files/${filename}`;

    const row = uploadStmts.create.get(
      req.user!.userId,
      filename,
      req.file.originalname,
      req.file.mimetype,
      optimized.buffer.length,
      url,
    );

    res.status(201).json({ id: row!.id, url });
  } catch (err) {
    logger.error({ err }, "upload failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/uploads — list the current user's uploaded images (the library)
router.get("/", requireAuth, (req: AuthRequest, res) => {
  const files = uploadStmts.findAllByUser.all(req.user!.userId);
  res.json(
    files.map((f) => ({
      id: f.id,
      url: f.url,
      originalName: f.original_name,
      mimetype: f.mimetype,
      size: f.size,
      createdAt: f.created_at,
    })),
  );
});

// DELETE /api/uploads/:id — remove an image from the library and disk
router.delete("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = parseInt(String(req.params["id"]));
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const file = uploadStmts.findById.get(id, req.user!.userId);
  if (!file) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  uploadStmts.delete.run(id, req.user!.userId);

  // Best-effort cleanup of the backing file on disk.
  try {
    fs.unlinkSync(path.join(uploadsDir, file.filename));
  } catch (err) {
    logger.warn({ err, filename: file.filename }, "could not remove upload file from disk");
  }

  res.status(204).send();
});

export default router;
