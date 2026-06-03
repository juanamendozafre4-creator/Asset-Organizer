import { Router, type IRouter, type Request, type Response } from "express";
import { db, sitesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/crypto";
import { ImapFlow } from "imapflow";
import {
  type RawEmail,
  fetchNetflixEmailsForSite,
  fetchEmailsFromLockedInbox,
  extractProfileName,
  extractDeviceInfo,
  extractCode,
  extractCodeFromSubject,
  extractExpiry,
  decodeEmailBody,
  extractEmailParts,
  extractNetflixLink,
  fetchCodeFromNetflixLink,
  extractAccountEmail,
} from "../lib/imap";
import {
  GetSiteInfoParams,
  ListSiteCodesParams,
  ListSiteCodesResponse,
} from "@workspace/api-zod";
import {
  getCacheEntry,
  setCacheEntry,
  codeEvents,
} from "../lib/codesCache";
import { requestFetch } from "../lib/backgroundPoller";

const router: IRouter = Router();

type SiteRow = typeof sitesTable.$inferSelect;

const SUBJECT_FILTERS = [
  "código de acceso temporal",
  "netflix temporary access code",
];

const CODE_TTL_MS = 15 * 60 * 1000;

async function processRawEmails(site: SiteRow, rawEmails: RawEmail[]) {
  const filtered = rawEmails.filter((email) => {
    const subjectLow = email.subject.toLowerCase();
    return SUBJECT_FILTERS.some((f) => subjectLow.includes(f));
  });

  const now = Date.now();

  const codes = await Promise.all(
    filtered.map(async (email) => {
      const { html: rawHtml } = extractEmailParts(email.source);
      const body = decodeEmailBody(email.source);
      let code = extractCode(body, rawHtml || undefined);

      if (!code) {
        code = extractCodeFromSubject(email.subject);
        if (code) {
          logger.info({ slug: site.slug, code }, "Code extracted from subject line");
        }
      }

      const emailAgeMs = now - new Date(email.receivedAt).getTime();
      const isAlreadyExpired = emailAgeMs > CODE_TTL_MS;

      const netflixLink = extractNetflixLink(email.source);
      if (!code && netflixLink) {
        if (isAlreadyExpired) {
          code = "EXPIRED";
        } else {
          code = await fetchCodeFromNetflixLink(netflixLink);
        }
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
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
    .slice(0, 10);
}

/** Full fetch: opens its own IMAP connection. Use as fallback when IDLE is not connected. */
export async function buildCodesForSite(site: SiteRow) {
  const password = decrypt(site.imapPasswordEncrypted);
  const rawEmails = await fetchNetflixEmailsForSite(
    { host: site.imapHost, email: site.imapEmail, password },
    10
  );
  return processRawEmails(site, rawEmails);
}

/**
 * Fetch + process using an already-connected ImapFlow client (INBOX already locked).
 * Zero new IMAP connections — used by the IDLE loop to avoid rate-limiting.
 */
export async function buildCodesWithExistingClient(
  client: ImapFlow,
  site: SiteRow,
  { limit = 10 }: { limit?: number } = {}
) {
  const rawEmails = await fetchEmailsFromLockedInbox(client, limit);
  return processRawEmails(site, rawEmails);
}

function codesFingerprint(codes: { id: number | string; receivedAt: string }[]): string {
  return codes.map((c) => `${c.id}:${c.receivedAt}`).join("|");
}

router.get("/sites/:slug", async (req, res): Promise<void> => {
  const params = GetSiteInfoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [site] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.slug, params.data.slug));

  if (!site) {
    res.status(404).json({ error: "Ruta no encontrada" });
    return;
  }

  res.json({
    name: site.name,
    logoUrl: site.logoUrl ?? null,
    description: site.description ?? null,
    themeColor: site.themeColor,
    slug: site.slug,
    welcomeMessage: site.welcomeMessage ?? null,
    newCodeMessage: site.newCodeMessage ?? null,
    repeatInterval: site.repeatInterval ?? null,
    voiceWelcomeEnabled: site.voiceWelcomeEnabled ?? true,
    voiceNewCodeEnabled: site.voiceNewCodeEnabled ?? true,
  });

  // Pre-warm cache when site info is requested (no-op if already fresh or in-progress)
  requestFetch(site).catch(() => {});
});

router.get("/sites/:slug/codes", async (req, res): Promise<void> => {
  const params = ListSiteCodesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [site] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.slug, params.data.slug));

  if (!site) {
    res.status(404).json({ error: "Ruta no encontrada" });
    return;
  }

  try {
    const sorted = await buildCodesForSite(site);
    req.log.info({ slug: site.slug, count: sorted.length }, "Fetched codes for site");
    res.json(ListSiteCodesResponse.parse(sorted));
  } catch (err) {
    req.log.error({ err, slug: site.slug }, "IMAP error");
    res.status(503).json({ error: "Error al conectar con el servidor de correo" });
  }
});

router.get("/sites/:slug/stream", async (req: Request, res: Response): Promise<void> => {
  const slug = req.params.slug as string;

  const [site] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.slug, slug));

  if (!site) {
    res.status(404).json({ error: "Ruta no encontrada" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 20000);

  let lastFingerprint = "__unset__";

  const cached = getCacheEntry(slug);
  if (cached) {
    const typedCodes = cached.codes as { id: string | number; receivedAt: string }[];
    lastFingerprint = codesFingerprint(typedCodes);
    sendEvent("codes", cached.codes);
    req.log.info({ slug, count: cached.codes.length }, "SSE: served from cache immediately");
    if (cached.codes.length === 0) {
      requestFetch(site).catch((err) => {
        req.log.error({ err, slug }, "SSE: background fetch after empty cache failed");
      });
    }
  } else {
    req.log.info({ slug }, "SSE: cache cold — requesting on-demand fetch");
    requestFetch(site)
      .then(() => {})
      .catch((err) => {
        req.log.error({ err, slug }, "SSE: on-demand fetch failed");
        sendEvent("imap_error", { message: "Error al conectar con el servidor de correo" });
      });
  }

  const onUpdate = (codes: unknown[]) => {
    const typedCodes = codes as { id: string | number; receivedAt: string }[];
    const fp = codesFingerprint(typedCodes);
    if (fp !== lastFingerprint) {
      lastFingerprint = fp;
      sendEvent("codes", codes);
      req.log.info({ slug }, "SSE: pushed updated codes");
    }
  };

  codeEvents.on(`update:${slug}`, onUpdate);

  req.on("close", () => {
    codeEvents.off(`update:${slug}`, onUpdate);
    clearInterval(keepAlive);
    req.log.info({ slug }, "SSE client disconnected");
  });

  req.log.info({ slug }, "SSE client connected");
});

export default router;
