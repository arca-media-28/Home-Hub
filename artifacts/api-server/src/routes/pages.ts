import { Router } from "express";
import { db, pageStmts, type DbPage } from "../lib/db.js";
import { requireAuth, type AuthRequest } from "../lib/auth.js";

const router = Router();

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
