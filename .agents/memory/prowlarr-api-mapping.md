---
name: Prowlarr widget API mapping
description: How the Prowlarr dashboard tile derives indexer status, grabs, and health from the Prowlarr v1 API.
---

Prowlarr v1 API is auth'd with an `X-Api-Key` header (connection test: `GET /api/v1/system/status`).

Data sources (fetched in parallel):
- `GET /api/v1/indexer` — indexer rows expose `enable` (singular, NOT `enabled`) and `name`.
- `GET /api/v1/history?pageSize=100&eventType=1` — `eventType=1` is releaseGrabbed; rows under `records`, each with ISO `date`.
- `GET /api/v1/health` — array of `{source,type,message}`.

**Per-indexer "failing" rule:** Prowlarr has no clean per-indexer reachable flag on the indexer object. Derive failing by matching an enabled indexer's `name` against the concatenated health messages (Prowlarr reports unreachable indexers as "Indexers unavailable due to failures: <names>"). Disabled indexers (`enable=false`) are never failing.

**Why:** the health feed is what Prowlarr's own UI surfaces as warnings, so matching it keeps the tile consistent with what the user sees there.

`grabCount24h` = history records whose `date` is within the last 24h.
