---
name: Mail/Calendar upstream fetch cache
description: Shared short-TTL promise cache with in-flight dedupe for widget upstream fetches; invalidation rules on account changes.
---

Email/Calendar per-account upstream fetches go through `cachedFetch` in api-server `lib/fetchCache.ts` (90s TTL default; caches the *promise*, so concurrent tile polls share one upstream call; rejected promises evicted immediately — failures are never cached).

**Why:** Every tile refresh used to open a fresh IMAP login + mailbox open and re-hit Google/CalDAV per account; multiple tiles or short refresh intervals were slow and risked Gmail's ~15-connection IMAP cap.

**How to apply:**
- Key convention: `mail:gmail|imap|gcal|caldav:<accountId>:<params>`. New cached fetchers should pick a stable prefix so `invalidateFetchCache(prefix)` can target them.
- Invalidation must be wired at every account-mutation point: `mailAccounts.writeAccounts()` (imap/caldav add/remove) and `google.ts` upsert/remove/clearGoogleTokens (link/unlink). Token *refresh* (`updateGoogleAccount`) deliberately does not invalidate — it happens mid-fetch and would kill dedupe.
- If other widgets adopt this cache, also invalidate on the generic connections PUT and keep TTLs short for near-real-time data (now-playing etc.).
- Caching lives in the lib fetchers, not the route collectors — so all endpoint variants (`/email/inbox`, `/email/gmail`, per-provider calendar routes) benefit automatically.
- Manual refresh bypass: `?fresh=true` on email/calendar widget routes threads a `fresh` flag into `cachedFetch(key, fn, ttl, { fresh })`, which skips a live hit but still stores the new promise (later concurrent callers dedupe onto the fresh fetch). Tiles call the plain generated fetcher with `fresh: "true"` and seed the result via `queryClient.setQueryData` — do NOT put `fresh` in the React Query key or background polling would bypass the cache too.
