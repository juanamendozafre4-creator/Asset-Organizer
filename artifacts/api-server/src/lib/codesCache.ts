interface CacheEntry {
  codes: unknown[];
  fetchedAt: number;
  fetchingPromise: Promise<unknown[]> | null;
}

const cache = new Map<string, CacheEntry>();

const CACHE_TTL_MS = 55_000;

export function getCacheEntry(slug: string): CacheEntry | undefined {
  return cache.get(slug);
}

export function isCacheValid(slug: string): boolean {
  const entry = cache.get(slug);
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

export function setCacheEntry(slug: string, codes: unknown[]) {
  const existing = cache.get(slug);
  cache.set(slug, {
    codes,
    fetchedAt: Date.now(),
    fetchingPromise: existing?.fetchingPromise ?? null,
  });
}

export function setFetchingPromise(slug: string, promise: Promise<unknown[]> | null) {
  const existing = cache.get(slug);
  if (existing) {
    existing.fetchingPromise = promise;
  } else {
    cache.set(slug, { codes: [], fetchedAt: 0, fetchingPromise: promise });
  }
}

export function clearFetchingPromise(slug: string) {
  const existing = cache.get(slug);
  if (existing) existing.fetchingPromise = null;
}
