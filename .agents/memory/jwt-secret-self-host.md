---
name: JWT secret handling for self-hosted SQLite app
description: Why the api-server auto-generates and persists a JWT secret instead of failing closed in production.
---

## Rule
In production, if no strong `JWT_SECRET` env var is provided (or it matches a known weak default), the server auto-generates a random secret and persists it to `${DATA_DIR}/jwt-secret` (mode 0600), reusing it on subsequent starts. An explicitly-provided strong `JWT_SECRET` always wins.

**Why:** This is a self-hosted homelab app (Docker, SQLite in a mounted `/data` volume). An earlier "fail closed" hardening (`process.exit(1)` on weak/missing secret) combined with the docker-compose default `JWT_SECRET=change-this-secret-in-production` caused a crash-loop — `docker compose up` would never start. Auto-generating a strong persistent secret eliminates both the crash AND the predictable-secret risk. Persisting it (vs regenerating per boot) keeps existing JWTs valid across restarts so users don't get logged out.

**How to apply:** Keep the docker-compose `JWT_SECRET` default EMPTY (`${JWT_SECRET:-}`), not a weak literal — a weak literal is rejected and triggers regeneration anyway. The `jwt-secret` file must live in the persistent data volume and be gitignored. Do not reintroduce a hard `exit(1)` for missing secrets in this self-host context.
