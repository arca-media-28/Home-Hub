import { Router } from "express";
import { db, tileStmts, type DbTile } from "../lib/db.js";
import { requireAuth, type AuthRequest } from "../lib/auth.js";

const router = Router();

function formatTile(t: DbTile) {
  return {
    id: t.id,
    userId: t.user_id,
    type: t.type,
    integration: t.integration,
    gridX: t.grid_x,
    gridY: t.grid_y,
    gridW: t.grid_w,
    gridH: t.grid_h,
    name: t.name,
    url: t.url,
    bgColor: t.bg_color,
    imageUrl: t.image_url,
    imageFit: t.image_fit,
    createdAt: t.created_at,
  };
}

// GET /api/tiles
router.get("/", requireAuth, (req: AuthRequest, res) => {
  const tiles = tileStmts.findAllByUser.all(req.user!.userId);
  res.json(tiles.map(formatTile));
});

// POST /api/tiles
router.post("/", requireAuth, (req: AuthRequest, res) => {
  const body = req.body as {
    type?: string;
    integration?: string | null;
    gridX?: number;
    gridY?: number;
    gridW?: number;
    gridH?: number;
    name?: string;
    url?: string;
    bgColor?: string;
    imageUrl?: string;
    imageFit?: string;
  };

  const createTile = db.prepare<
    [number, string, string | null, number, number, number, number, string | null, string | null, string | null, string | null, string | null],
    { id: number }
  >(
    `INSERT INTO tiles (user_id, type, integration, grid_x, grid_y, grid_w, grid_h, name, url, bg_color, image_url, image_fit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  );

  const row = createTile.get(
    req.user!.userId,
    body.type ?? "app",
    body.integration ?? null,
    body.gridX ?? 0,
    body.gridY ?? 0,
    body.gridW ?? 2,
    body.gridH ?? 2,
    body.name ?? null,
    body.url ?? null,
    body.bgColor ?? null,
    body.imageUrl ?? null,
    body.imageFit ?? null
  )!;

  const tile = db.prepare<[number], DbTile>("SELECT * FROM tiles WHERE id = ?").get(row.id)!;
  res.status(201).json(formatTile(tile));
});

// GET /api/tiles/:id
router.get("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = parseInt(String(req.params["id"]));
  const tile = tileStmts.findById.get(id, req.user!.userId);
  if (!tile) {
    res.status(404).json({ error: "Tile not found" });
    return;
  }
  res.json(formatTile(tile));
});

// PUT /api/tiles/:id
router.put("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = parseInt(String(req.params["id"]));
  const existing = tileStmts.findById.get(id, req.user!.userId);
  if (!existing) {
    res.status(404).json({ error: "Tile not found" });
    return;
  }

  const body = req.body as {
    integration?: string | null;
    gridX?: number;
    gridY?: number;
    gridW?: number;
    gridH?: number;
    name?: string;
    url?: string;
    bgColor?: string;
    imageUrl?: string;
    imageFit?: string;
  };

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (body.integration !== undefined) { updates.push("integration = ?"); params.push(body.integration); }
  if (body.gridX !== undefined) { updates.push("grid_x = ?"); params.push(body.gridX); }
  if (body.gridY !== undefined) { updates.push("grid_y = ?"); params.push(body.gridY); }
  if (body.gridW !== undefined) { updates.push("grid_w = ?"); params.push(body.gridW); }
  if (body.gridH !== undefined) { updates.push("grid_h = ?"); params.push(body.gridH); }
  if (body.name !== undefined) { updates.push("name = ?"); params.push(body.name); }
  if (body.url !== undefined) { updates.push("url = ?"); params.push(body.url); }
  if (body.bgColor !== undefined) { updates.push("bg_color = ?"); params.push(body.bgColor); }
  if (body.imageUrl !== undefined) { updates.push("image_url = ?"); params.push(body.imageUrl); }
  if (body.imageFit !== undefined) { updates.push("image_fit = ?"); params.push(body.imageFit); }

  if (updates.length > 0) {
    params.push(id);
    db.prepare(`UPDATE tiles SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  }

  const updated = db.prepare<[number], DbTile>("SELECT * FROM tiles WHERE id = ?").get(id)!;
  res.json(formatTile(updated));
});

// DELETE /api/tiles/:id
router.delete("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = parseInt(String(req.params["id"]));
  const existing = tileStmts.findById.get(id, req.user!.userId);
  if (!existing) {
    res.status(404).json({ error: "Tile not found" });
    return;
  }
  tileStmts.delete.run(id, req.user!.userId);
  res.status(204).send();
});

export default router;
