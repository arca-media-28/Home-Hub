import { Router } from "express";
import { db, tileStmts } from "../lib/db.js";
import { requireAuth, type AuthRequest } from "../lib/auth.js";
import { formatTile } from "./tiles.js";

const router = Router();

// PUT /api/tiles/layout — bulk-save layout positions
router.put("/", requireAuth, (req: AuthRequest, res) => {
  const { tiles } = req.body as {
    tiles?: Array<{ id: number; gridX: number; gridY: number; gridW: number; gridH: number }>;
  };

  if (!Array.isArray(tiles)) {
    res.status(400).json({ error: "tiles must be an array" });
    return;
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

  const updated = tileStmts.findAllByUser.all(req.user!.userId);
  res.json(updated.map(formatTile));
});

export default router;
