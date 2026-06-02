import { Router, type IRouter, type Request, type Response } from "express";
import { db, sitesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/crypto";
import {
  fetchNetflixEmailsForSite,
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

const router: IRouter = Router();

type SiteRow = typeof sitesTable.$inferSelect;

const SUBJECT_FILTERS = [
  "código de acceso temporal",
  "netflix temporary access code",
];

export async function buildCodesForSite(site: SiteRow) {
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

      // Try extracting from the email subject before hitting the Netflix link
      if (!code) {
        code = extractCodeFromSubject(email.subject);
        if (code) {
          logger.info({ slug: site.slug, code }, "Code extracted from subject line");
        }
      }

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
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
    .slice(0, 10);
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
  });

  // Trigger an immediate fetch if no valid cache exists
  if (!isCacheValid(site.slug)) {
    buildCodesForSite(site)
      .then((codes) => setCacheEntry(site.slug, codes))
      .catch(() => {});
  }
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

  let lastFingerprint = "";

  // Serve cached data immediately — no IMAP call from here ever.
  // The background poller + IMAP IDLE keep the cache always warm.
  const cached = getCacheEntry(slug);
  if (cached && cached.codes.length > 0) {
    const typedCodes = cached.codes as { id: string | number; receivedAt: string }[];
    lastFingerprint = codesFingerprint(typedCodes);
    sendEvent("codes", cached.codes);
    req.log.info({ slug }, "SSE: served from cache immediately");
  } else {
    req.log.info({ slug }, "SSE: cache empty — waiting for background poller");
  }

  // Listen for cache updates from the background poller / IMAP IDLE
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
