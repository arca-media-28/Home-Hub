import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const dataDir = process.env["DATA_DIR"] || "./data";

// Ensure data and uploads directories exist
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });

const dbPath = path.join(dataDir, "db.sqlite");

export const db = new Database(dbPath);

// Enable WAL mode for better concurrent performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'app',
    grid_x INTEGER NOT NULL DEFAULT 0,
    grid_y INTEGER NOT NULL DEFAULT 0,
    grid_w INTEGER NOT NULL DEFAULT 2,
    grid_h INTEGER NOT NULL DEFAULT 2,
    name TEXT,
    url TEXT,
    bg_color TEXT,
    image_url TEXT,
    image_fit TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS uploaded_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mimetype TEXT NOT NULL,
    size INTEGER NOT NULL,
    url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Helper types ──────────────────────────────────────────────────────────────

export interface DbUser {
  id: number;
  username: string;
  password: string;
  created_at: string;
}

export interface DbTile {
  id: number;
  user_id: number;
  type: string;
  grid_x: number;
  grid_y: number;
  grid_w: number;
  grid_h: number;
  name: string | null;
  url: string | null;
  bg_color: string | null;
  image_url: string | null;
  image_fit: string | null;
  created_at: string;
}

// ── Prepared statements ───────────────────────────────────────────────────────

export const userStmts = {
  findByUsername: db.prepare<[string], DbUser>("SELECT * FROM users WHERE username = ?"),
  findById: db.prepare<[number], DbUser>("SELECT * FROM users WHERE id = ?"),
  create: db.prepare<[string, string], { id: number }>(
    "INSERT INTO users (username, password) VALUES (?, ?) RETURNING id"
  ),
};

export interface DbUploadedFile {
  id: number;
  user_id: number;
  filename: string;
  original_name: string;
  mimetype: string;
  size: number;
  url: string;
  created_at: string;
}

export const uploadStmts = {
  create: db.prepare<[number, string, string, string, number, string], { id: number }>(
    `INSERT INTO uploaded_files (user_id, filename, original_name, mimetype, size, url)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
  ),
  findAllByUser: db.prepare<[number], DbUploadedFile>(
    "SELECT * FROM uploaded_files WHERE user_id = ? ORDER BY created_at DESC"
  ),
};

export const tileStmts = {
  findAllByUser: db.prepare<[number], DbTile>(
    "SELECT * FROM tiles WHERE user_id = ? ORDER BY created_at ASC"
  ),
  findById: db.prepare<[number, number], DbTile>(
    "SELECT * FROM tiles WHERE id = ? AND user_id = ?"
  ),
  create: db.prepare<
    [number, string, number, number, number, number, string | null, string | null, string | null, string | null, string | null],
    { id: number }
  >(
    `INSERT INTO tiles (user_id, type, grid_x, grid_y, grid_w, grid_h, name, url, bg_color, image_url, image_fit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ),
  delete: db.prepare<[number, number], void>(
    "DELETE FROM tiles WHERE id = ? AND user_id = ?"
  ),
};
