import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, userStmts, type DbUser } from "../lib/db.js";
import { signToken, requireAuth, type AuthRequest } from "../lib/auth.js";

const router = Router();

function formatUser(user: DbUser) {
  return { id: user.id, username: user.username };
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }
    if (username.length < 3) {
      res.status(400).json({ error: "Username must be at least 3 characters" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    const existing = userStmts.findByUsername.get(username);
    if (existing) {
      res.status(400).json({ error: "Username already taken" });
      return;
    }

    const hashed = await bcrypt.hash(password, 12);
    const createUser = db.prepare<[string, string], { id: number }>(
      "INSERT INTO users (username, password) VALUES (?, ?) RETURNING id"
    );
    const row = createUser.get(username, hashed)!;
    const user = userStmts.findById.get(row.id)!;
    const token = signToken({ userId: user.id, username: user.username });
    res.status(201).json({ token, user: formatUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }

    const user = userStmts.findByUsername.get(username);
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = signToken({ userId: user.id, username: user.username });
    res.json({ token, user: formatUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, (req: AuthRequest, res) => {
  res.json({ id: req.user!.userId, username: req.user!.username });
});

export default router;
