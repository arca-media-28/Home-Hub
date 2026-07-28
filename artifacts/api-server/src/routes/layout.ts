import { Router } from "express";
import { db, tileStmts, pageStmts, deviceModeStmts } from "../lib/db.js";
import { requireAuth, type AuthRequest } from "../lib/auth.js";
import { formatTile, cleanVariant } from "./tiles.js";

const router = Router();

// PUT /api/tiles/layout — bulk-save layout positions. When a pageId is given,
// only that page's tiles are returned (the active page after a save); a
// deviceModeId (+ optional variant) narrows the response to that layout scope,
// matching what GET /tiles returns for the same query. Without any scope,
// every tile is returned for back-compat. The response always carries the full
// Tile shape so client caches never lose fields on a layout save.
router.put("/", requireAuth, (req: AuthRequest, res) => {
  const { tiles, pageId, deviceModeId, variant } = req.body as {
    tiles?: Array<{ id: number; gridX: number; gridY: number; gridW: number; gridH: number }>;
    pageId?: number | null;
    deviceModeId?: number | null;
    variant?: string | null;
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

  let scopedModeId: number | null = null;
  if (deviceModeId != null) {
    const mode = deviceModeStmts.findById.get(deviceModeId, req.user!.userId);
    if (!mode) {
      res.status(404).json({ error: "Device mode not found" });
      return;
    }
    scopedModeId = mode.id;
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
    scopedPageId != null && scopedModeId != null
      ? tileStmts.findAllByPageScope.all(
          req.user!.userId,
          scopedPageId,
          scopedModeId,
          cleanVariant(variant),
        )
      : scopedPageId != null
        ? tileStmts.findAllByPage.all(req.user!.userId, scopedPageId)
        : tileStmts.findAllByUser.all(req.user!.userId);
  res.json(updated.map(formatTile));
});

export default router;
