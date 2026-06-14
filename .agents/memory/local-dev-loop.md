---
name: Local dev loop (Git + hot reload outside Replit)
description: How the self-hosted dashboard is run on a LAN box for real-service connections, and why the dev wiring is shaped the way it is.
---

# Local dev iteration loop

The dashboard is self-hosted: the API Server makes the real requests to homelab
services on LAN/Tailscale addresses Replit cloud cannot route to. So connections
can only be tested from a box *inside* the network. Workflow: edit on Replit →
push → `git pull` on a LAN box → run there.

## Key decisions

- **`/api` is bridged by a Vite dev-server proxy, gated on `REPL_ID`.**
  Frontend always uses relative `/api/...`. On Replit the platform router proxies
  `/api` to the API Server artifact, so the Vite proxy is **disabled when
  `REPL_ID` is set** to avoid double-proxying; it activates only on a local box.
  **Why:** keep URLs relative so the same build also works in the Docker
  single-container prod setup (Express serves app + `/api`). Never hardcode an
  absolute API base URL into the frontend.
  **How to apply:** proxy target defaults to `http://localhost:5000`, overridable
  via `VITE_API_PROXY_TARGET`. `server.proxy` is dev-only — it never affects
  `vite build`.

- **API Server hot reload = `build.mjs --watch`** (script `dev:watch`).
  Uses esbuild `context().watch()` + an onEnd plugin that respawns
  `node dist/index.mjs` after each successful rebuild. The normal one-shot `build`
  path is untouched. **Why:** the default `dev` script only builds-then-starts
  (no reload); local iteration needs restart-on-change.

- **`pnpm run dev:local`** (root) runs both via `concurrently`: API on
  `:5000` (`dev:watch`) + dashboard on `:3000`. Ports overridable with
  `API_PORT` / `WEB_PORT`.

## On Replit, the API Server workflow does NOT hot-reload
The workflow runs the `dev` script = `build && start` (one-shot esbuild, then
`node dist/index.mjs`). It does **not** watch. So after editing any
`artifacts/api-server/src/**` file, `dist/` is stale until you **restart the
`artifacts/api-server: API Server` workflow** — your change will silently not
take effect (e.g. an endpoint appears to ignore new logic) until then. Quick
check: `rg -c <new-symbol> artifacts/api-server/dist/index.mjs`. (`dev:watch` /
`dev:local` only run on a LAN box, not in the Replit workflow.)

## Verifying the proxy from this Replit env
`REPL_ID` is set here, so the proxy is gated off. To test it, run the services
with `REPL_ID` unset (`env -u REPL_ID ...`) from each artifact's own dir, then
curl `localhost:3000/api/healthz` (200) and `POST /api/auth/login` (400 JSON =
proof `/api` hit Express, not the SPA fallback). Run each service from its own
directory — launching vite from the repo root with `--config <path>` breaks.

Full guide lives in `DEVELOPMENT.md`.
