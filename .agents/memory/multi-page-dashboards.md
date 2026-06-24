---
name: Multi-page dashboards
description: How pages (multiple dashboards per user) are modeled and scoped across tiles/layout.
---

Tiles belong to a `page`; each user has ≥1 page and one active page persisted in localStorage on the client.

- DB: `pages` table (id, user_id, name, position, created_at). `tiles` got a `page_id` column added via guarded PRAGMA check (tileColumns). Backfill on boot: create a default "Home" page per user and assign any NULL-page tiles to that page. New users get a default page at register time (auth.ts).
- Backend scoping is **fallback-safe**: tiles.ts GET `?pageId` filter and layout.ts pageId body are optional — when omitted they fall back to `findAllByUser`. This keeps older tests (tiles-layout.test.ts, which never sends pageId) green. Do not make pageId required on those routes.
- DELETE /pages/:id rejects the user's **last** page (guard) and cascades its tiles. reorderPages is `PUT /pages/reorder` and must be registered BEFORE `PUT /pages/:id` or Express matches "reorder" as an :id.
- POST tiles attaches to the supplied pageId, else the user's first page.

**Why:** keeps multi-page additive and backward-compatible; the active-page UX lives entirely client-side so the server stays stateless about "which page is open".

**How to apply:** any new tile-producing route (spacer/divider/import) must thread pageId through like createTile does; client mutations invalidate the `["/api/tiles", params]` key (prefix-match also catches page-scoped keys). Frontend page switcher tab bar + edit-mode CRUD lives in dashboard.tsx; create modal takes a `pageId` prop.
