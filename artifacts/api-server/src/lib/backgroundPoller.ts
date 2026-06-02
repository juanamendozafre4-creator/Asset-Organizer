import { db, sitesTable } from "@workspace/db";
import { logger } from "./logger";
import { setCacheEntry, getCacheEntry } from "./codesCache";
import { buildCodesForSite } from "../routes/publicSites";
import { startIdleForSite, isIdleConnected } from "./imapIdleManager";

/** How often the fallback poller runs (for sites where IDLE is not yet connected) */
const POLL_INTERVAL_MS = 15_000;

/** Safety-net full refresh regardless of IDLE state (every 10 minutes) */
const SAFETY_REFRESH_MS = 10 * 60_000;

/** Dedup: tracks slugs with an in-progress IMAP fetch */
const inProgressFetches = new Set<string>();

async function fetchAndCache(site: typeof sitesTable.$inferSelect, reason: string) {
  if (inProgressFetches.has(site.slug)) {
    logger.debug({ slug: site.slug, reason }, "Poller: fetch already in progress, skipping");
    return;
  }
  inProgressFetches.add(site.slug);
  try {
    const codes = await buildCodesForSite(site);
    setCacheEntry(site.slug, codes);
    logger.info({ slug: site.slug, count: codes.length, reason }, "Poller: cache refreshed");
  } catch (err) {
    logger.warn({ err, slug: site.slug, reason }, "Poller: failed to fetch codes");
  } finally {
    inProgressFetches.delete(site.slug);
  }
}

/**
 * Request a one-off cache refresh for a specific site.
 * Safe to call from the SSE handler — deduplication prevents two concurrent
 * IMAP connections for the same site.
 */
export async function requestFetch(site: typeof sitesTable.$inferSelect): Promise<void> {
  await fetchAndCache(site, "on-demand");
}

async function pollAllSites(isInitial = false) {
  let sites: (typeof sitesTable.$inferSelect)[];
  try {
    sites = await db.select().from(sitesTable);
  } catch (err) {
    logger.error({ err }, "Poller: failed to fetch sites from DB");
    return;
  }

  await Promise.allSettled(
    sites.map(async (site) => {
      // Always ensure IDLE is started (idempotent)
      startIdleForSite(site, buildCodesForSite as (s: typeof site) => Promise<unknown[]>);

      const cacheEntry = getCacheEntry(site.slug);
      const cacheAgeMs = cacheEntry ? Date.now() - cacheEntry.fetchedAt : Infinity;

      if (isInitial) {
        // On startup: always warm the cache immediately (IDLE may take 30-60s to connect)
        await fetchAndCache(site, "initial-warmup");
      } else if (!isIdleConnected(site.slug)) {
        // IDLE not yet connected or reconnecting — poll as fallback
        await fetchAndCache(site, "idle-not-connected");
      } else if (cacheAgeMs > SAFETY_REFRESH_MS) {
        // Safety net: force refresh every 10min even if IDLE is active
        await fetchAndCache(site, "safety-refresh");
      } else {
        logger.debug({ slug: site.slug }, "Poller: IDLE active and cache fresh, skipping");
      }
    })
  );
}

export function startBackgroundPoller() {
  logger.info("Poller: starting — warming cache for all sites");

  // Initial warmup (runs immediately, before IDLE connects)
  pollAllSites(true).catch((err) =>
    logger.error({ err }, "Poller: initial warmup failed")
  );

  // Recurring interval — skips fetch when IDLE is healthy
  setInterval(() => {
    pollAllSites(false).catch((err) =>
      logger.error({ err }, "Poller: interval run failed")
    );
  }, POLL_INTERVAL_MS);
}
