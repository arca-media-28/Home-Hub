---
name: Google env vars break api-server tests
description: Pre-existing api-server test failures when GOOGLE_CLIENT_ID/SECRET are set in the environment
---
Some api-server tests assume Google OAuth is *unconfigured* (expect 400 "not configured" from `/widgets/gmail/auth`, and connections-accounts credential tests). When `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are present as env vars (as they are in this Replit workspace), those routes see env-configured credentials and the tests fail (302 instead of 400, etc.).

**Why:** the routes fall back to env credentials, so the test env is not hermetic.

**How to apply:** if `widgets.test.ts` gmail-auth intent tests or `connections-accounts.test.ts` Google credential tests fail with 302-vs-400 style mismatches, check for Google env vars before assuming your change broke them — these failures are pre-existing and environment-caused.
