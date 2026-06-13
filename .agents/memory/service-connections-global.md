---
name: service_connections is global, not per-user
description: The service_connections table is keyed by service alone (no userId); rows are shared across all users.
---

The `service_connections` table is keyed by `service` alone — there is no `userId` column. `connectionStmts.findAll` selects every row, and `upsert` uses `ON CONFLICT(service)`.

**Why:** Connection settings are intentionally host-wide ("stored on the host and shared across all browsers pointing to this dashboard" — see Settings page copy). Any authenticated user reads/writes the same shared rows.

**How to apply:** A `PUT /connections/:service` overwrites the single global row for that service — never use it for throwaway test data against a live instance, it will clobber real settings. The reachability status endpoint (`GET /connections/status`) pings these shared rows, so status is the same for every user. A row with empty URL/credentials still counts as a row, so it reports `configured: true` with an `ok: false` validation message rather than being treated as absent.
