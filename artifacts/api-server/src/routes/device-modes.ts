import { Router } from "express";
import {
  db,
  deviceModeStmts,
  type DbDeviceMode,
} from "../lib/db.js";
import { requireAuth, type AuthRequest } from "../lib/auth.js";

const router = Router();

export function formatDeviceMode(m: DbDeviceMode) {
  return {
    id: m.id,
    userId: m.user_id,
    name: m.name,
    position: m.position,
    createdAt: m.created_at,
  };
}

function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 40);
}

// GET /api/device-modes — list the caller's device modes in position order.
router.get("/", requireAuth, (req: AuthRequest, res) => {
  const modes = deviceModeStmts.findAllByUser.all(req.user!.userId);
  res.json(modes.map(formatDeviceMode));
});

// POST /api/device-modes — create a new mode appended after the existing ones.
router.post("/", requireAuth, (req: AuthRequest, res) => {
  const name = cleanName((req.body as { name?: unknown })?.name);
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const maxPos = deviceModeStmts.maxPosition.get(req.user!.userId)?.maxPos ?? -1;
  const row = deviceModeStmts.create.get(req.user!.userId, name, maxPos + 1)!;
  const mode = deviceModeStmts.findById.get(row.id, req.user!.userId)!;
  res.status(201).json(formatDeviceMode(mode));
});

// PUT /api/device-modes/:id — rename a mode.
router.put("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = parseInt(String(req.params["id"]));
  const mode = Number.isNaN(id) ? undefined : deviceModeStmts.findById.get(id, req.user!.userId);
  if (!mode) {
    res.status(404).json({ error: "Device mode not found" });
    return;
  }
  const name = cleanName((req.body as { name?: unknown })?.name);
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  deviceModeStmts.rename.run(name, mode.id, req.user!.userId);
  res.json(formatDeviceMode(deviceModeStmts.findById.get(mode.id, req.user!.userId)!));
});

// DELETE /api/device-modes/:id — delete a mode and (via FK cascade) every tile
// that belongs to it, across all pages. The last remaining mode can never be
// deleted so tiles always have a mode to live in.
router.delete("/:id", requireAuth, (req: AuthRequest, res) => {
  const id = parseInt(String(req.params["id"]));
  const mode = Number.isNaN(id) ? undefined : deviceModeStmts.findById.get(id, req.user!.userId);
  if (!mode) {
    res.status(404).json({ error: "Device mode not found" });
    return;
  }
  const count = deviceModeStmts.countByUser.get(req.user!.userId)!.count;
  if (count <= 1) {
    res.status(400).json({ error: "Cannot delete the last device mode" });
    return;
  }
  const cascade = db.transaction(() => {
    // Explicit tile cleanup: the device_mode_id FK was added via ALTER TABLE,
    // and SQLite only enforces cascades when foreign_keys is on — delete
    // directly so behavior never depends on that pragma.
    db.prepare("DELETE FROM tiles WHERE user_id = ? AND device_mode_id = ?").run(
      req.user!.userId,
      mode.id,
    );
    deviceModeStmts.delete.run(mode.id, req.user!.userId);
  });
  cascade();
  res.json({ success: true });
});

export default router;
