import { db, sitesTable } from "@workspace/db";
import { logger } from "./logger";
import { setCacheEntry } from "./codesCache";
import { buildCodesForSite } from "../routes/publicSites";
import { startIdleForSite, getActiveIdleSlugs } from "./imapIdleManager";

const POLL_INTERVAL_MS = 10_000;

async function pollAllSites() {
  let sites: (typeof sitesTable.$inferSelect)[];
  try {
    sites = await db.select().from(sitesTable);
  } catch (err) {
    logger.error({ err }, "Background poller: failed to fetch sites");
    return;
  }

  const activeSlugs = new Set(getActiveIdleSlugs());

  for (const site of sites) {
    if (!activeSlugs.has(site.slug)) {
      startIdleForSite(site, buildCodesForSite as (s: typeof site) => Promise<unknown[]>);
    }
  }

  await Promise.allSettled(
    sites.map(async (site) => {
      try {
        const codes = await buildCodesForSite(site);
        setCacheEntry(site.slug, codes);
        logger.info(
          { slug: site.slug, count: codes.length },
          "Background poller: cache refreshed"
        );
      } catch (err) {
        logger.warn(
          { err, slug: site.slug },
          "Background poller: failed to fetch codes for site"
        );
      }
    })
  );
}

export function startBackgroundPoller() {
  logger.info("Background poller: starting initial cache warm-up");
  pollAllSites().catch((err) =>
    logger.error({ err }, "Background poller: initial poll failed")
  );
  setInterval(() => {
    pollAllSites().catch((err) =>
      logger.error({ err }, "Background poller: interval poll failed")
    );
  }, POLL_INTERVAL_MS);
}
