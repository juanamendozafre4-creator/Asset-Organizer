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

  res.json({ name: site.name, logoUrl: site.logoUrl ?? null, slug: site.slug });
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
      10
    );

    const codes = rawEmails.map((email) => {
      const body = decodeEmailBody(email.source);
      return {
        id: email.uid,
        profileName: extractProfileName(body),
        deviceInfo: extractDeviceInfo(body),
        code: extractCode(body),
        receivedAt: email.receivedAt.toISOString(),
        expiresIn: extractExpiry(body),
      };
    });

    req.log.info({ slug: site.slug, count: codes.length }, "Fetched codes for site");
    res.json(ListSiteCodesResponse.parse(codes));
  } catch (err) {
    req.log.error({ err, slug: site.slug }, "IMAP error");
    res.status(503).json({ error: "Error al conectar con el servidor de correo" });
  }
});

export default router;
