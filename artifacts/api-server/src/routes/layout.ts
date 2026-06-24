import { Router } from "express";
import { db, tileStmts, pageStmts } from "../lib/db.js";
import { requireAuth, type AuthRequest } from "../lib/auth.js";
import { formatTile } from "./tiles.js";

const router = Router();

// PUT /api/tiles/layout — bulk-save layout positions. When a pageId is given,
// only that page's tiles are returned (the active page after a save); without
// one, every tile is returned for back-compat.
router.put("/", requireAuth, (req: AuthRequest, res) => {
  const { tiles, pageId } = req.body as {
    tiles?: Array<{ id: number; gridX: number; gridY: number; gridW: number; gridH: number }>;
    pageId?: number | null;
  };

  if (!Array.isArray(tiles)) {
    res.status(400).json({ error: "tiles must be an array" });
    return;
  }

  let scopedPageId: number | null = null;
  if (pageId != null) {
    const page = pageStmts.findById.get(pageId, req.user!.userId);
    if (!page) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    scopedPageId = page.id;
  }

  const updateStmt = db.prepare(
    "UPDATE tiles SET grid_x = ?, grid_y = ?, grid_w = ?, grid_h = ? WHERE id = ? AND user_id = ?"
  );

  const updateAll = db.transaction(() => {
    for (const item of tiles) {
      updateStmt.run(item.gridX, item.gridY, item.gridW, item.gridH, item.id, req.user!.userId);
    }
  });

  updateAll();

  const updated =
    scopedPageId != null
      ? tileStmts.findAllByPage.all(req.user!.userId, scopedPageId)
      : tileStmts.findAllByUser.all(req.user!.userId);
  res.json(updated.map(formatTile));
});

export default router;
