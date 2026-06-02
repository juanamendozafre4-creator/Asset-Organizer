import { db, sitesTable } from "@workspace/db";
import { logger } from "./logger";
import { setCacheEntry, getCacheEntry } from "./codesCache";
import { buildCodesForSite, buildCodesWithExistingClient } from "../routes/publicSites";
import { startIdleForSite, isIdleConnected } from "./imapIdleManager";
import { ImapFlow } from "imapflow";

/** How often the fallback poller runs (when IDLE is not connected or cache is empty) */
const POLL_INTERVAL_MS = 15_000;

/** Safety-net full refresh regardless of IDLE state (every 10 minutes) */
const SAFETY_REFRESH_MS = 10 * 60_000;

/** Max time allowed for a `buildCodesForSite` call (new-connection path) */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Dedup: only one fetch per site at a time.
 * Prevents multiple simultaneous IMAP connections for the same account.
 */
const inProgressFetches = new Set<string>();

async function fetchAndCache(site: typeof sitesTable.$inferSelect, reason: string) {
  if (inProgressFetches.has(site.slug)) {
    logger.debug({ slug: site.slug, reason }, "Poller: fetch in progress, skipping duplicate");
    return;
  }
  inProgressFetches.add(site.slug);
  try {
    const codes = await Promise.race([
      buildCodesForSite(site),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS}ms`)),
          FETCH_TIMEOUT_MS
        )
      ),
    ]);
    setCacheEntry(site.slug, codes);
    logger.info({ slug: site.slug, count: codes.length, reason }, "Poller: cache refreshed");
  } catch (err) {
    logger.warn({ err, slug: site.slug, reason }, "Poller: fetch failed");
  } finally {
    inProgressFetches.delete(site.slug);
  }
}

/**
 * Request a cache refresh for a site using a NEW IMAP connection.
 * Only called from the SSE handler as an emergency fallback when cache is cold
 * and IDLE is not yet connected.
 * Deduplicated — safe to call from multiple SSE clients simultaneously.
 */
export async function requestFetch(site: typeof sitesTable.$inferSelect): Promise<void> {
  await fetchAndCache(site, "on-demand");
}

/**
 * The callback passed to the IDLE loop.
 * Uses the existing IDLE client — no new IMAP connection opened.
 */
async function buildWithExistingClient(
  client: ImapFlow,
  site: typeof sitesTable.$inferSelect
): Promise<unknown[]> {
  return buildCodesWithExistingClient(client, site);
}

async function pollAllSites() {
  let sites: (typeof sitesTable.$inferSelect)[];
  try {
    sites = await db.select().from(sitesTable);
  } catch (err) {
    logger.error({ err }, "Poller: failed to fetch sites from DB");
    return;
  }

  await Promise.allSettled(
    sites.map(async (site) => {
      // Ensure IDLE is running; pass buildWithExistingClient so IDLE never opens a second connection
      startIdleForSite(site, buildWithExistingClient);

      const cacheEntry = getCacheEntry(site.slug);
      const cacheAgeMs = cacheEntry ? Date.now() - cacheEntry.fetchedAt : Infinity;

      if (!cacheEntry) {
        // Cache empty AND IDLE not yet connected → try a new connection as fallback
        if (!isIdleConnected(site.slug)) {
          await fetchAndCache(site, "cache-empty-idle-not-connected");
        }
        // If IDLE IS connected, it already fetched on connect — wait for the event
      } else if (!isIdleConnected(site.slug)) {
        // IDLE is reconnecting — poll to keep cache from going too stale
        await fetchAndCache(site, "idle-reconnecting");
      } else if (cacheAgeMs > SAFETY_REFRESH_MS) {
        // Safety net: force refresh every 10min even if IDLE is active
        await fetchAndCache(site, "safety-refresh");
      }
      // IDLE connected + cache fresh → nothing to do
    })
  );
}

export function startBackgroundPoller() {
  logger.info("Poller: starting");

  // First run: IDLE connects and fetches inline, no competing connection from poller
  pollAllSites().catch((err) =>
    logger.error({ err }, "Poller: first run failed")
  );

  setInterval(() => {
    pollAllSites().catch((err) =>
      logger.error({ err }, "Poller: interval run failed")
    );
  }, POLL_INTERVAL_MS);
}
