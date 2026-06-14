import { Router } from "express";
import { db, tileStmts, type DbTile } from "../lib/db.js";
import { requireAuth, type AuthRequest } from "../lib/auth.js";

const router = Router();

// Parse the stored metrics JSON blob into a string[] (or null = "show all").
// Tolerates legacy/garbage values by falling back to null.
function parseMetrics(raw: string | null): string[] | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    return null;
  } catch {
    return null;
  }
}

// Serialize an incoming metrics value to a JSON blob (or null). Anything that
// isn't an array of strings is stored as null ("show all").
function serializeMetrics(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const keys = value.filter((x): x is string => typeof x === "string");
  return JSON.stringify(keys);
}

export function formatTile(t: DbTile) {
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
    imagePosition: t.image_position,
    imageScale: t.image_scale,
    titleSize: t.title_size,
    titlePosition: t.title_position,
    titleColor: t.title_color,
    hideTitle: Boolean(t.hide_title),
    metrics: parseMetrics(t.metrics),
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
    imagePosition?: string;
    imageScale?: number;
    titleSize?: string;
    titlePosition?: string;
    titleColor?: string;
    hideTitle?: boolean;
    metrics?: string[] | null;
  };

  const createTile = db.prepare<
    [number, string, string | null, number, number, number, number, string | null, string | null, string | null, string | null, string | null, string | null, number | null, string | null, string | null, string | null, number, string | null],
    { id: number }
  >(
    `INSERT INTO tiles (user_id, type, integration, grid_x, grid_y, grid_w, grid_h, name, url, bg_color, image_url, image_fit, image_position, image_scale, title_size, title_position, title_color, hide_title, metrics)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
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
    body.imageFit ?? null,
    body.imagePosition ?? null,
    body.imageScale ?? null,
    body.titleSize ?? null,
    body.titlePosition ?? null,
    body.titleColor ?? null,
    body.hideTitle ? 1 : 0,
    body.metrics === undefined ? null : serializeMetrics(body.metrics)
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
    imagePosition?: string | null;
    imageScale?: number | null;
    titleSize?: string | null;
    titlePosition?: string | null;
    titleColor?: string | null;
    hideTitle?: boolean;
    metrics?: string[] | null;
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
  if (body.imagePosition !== undefined) { updates.push("image_position = ?"); params.push(body.imagePosition); }
  if (body.imageScale !== undefined) { updates.push("image_scale = ?"); params.push(body.imageScale); }
  if (body.titleSize !== undefined) { updates.push("title_size = ?"); params.push(body.titleSize); }
  if (body.titlePosition !== undefined) { updates.push("title_position = ?"); params.push(body.titlePosition); }
  if (body.titleColor !== undefined) { updates.push("title_color = ?"); params.push(body.titleColor); }
  if (body.hideTitle !== undefined) { updates.push("hide_title = ?"); params.push(body.hideTitle ? 1 : 0); }
  if (body.metrics !== undefined) { updates.push("metrics = ?"); params.push(body.metrics === null ? null : serializeMetrics(body.metrics)); }

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
