---
name: jsdom / isomorphic-dompurify esbuild bundling
description: Why isomorphic-dompurify must be externalized in the api-server esbuild build
---
The api-server is bundled into a single ESM file by esbuild (build.mjs). `isomorphic-dompurify`
(used in routes/uploads.ts to sanitize HTML) depends on `jsdom`. jsdom reads asset files such as
`lib/jsdom/browser/default-stylesheet.css` at RUNTIME via `path.resolve(__dirname, "../../../browser/...")`.

**The bug:** once bundled, `__dirname` becomes the dist directory, so jsdom resolves the CSS to a
bogus path like `/home/runner/workspace/browser/default-stylesheet.css` and the server crashes on
startup with `ENOENT: no such file or directory` (eager require during module init, so it fails
immediately — every restart, not just some requests). Symptom to the user: login / all API calls
return HTTP 502 because the api-server process is dead.

**The fix:** add `"isomorphic-dompurify"` to the `external` array in
`artifacts/api-server/build.mjs`. This is the same pattern the file already documents for
path-traversal packages (e.g. @google-cloud/secret-manager loading sibling .proto files).

**Why externalize isomorphic-dompurify and NOT jsdom:** pnpm's strict node_modules only exposes
`jsdom` inside isomorphic-dompurify's own nested node_modules. A bare `require("jsdom")` from the
api-server dist context fails ("Cannot find module 'jsdom'"), but `require("isomorphic-dompurify")`
resolves fine (it's a direct dep) and it loads jsdom from its own nested tree internally.

**How to apply:** if you ever see the api-server crash with a jsdom/default-stylesheet.css ENOENT,
or add another dep that transitively bundles jsdom, keep isomorphic-dompurify externalized (verify
runtime resolution with createRequire against dist/index.mjs). Externalizing also shrank the bundle
from ~16mb to ~4mb.
