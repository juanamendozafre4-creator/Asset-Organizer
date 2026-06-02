import { db, sitesTable } from "@workspace/db";
import { logger } from "./logger";
import { decrypt } from "./crypto";
import {
  fetchNetflixEmailsForSite,
  extractProfileName,
  extractDeviceInfo,
  extractCode,
  extractExpiry,
  decodeEmailBody,
  extractEmailParts,
  extractNetflixLink,
  fetchCodeFromNetflixLink,
  extractAccountEmail,
} from "./imap";
import { setCacheEntry, isCacheValid } from "./codesCache";

const SUBJECT_FILTERS = [
  "código de acceso temporal",
  "netflix temporary access code",
];

const POLL_INTERVAL_MS = 50_000;

type SiteRow = typeof sitesTable.$inferSelect;

async function buildCodesForSite(site: SiteRow) {
  const password = decrypt(site.imapPasswordEncrypted);
  const rawEmails = await fetchNetflixEmailsForSite(
    { host: site.imapHost, email: site.imapEmail, password },
    20
  );

  const filtered = rawEmails.filter((email) => {
    const subjectLow = email.subject.toLowerCase();
    return SUBJECT_FILTERS.some((f) => subjectLow.includes(f));
  });

  const codes = await Promise.all(
    filtered.map(async (email) => {
      const { html: rawHtml } = extractEmailParts(email.source);
      const body = decodeEmailBody(email.source);
      let code = extractCode(body, rawHtml || undefined);
      const netflixLink = extractNetflixLink(email.source);

      if (!code && netflixLink) {
        code = await fetchCodeFromNetflixLink(netflixLink);
      }

      return {
        id: email.uid,
        profileName: extractProfileName(body),
        deviceInfo: extractDeviceInfo(body, rawHtml || undefined),
        code,
        netflixLink: netflixLink ?? null,
        accountEmail: extractAccountEmail(body),
        receivedAt: email.receivedAt.toISOString(),
        expiresIn: extractExpiry(body),
      };
    })
  );

  return codes
    .sort(
      (a, b) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
    )
    .slice(0, 10);
}

async function pollAllSites() {
  let sites: SiteRow[];
  try {
    sites = await db.select().from(sitesTable);
  } catch (err) {
    logger.error({ err }, "Background poller: failed to fetch sites");
    return;
  }

  await Promise.allSettled(
    sites.map(async (site) => {
      if (isCacheValid(site.slug)) return;
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
