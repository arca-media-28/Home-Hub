---
name: Express 5 bare "*" route crashes prod only
description: Why a bare app.get("*") SPA fallback boots fine in Replit dev but crash-loops the self-hosted Docker container
---

# Express 5 SPA catch-all must not use a bare "*"

Express 5 uses path-to-regexp 8, which throws at route-registration time on a bare
wildcard path: `PathError: Missing parameter name at index 1: *`. A SPA fallback
written as `app.get("*", ...)` crashes the process on startup.

**Why it hid for so long:** that fallback only registers when serving the built
frontend — i.e. `NODE_ENV=production` AND a frontend dist dir exists. In Replit dev
the frontend is served by the separate Vite workflow, so the api-server never takes
that branch and never crashes. The crash appears ONLY in the single-container
Docker production image (where Express serves the static build), as a restart loop
(`restart: unless-stopped`) with the app dying before it can serve any request.

**How to apply:** never use a bare `"*"` (or `"/*"`) path with Express 5. For an
SPA fallback, use a final middleware that filters manually instead of a wildcard
route: `app.use((req,res,next) => { if (req.method!=="GET"||req.path.startsWith("/api")) return next(); ...sendFile(index.html) })`.
Verify production-only startup paths by booting the built bundle with
`NODE_ENV=production FRONTEND_DIST=<dir-with-index.html>` — dev/`tsc` will not catch
a route-registration crash.
