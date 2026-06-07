---
name: SQLite data directory defaults
description: Where better-sqlite3 stores the DB file in dev vs Docker
---

# SQLite Data Directory

## The Rule
Default DATA_DIR to `./data` (relative) in development, not `/data` (absolute).
`/data` only exists in Docker (created by the Dockerfile / docker-compose volume mount).

## Why
The API server startup calls `fs.mkdirSync(dataDir, { recursive: true })`.
In dev on Replit, `/data` cannot be created (ENOENT) but `./data` can.

## How to Apply
In every file that reads DATA_DIR:
```ts
const dataDir = process.env["DATA_DIR"] || "./data";
```
Files: `artifacts/api-server/src/lib/db.ts`, `src/app.ts`, `src/routes/uploads.ts`

In Docker/production, set `DATA_DIR=/data` via environment variable (already done in docker-compose.yml).
