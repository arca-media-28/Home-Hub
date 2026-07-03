---
name: Google OAuth live verification
description: Gotchas verified while linking a real Gmail account end-to-end — per-viewer dev domains, probing Google for redirect_uri_mismatch without a user, safe disconnect testing.
---

# Google OAuth live verification

- **The Replit dev domain suffix differs per viewer.** The agent's `$REPLIT_DEV_DOMAIN` (e.g. `...-35qv6jc0.picard.replit.dev`) is NOT the domain the user's browser uses (e.g. `...-ynw9obzu.picard.replit.dev`). Both hit the same app, but Google matches redirect URIs exactly. **The redirect URI registered in Google Cloud Console must be copied from the USER's browser flow** (best source: "error details" on the redirect_uri_mismatch page), not from the agent's env var.
- **Redirect URI acceptance can be probed without a user**: mint an auth-intent, follow the app's 302 to `accounts.google.com/o/oauth2/v2/auth`, and grep the HTML for `redirect_uri_mismatch`. Zero matches = registered; lets you poll for Google Console propagation (a few minutes) instead of asking the user to retry blindly.
- **Token refresh is testable synthetically**: set `expiresAt` to the past in the `gmail`/`google_calendar` rows' `extra` accounts array, restart the api-server (clears the mail fetch cache), fetch the inbox — success + future `expiresAt` proves the live refresh path.
- **Disconnect is local-only (no Google-side revoke)**, so the token blobs can be backed up from `service_connections.extra`, the real disconnect endpoint exercised (verifies demo fallback `sample:true`), then the blobs restored — no user re-consent needed.
- **Why:** end-to-end OAuth verification stalls on user round-trips; these techniques cut them to a single consent click.
- **How to apply:** whenever verifying OAuth-ish flows (Google, Spotify), never hand the user a redirect URI derived from the agent-side env; confirm the browser-side origin first or instruct them to copy it from the provider's error details.
- **Guided failure flow:** gmail/callback redirects with `google_reason` (denied/expired/redirect/exchange/provider); Settings forwards it via postMessage; GoogleCard also polls popup.closed to catch the redirect_uri_mismatch dead end that never reaches the callback ("no-callback"). Spotify still uses the generic toast — mirror this pattern if it needs the same help.
