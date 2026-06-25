import { Router } from "express";
import { ImportPagesBody } from "@workspace/api-zod";
import { db, pageStmts, tileStmts, type DbPage } from "../lib/db.js";
import { requireAuth, type AuthRequest } from "../lib/auth.js";
import { exportTile, createImportedTile } from "./tiles.js";

const router = Router();

// The export envelope is versioned so future format changes can be detected
// and rejected on import. Bump EXPORT_VERSION whenever the shape changes in a
// way older importers can't read.
const EXPORT_FORMAT = "homelab-dashboard-pages";
const EXPORT_VERSION = 1;

// Build a shareable export envelope for the given pages. Each page carries its
// name and an ordered list of tiles (via exportTile, which strips ids and owner
// fields). No credential data lives on pages or tiles, so the envelope is safe
// to share.
function buildExport(pages: DbPage[]) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    pages: pages.map((p) => ({
      name: p.name,
      tiles: tileStmts.findAllByPage.all(p.user_id, p.id).map(exportTile),
    })),
  };
}

// Pick a page name that doesn't collide with any name already taken. Appends
// " (2)", " (3)", … until a free name is found, mirroring how a file manager
// de-duplicates copies.
function uniquePageName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

export function formatPage(p: DbPage) {
  return {
    id: p.id,
    userId: p.user_id,
    name: p.name,
    position: p.position,
    createdAt: p.created_at,
  };
}

// Clean an incoming page name: trim, fall back to a default, and cap length so
// a stray paste can't blow up the tab bar.
function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "Page";
  const trimmed = raw.trim();
  if (!trimmed) return "Page";
  return trimmed.slice(0, 60);
}

// GET /api/pages — list the user's pages in display order.
router.get("/", requireAuth, (req: AuthRequest, res) => {
  const pages = pageStmts.findAllByUser.all(req.user!.userId);
  res.json(pages.map(formatPage));
});

// POST /api/pages — create a new (empty) page, appended after the last one.
router.post("/", requireAuth, (req: AuthRequest, res) => {
  const body = req.body as { name?: string };
  const { maxPos } = pageStmts.maxPosition.get(req.user!.userId)!;
  const position = (maxPos ?? -1) + 1;
  const row = pageStmts.create.get(req.user!.userId, cleanName(body.name), position)!;
  const page = pageStmts.findById.get(row.id, req.user!.userId)!;
  res.status(201).json(formatPage(page));
});

// GET /api/pages/export — export ALL of the user's pages as a downloadable
// envelope. Registered before /:id so the literal "export" path is not captured
// by the id param.
router.get("/export", requireAuth, (req: AuthRequest, res) => {
  const pages = pageStmts.findAllByUser.all(req.user!.userId);
  res.json(buildExport(pages));
});

// GET /api/pages/:id/export — export a single page as a downloadable envelope.
router.get("/:id/export", requireAuth, (req: AuthRequest, res) => {
  const id = parseInt(String(req.params["id"]));
  const page = pageStmts.findById.get(id, req.user!.userId);
  if (!page) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  res.json(buildExport([page]));
});

// POST /api/pages/import — recreate one or more pages from a previously
// exported envelope. Validates the format/version, then creates every page and
// its tiles inside a single transaction so a failure leaves nothing partial.
// Imported pages are appended after existing ones and given collision-free
// names. Registered before /:id so the literal "import" path is not captured by
// the id param.
router.post("/import", requireAuth, (req: AuthRequest, res) => {
  // Validate the entire payload against the generated schema first. This
  // rejects malformed files (wrong types, null/garbage page or tile entries,
  // missing required fields) with a clean 400 before anything is created, and
  // unknown/credential-like fields are dropped during parse.
  const parsed = ImportPagesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "This file is not a valid dashboard page export." });
    return;
  }
  const envelope = parsed.data;

  if (envelope.format !== EXPORT_FORMAT) {
    res.status(400).json({ error: "This file is not a valid dashboard page export." });
    return;
  }
  if (envelope.version !== EXPORT_VERSION) {
    res.status(400).json({
      error: `Unsupported export version: ${envelope.version}. This file was created by a different version.`,
    });
    return;
  }

  const taken = new Set(
    pageStmts.findAllByUser.all(req.user!.userId).map((p) => p.name),
  );
  const { maxPos } = pageStmts.maxPosition.get(req.user!.userId)!;

  const createdIds: number[] = [];
  const importAll = db.transaction(() => {
    let position = (maxPos ?? -1) + 1;
    for (const incoming of envelope.pages) {
      const name = uniquePageName(cleanName(incoming.name), taken);
      taken.add(name);
      const pageRow = pageStmts.create.get(req.user!.userId, name, position)!;
      position++;
      createdIds.push(pageRow.id);
      for (const tile of incoming.tiles) {
        createImportedTile(req.user!.userId, pageRow.id, tile);
      }
    }
  });
  importAll();

  const created = createdIds.map((id) => pageStmts.findById.get(id, req.user!.userId)!);
  res.status(201).json(created.map(formatPage));
});

// PUT /api/pages/reorder — persist a new page order. Body: { order: number[] }
// listing the page ids in the desired sequence. Only ids that belong to the
// user are repositioned; unknown ids are ignored. Registered before /:id so the
// literal "reorder" path is not captured by the id param.
router.put("/reorder", requireAuth, (req: AuthRequest, res) => {
  const body = req.body as { order?: unknown };
  if (!Array.isArray(body.order)) {
    res.status(400).json({ error: "order must be an array of page ids" });
    return;
  }
  const ids = body.order.filter((x): x is number => typeof x === "number");
  const owned = new Set(
    pageStmts.findAllByUser.all(req.user!.userId).map((p) => p.id),
  );

  const applyOrder = db.transaction(() => {
    let position = 0;
    for (const id of ids) {
      if (!owned.has(id)) continue;
      pageStmts.updatePosition.run(position, id, req.user!.userId);
      position++;
    }
  });
  applyOrder();

  const pages = pageStmts.findAllByUser.all(req.user!.userId);
  res.json(pages.map(formatPage));
});

// PUT /api/pages/:id — rename a page.
router.put("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = parseInt(String(req.params["id"]));
  const existing = pageStmts.findById.get(id, req.user!.userId);
  if (!existing) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  const body = req.body as { name?: string };
  if (body.name !== undefined) {
    pageStmts.rename.run(cleanName(body.name), id, req.user!.userId);
  }
  const page = pageStmts.findById.get(id, req.user!.userId)!;
  res.json(formatPage(page));
});

// DELETE /api/pages/:id — delete a page and (via ON DELETE CASCADE) its tiles.
// Refuses to delete the user's last remaining page.
router.delete("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = parseInt(String(req.params["id"]));
  const existing = pageStmts.findById.get(id, req.user!.userId);
  if (!existing) {
    res.status(404).json({ error: "Page not found" });
    return;
  }
  const { count } = pageStmts.countByUser.get(req.user!.userId)!;
  if (count <= 1) {
    res.status(400).json({ error: "Cannot delete your last page" });
    return;
  }
  pageStmts.delete.run(id, req.user!.userId);
  res.status(204).send();
});

export default router;
