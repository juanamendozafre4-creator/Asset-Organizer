import { EventEmitter } from "events";

interface CacheEntry {
  codes: unknown[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

export const codeEvents = new EventEmitter();
codeEvents.setMaxListeners(0);

const CACHE_TTL_MS = 35_000;

export function getCacheEntry(slug: string): CacheEntry | undefined {
  return cache.get(slug);
}

export function isCacheValid(slug: string): boolean {
  const entry = cache.get(slug);
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

export function setCacheEntry(slug: string, codes: unknown[]) {
  cache.set(slug, { codes, fetchedAt: Date.now() });
  codeEvents.emit(`update:${slug}`, codes);
}
