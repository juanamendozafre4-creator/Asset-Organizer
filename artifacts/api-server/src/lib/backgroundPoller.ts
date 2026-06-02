import { db, sitesTable } from "@workspace/db";
import { logger } from "./logger";
import { setCacheEntry, getCacheEntry } from "./codesCache";
import { buildCodesForSite } from "../routes/publicSites";
import { startIdleForSite, isIdleConnected } from "./imapIdleManager";

/** How often the fallback poller runs (for sites where IDLE is not yet connected) */
const POLL_INTERVAL_MS = 15_000;

/** Safety-net full refresh regardless of IDLE state (every 10 minutes) */
const SAFETY_REFRESH_MS = 10 * 60_000;

async function fetchAndCache(site: typeof sitesTable.$inferSelect, reason: string) {
  try {
    const codes = await buildCodesForSite(site);
    setCacheEntry(site.slug, codes);
    logger.info({ slug: site.slug, count: codes.length, reason }, "Poller: cache refreshed");
  } catch (err) {
    logger.warn({ err, slug: site.slug, reason }, "Poller: failed to fetch codes");
  }
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
        // IDLE is connected and cache is fresh — nothing to do
        logger.debug({ slug: site.slug }, "Poller: IDLE active, skipping IMAP fetch");
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
