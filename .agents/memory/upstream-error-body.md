---
name: Surfacing real upstream rejection reasons
description: Why normalizeHttpError hides the cause and how to capture the actual upstream response body
---

# Capturing why an upstream homelab call was rejected

`normalizeHttpError` (lib/http.ts) collapses every failure to a short user-facing
string and **discards the HTTP response body** — so the upstream service's actual
rejection reason (e.g. TrueNAS `reporting/get_data` 422 explaining the bad
`reporting_query`) is invisible. Three prior TrueNAS reporting fixes failed
because they guessed at the request shape blind.

**Use `describeHttpError(err)`** when you need the real reason: it returns
`{ status, code, message, body }`, preserving the response body. Never put request
headers/credentials into anything you log or return.

For TrueNAS specifically there is an auth-gated diagnostic route
`GET /widgets/truenas/diagnostics` that, against the real NAS, probes several
`reporting/get_data` request forms (unix-window-in-past, end-at-now, unit/page,
aggregated vs not) plus `GET /reporting/graphs`, and returns each request + raw
outcome so the working form / real error is copyable. The API key is never echoed.
This route is now runnable WITHOUT a shell: Settings → TrueNAS card → "Diagnostics"
button calls the generated `getTruenasDiagnostics()` and renders the JSON in a
copyable block (only the LAN-deployed instance can reach the NAS, so the user must
run it there). The endpoint is in openapi.yaml as a permissive object response.

**Why:** the correct fix to a rejected query/parser cannot be chosen without the
server's own error text or the live response shape; capture it first, then fix.

**Test gotcha:** `widgets.test.ts` mocks `../lib/http.js` wholesale, so any newly
exported helper (like `describeHttpError`) MUST be added to that `vi.mock` factory
or the route throws `undefined is not a function` → 500 in tests.
