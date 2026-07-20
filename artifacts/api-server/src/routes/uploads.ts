import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import DOMPurify from "isomorphic-dompurify";
import { requireAuth, type AuthRequest } from "../lib/auth.js";
import { uploadStmts } from "../lib/db.js";
import { logger } from "../lib/logger.js";

const router = Router();

const dataDir = process.env["DATA_DIR"] || "./data";
const uploadsDir = path.join(dataDir, "uploads");

// Keep the upload in memory so we can optimize it with sharp before writing the
// final file to disk.
// Videos are much bigger than tile images; the multer cap is the video limit
// and a stricter per-type cap for images is enforced in processUpload (the
// client-supplied mimetype is only a hint — real limits key off sniffed bytes).
const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const VIDEO_MAX_BYTES = 200 * 1024 * 1024; // 200MB

// Total cap across ALL stored uploads (all users) so uploads can never fill
// the data directory — which also holds the SQLite database. Configurable via
// UPLOADS_MAX_TOTAL_BYTES; defaults to 5GB. Parsed lazily so tests can tweak
// the env var per request.
const DEFAULT_MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024; // 5GB
function maxTotalUploadBytes(): number {
  const raw = process.env["UPLOADS_MAX_TOTAL_BYTES"];
  if (!raw) return DEFAULT_MAX_TOTAL_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn({ raw }, "invalid UPLOADS_MAX_TOTAL_BYTES; using default");
    return DEFAULT_MAX_TOTAL_BYTES;
  }
  return Math.floor(parsed);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
      "video/mp4",
      "video/webm",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image or video files are allowed"));
    }
  },
});

// Largest edge (px) we keep an uploaded raster image at. Tiles are small, so
// downscaling large photos here keeps the dashboard payloads light.
const MAX_EDGE = 1024;

// The client-supplied MIME type (and original filename/extension) is
// completely untrustworthy — it is just a form field an attacker controls.
// We only ever decide what to do with a file, and what extension to save it
// with, based on the *actual bytes* we received. Raster formats are verified
// via magic-number sniffing (file-type); anything that doesn't sniff as one
// of our allowed raster formats is only accepted as SVG if it truly parses as
// one, and even then it is sanitized to strip any script content before it
// ever touches disk. There is no "store the original bytes as a fallback"
// path — if we can't positively identify and safely handle the content, the
// upload is rejected outright.
class UnsupportedUploadError extends Error {}

const RASTER_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

// Video formats are stored as-is (no transcoding) once their magic number
// verifies; the browser's <video> element plays them directly and the static
// file server handles range requests so seeking works.
const VIDEO_EXT: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
};

// Inverse lookup used when recording the (server-determined) mimetype for a
// stored file, plus the SVG case which isn't produced by RASTER_EXT.
const EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

// SVGs are plain XML text, so magic-number sniffing (file-type) can't detect
// them — we look for the root <svg> element ourselves. This is only used to
// decide "does this look like SVG at all", never to trust the content is
// safe; DOMPurify does that below.
function looksLikeSvg(buffer: Buffer): boolean {
  const head = buffer.toString("utf8", 0, Math.min(buffer.length, 4096));
  return /<svg[\s>]/i.test(head);
}

// Strip any script-capable content (<script>, event handler attributes,
// javascript: URIs, <foreignObject>, external references, etc.) from an SVG
// before we ever store or serve it. DOMPurify's SVG profile is the
// battle-tested way to do this rather than hand-rolled regexes.
function sanitizeSvg(buffer: Buffer): Buffer {
  const clean = DOMPurify.sanitize(buffer.toString("utf8"), {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
  if (!clean || !/<svg[\s>]/i.test(clean)) {
    throw new UnsupportedUploadError("Invalid SVG file");
  }
  return Buffer.from(clean, "utf8");
}

// Determine what a file *actually* is from its bytes, and produce the final
// (possibly re-encoded/sanitized) buffer + a server-chosen extension. Throws
// UnsupportedUploadError if the content can't be safely handled.
async function processUpload(buffer: Buffer): Promise<{ buffer: Buffer; ext: string }> {
  const detected = await fileTypeFromBuffer(buffer);

  if (detected && detected.mime in VIDEO_EXT) {
    // Videos pass through untouched (no transcoding) once the bytes verify as
    // a supported container. file-type reports Matroska-family containers for
    // webm, so both video/webm and video/x-matroska sniffs land here.
    return { buffer, ext: VIDEO_EXT[detected.mime]! };
  }
  if (detected && detected.mime === "video/x-matroska") {
    return { buffer, ext: ".webm" };
  }

  if (detected && detected.mime in RASTER_EXT) {
    if (buffer.length > IMAGE_MAX_BYTES) {
      throw new UnsupportedUploadError("Image uploads are limited to 10MB");
    }
    if (detected.mime === "image/gif") {
      // GIFs (often animated) are passed through untouched once verified.
      return { buffer, ext: ".gif" };
    }

    try {
      const pipeline = sharp(buffer, { failOn: "error" }).rotate().resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      });

      switch (detected.mime) {
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
    } catch (err) {
      // The bytes claimed to be a raster image (per magic number) but sharp
      // couldn't actually decode them — reject rather than ever writing
      // unverified bytes to disk with a trusted-looking extension.
      throw new UnsupportedUploadError(
        err instanceof Error ? err.message : "Unsupported or corrupt image file",
      );
    }
  }

  // file-type can't sniff text formats like SVG by magic number, so fall
  // back to a content check — but only ever store the *sanitized* result.
  if (looksLikeSvg(buffer)) {
    return { buffer: sanitizeSvg(buffer), ext: ".svg" };
  }

  throw new UnsupportedUploadError("Unsupported or unrecognized image file");
}

// POST /api/uploads — upload + optimize a single image
router.post("/", requireAuth, upload.single("file"), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    let processed: { buffer: Buffer; ext: string };
    try {
      processed = await processUpload(req.file.buffer);
    } catch (err) {
      if (err instanceof UnsupportedUploadError) {
        logger.warn({ err }, "rejected upload: unrecognized or unsafe file content");
        res.status(400).json({ error: "Unsupported or invalid image file" });
        return;
      }
      throw err;
    }

    // Enforce the total-storage cap on the FINAL (processed) size so uploads
    // can't fill the disk shared with the SQLite database.
    const cap = maxTotalUploadBytes();
    const currentTotal = uploadStmts.totalSize.get()!.total;
    if (currentTotal + processed.buffer.length > cap) {
      res.status(413).json({
        error: `Upload storage is full: this file would exceed the ${formatBytes(cap)} total upload limit (${formatBytes(currentTotal)} in use). Delete some uploads and try again.`,
      });
      return;
    }

    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${processed.ext}`;
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, filename), processed.buffer);

    const url = `/api/uploads/files/${filename}`;

    // Store the mimetype we determined from the actual bytes (never the
    // client-supplied one) so downstream consumers can't be misled either.
    const storedMimetype = EXT_MIME[processed.ext] ?? "application/octet-stream";

    const row = uploadStmts.create.get(
      req.user!.userId,
      filename,
      req.file.originalname,
      storedMimetype,
      processed.buffer.length,
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
