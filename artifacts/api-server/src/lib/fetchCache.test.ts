import { describe, it, expect, beforeEach } from "vitest";
import { cachedFetch, invalidateFetchCache, fetchCacheSize } from "./fetchCache.js";

describe("cachedFetch", () => {
  beforeEach(() => {
    invalidateFetchCache();
  });

  it("returns the cached result within the TTL without re-running the fetcher", async () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      return Promise.resolve(`result-${calls}`);
    };

    const first = await cachedFetch("k:a", fn);
    const second = await cachedFetch("k:a", fn);
    expect(first).toBe("result-1");
    expect(second).toBe("result-1");
    expect(calls).toBe(1);
  });

  it("dedupes concurrent requests into a single in-flight fetch", async () => {
    let calls = 0;
    let release!: (v: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const fn = () => {
      calls += 1;
      return gate;
    };

    const p1 = cachedFetch("k:concurrent", fn);
    const p2 = cachedFetch("k:concurrent", fn);
    release("shared");
    expect(await p1).toBe("shared");
    expect(await p2).toBe("shared");
    expect(calls).toBe(1);
  });

  it("uses separate cache slots for different keys", async () => {
    let calls = 0;
    const fn = () => Promise.resolve(++calls);
    expect(await cachedFetch("k:one", fn)).toBe(1);
    expect(await cachedFetch("k:two", fn)).toBe(2);
    expect(fetchCacheSize()).toBe(2);
  });

  it("does not cache failures", async () => {
    let calls = 0;
    const failing = () => {
      calls += 1;
      return Promise.reject(new Error("boom"));
    };
    await expect(cachedFetch("k:fail", failing)).rejects.toThrow("boom");
    // Eviction happens in a .catch attached to the promise; yield a tick.
    await new Promise((r) => setTimeout(r, 0));
    await expect(cachedFetch("k:fail", failing)).rejects.toThrow("boom");
    expect(calls).toBe(2);
  });

  it("re-fetches after the TTL expires", async () => {
    let calls = 0;
    const fn = () => Promise.resolve(++calls);
    expect(await cachedFetch("k:ttl", fn, 5)).toBe(1);
    await new Promise((r) => setTimeout(r, 15));
    expect(await cachedFetch("k:ttl", fn, 5)).toBe(2);
  });

  it("fresh:true bypasses a live cached entry and re-fetches", async () => {
    let calls = 0;
    const fn = () => Promise.resolve(++calls);
    expect(await cachedFetch("k:fresh", fn)).toBe(1);
    expect(await cachedFetch("k:fresh", fn)).toBe(1); // cached
    expect(await cachedFetch("k:fresh", fn, undefined, { fresh: true })).toBe(2);
    // The fresh result replaces the cached entry for later normal callers.
    expect(await cachedFetch("k:fresh", fn)).toBe(2);
  });

  it("fresh fetch is cached so concurrent callers dedupe onto it", async () => {
    let calls = 0;
    let release!: (v: string) => void;
    const gate = new Promise<string>((resolve) => {
      release = resolve;
    });
    const fn = () => {
      calls += 1;
      return calls === 1 ? Promise.resolve("stale") : gate;
    };

    expect(await cachedFetch("k:fresh-dedupe", fn)).toBe("stale");
    const freshP = cachedFetch("k:fresh-dedupe", fn, undefined, { fresh: true });
    const follower = cachedFetch("k:fresh-dedupe", fn); // arrives while fresh fetch is in flight
    release("fresh");
    expect(await freshP).toBe("fresh");
    expect(await follower).toBe("fresh");
    expect(calls).toBe(2);
  });

  it("invalidates by prefix", async () => {
    let calls = 0;
    const fn = () => Promise.resolve(++calls);
    await cachedFetch("mail:imap:a", fn);
    await cachedFetch("mail:gmail:b", fn);

    invalidateFetchCache("mail:imap:");
    expect(await cachedFetch("mail:imap:a", fn)).toBe(3); // re-fetched
    expect(await cachedFetch("mail:gmail:b", fn)).toBe(2); // still cached
  });

  it("invalidates everything when no prefix is given", async () => {
    let calls = 0;
    const fn = () => Promise.resolve(++calls);
    await cachedFetch("x:1", fn);
    await cachedFetch("y:2", fn);
    invalidateFetchCache();
    expect(fetchCacheSize()).toBe(0);
    expect(await cachedFetch("x:1", fn)).toBe(3);
  });
});
