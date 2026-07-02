// ── Short-lived upstream fetch cache ──────────────────────────────────────────
// Email/Calendar tiles poll their widgets endpoints on short intervals, and
// each refresh used to open a fresh IMAP connection (login + mailbox open) or
// re-hit the Google/CalDAV APIs per account. With several tiles that is slow
// and can trip provider connection caps (Gmail IMAP allows ~15 concurrent
// connections). This module caches the *promise* of each per-account fetch for
// a short TTL, which also dedupes concurrent requests: everyone who asks for
// the same key while a fetch is in flight shares that single upstream call.
//
// Failures are never cached — a rejected promise is evicted immediately so the
// next tile refresh retries the upstream instead of replaying the error.

const DEFAULT_TTL_MS = 90_000;

interface CacheEntry {
  expiresAt: number;
  promise: Promise<unknown>;
}

const cache = new Map<string, CacheEntry>();

export function cachedFetch<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.promise as Promise<T>;

  const promise = fn();
  cache.set(key, { expiresAt: now + ttlMs, promise });
  promise.catch(() => {
    // Only evict if this exact promise is still the cached one (a newer
    // fetch may have replaced it already).
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

// Drop every entry whose key starts with `prefix` (or everything when the
// prefix is omitted). Called when accounts are added/removed so stale data
// for a reconfigured provider never survives the change.
export function invalidateFetchCache(prefix?: string): void {
  if (prefix === undefined) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

// Test helper — number of live (non-expired) entries.
export function fetchCacheSize(): number {
  const now = Date.now();
  let n = 0;
  for (const entry of cache.values()) {
    if (entry.expiresAt > now) n += 1;
  }
  return n;
}
