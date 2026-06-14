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

  CREATE TABLE IF NOT EXISTS service_connections (
    service TEXT PRIMARY KEY,
    url TEXT,
    api_key TEXT,
    username TEXT,
    password TEXT,
    extra TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS service_health (
    service TEXT PRIMARY KEY,
    ok INTEGER NOT NULL,
    message TEXT NOT NULL,
    checked_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Migrations ────────────────────────────────────────────────────────────────
// Every tile is now stored as an app/link with an optional `integration`.
// 1. Add the nullable `integration` column (guarded so it is idempotent —
//    SQLite has no "ADD COLUMN IF NOT EXISTS").
const tileColumns = db.prepare("PRAGMA table_info(tiles)").all() as { name: string }[];
if (!tileColumns.some((c) => c.name === "integration")) {
  db.exec("ALTER TABLE tiles ADD COLUMN integration TEXT");
}

// 1b. Per-tile metric selection. Stored as a JSON array of enabled metric keys.
//     NULL means "show all" so tiles created before this column behave as before.
if (!tileColumns.some((c) => c.name === "metrics")) {
  db.exec("ALTER TABLE tiles ADD COLUMN metrics TEXT");
}

// 1c. Flexible image placement. `image_position` is an anchor key (e.g.
//     "center", "top-left"); `image_scale` is a zoom percentage (100 = native).
//     Both NULL means "use the legacy image_fit behavior" so existing tiles
//     keep rendering exactly as before.
if (!tileColumns.some((c) => c.name === "image_position")) {
  db.exec("ALTER TABLE tiles ADD COLUMN image_position TEXT");
}
if (!tileColumns.some((c) => c.name === "image_scale")) {
  db.exec("ALTER TABLE tiles ADD COLUMN image_scale INTEGER");
}

// 1d. Tile title styling for plain app/link tiles. `title_size` is a size key
//     (e.g. "sm", "md", "lg", "xl"); `title_position` is an anchor key (e.g.
//     "center", "top-left"). Both NULL means "use the default" so existing
//     tiles keep rendering exactly as before. These do NOT affect integration
//     (widget) tiles, whose header layout is fixed.
if (!tileColumns.some((c) => c.name === "title_size")) {
  db.exec("ALTER TABLE tiles ADD COLUMN title_size TEXT");
}
if (!tileColumns.some((c) => c.name === "title_position")) {
  db.exec("ALTER TABLE tiles ADD COLUMN title_position TEXT");
}
// `title_color` is an optional CSS color for the title text. NULL means "use the
// default" (white over an image, theme color otherwise).
if (!tileColumns.some((c) => c.name === "title_color")) {
  db.exec("ALTER TABLE tiles ADD COLUMN title_color TEXT");
}

// 1e. Per-tile "hide title text" toggle. Stored as 0/1; defaults to 0 (title
//     shown) so existing tiles keep rendering their title. Applies to both
//     plain app/link tiles and integration (widget) tiles.
if (!tileColumns.some((c) => c.name === "hide_title")) {
  db.exec("ALTER TABLE tiles ADD COLUMN hide_title INTEGER NOT NULL DEFAULT 0");
}

// 2. One-time data migration: existing integration-typed tiles become app/link
//    tiles whose `integration` carries the old type. Styling fields are left
//    untouched. After this runs `type` is 'app' so it never matches again.
db.exec(`
  UPDATE tiles
  SET integration = type, type = 'app'
  WHERE type IN ('media', 'sonarr', 'radarr', 'qbittorrent', 'truenas')
    AND integration IS NULL
`);

// Instance-wide connection settings for the supported services. Seed an empty
// row for each on first run so the settings page always has something to render.
const SERVICE_CONNECTION_KEYS = ["truenas", "plex", "sonarr", "radarr", "qbittorrent"] as const;

const seedConnection = db.prepare(
  "INSERT OR IGNORE INTO service_connections (service) VALUES (?)"
);
for (const service of SERVICE_CONNECTION_KEYS) {
  seedConnection.run(service);
}

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
  integration: string | null;
  grid_x: number;
  grid_y: number;
  grid_w: number;
  grid_h: number;
  name: string | null;
  url: string | null;
  bg_color: string | null;
  image_url: string | null;
  image_fit: string | null;
  image_position: string | null;
  image_scale: number | null;
  title_size: string | null;
  title_position: string | null;
  title_color: string | null;
  hide_title: number;
  metrics: string | null;
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
  findById: db.prepare<[number, number], DbUploadedFile>(
    "SELECT * FROM uploaded_files WHERE id = ? AND user_id = ?"
  ),
  delete: db.prepare<[number, number], void>(
    "DELETE FROM uploaded_files WHERE id = ? AND user_id = ?"
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
    [number, string, string | null, number, number, number, number, string | null, string | null, string | null, string | null, string | null],
    { id: number }
  >(
    `INSERT INTO tiles (user_id, type, integration, grid_x, grid_y, grid_w, grid_h, name, url, bg_color, image_url, image_fit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ),
  delete: db.prepare<[number, number], void>(
    "DELETE FROM tiles WHERE id = ? AND user_id = ?"
  ),
};

export interface DbServiceConnection {
  service: string;
  url: string | null;
  api_key: string | null;
  username: string | null;
  password: string | null;
  extra: string | null;
  updated_at: string;
}

export const connectionStmts = {
  findAll: db.prepare<[], DbServiceConnection>(
    "SELECT * FROM service_connections ORDER BY service ASC"
  ),
  findByService: db.prepare<[string], DbServiceConnection>(
    "SELECT * FROM service_connections WHERE service = ?"
  ),
  upsert: db.prepare<
    [string, string | null, string | null, string | null, string | null, string | null],
    void
  >(
    `INSERT INTO service_connections (service, url, api_key, username, password, extra, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(service) DO UPDATE SET
       url = excluded.url,
       api_key = excluded.api_key,
       username = excluded.username,
       password = excluded.password,
       extra = excluded.extra,
       updated_at = datetime('now')`
  ),
};

export interface DbServiceHealth {
  service: string;
  ok: number;
  message: string;
  checked_at: string;
}

export const healthStmts = {
  findAll: db.prepare<[], DbServiceHealth>(
    "SELECT * FROM service_health ORDER BY service ASC"
  ),
  upsert: db.prepare<[string, number, string], void>(
    `INSERT INTO service_health (service, ok, message, checked_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(service) DO UPDATE SET
       ok = excluded.ok,
       message = excluded.message,
       checked_at = datetime('now')`
  ),
  delete: db.prepare<[string], void>(
    "DELETE FROM service_health WHERE service = ?"
  ),
};
