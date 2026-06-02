import { Router, type IRouter } from "express";
import { db, sitesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/crypto";
import {
  fetchNetflixEmailsForSite,
  extractProfileName,
  extractDeviceInfo,
  extractCode,
  extractExpiry,
  decodeEmailBody,
  extractNetflixLink,
  fetchCodeFromNetflixLink,
  extractAccountEmail,
} from "../lib/imap";
import {
  GetSiteInfoParams,
  ListSiteCodesParams,
  ListSiteCodesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

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

  res.json({ name: site.name, logoUrl: site.logoUrl ?? null, description: site.description ?? null, themeColor: site.themeColor, slug: site.slug });
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
    const password = decrypt(site.imapPasswordEncrypted);
    const rawEmails = await fetchNetflixEmailsForSite(
      { host: site.imapHost, email: site.imapEmail, password },
      20
    );

    const SUBJECT_FILTER = "Tu código de acceso temporal de Netflix";
    const filtered = rawEmails.filter((email) =>
      email.subject.toLowerCase().includes(SUBJECT_FILTER.toLowerCase())
    );

    const codes = await Promise.all(
      filtered.map(async (email) => {
        const body = decodeEmailBody(email.source);
        let code = extractCode(body);
        const netflixLink = extractNetflixLink(email.source);

        // If no code found in the email body, try following the Netflix link
        if (!code && netflixLink) {
          code = await fetchCodeFromNetflixLink(netflixLink);
        }

        return {
          id: email.uid,
          profileName: extractProfileName(body),
          deviceInfo: extractDeviceInfo(body),
          code,
          netflixLink: netflixLink ?? null,
          accountEmail: extractAccountEmail(body),
          receivedAt: email.receivedAt.toISOString(),
          expiresIn: extractExpiry(body),
        };
      })
    );

    const sorted = codes
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
      .slice(0, 10);

    req.log.info({ slug: site.slug, count: sorted.length }, "Fetched codes for site");
    res.json(ListSiteCodesResponse.parse(sorted));
  } catch (err) {
    req.log.error({ err, slug: site.slug }, "IMAP error");
    res.status(503).json({ error: "Error al conectar con el servidor de correo" });
  }
});

export default router;
