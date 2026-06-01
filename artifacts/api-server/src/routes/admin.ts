import { Router, type IRouter } from "express";
import { db, sitesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/jwtAuth";
import { encrypt, decrypt } from "../lib/crypto";
import { testImapConnection } from "../lib/imap";
import {
  CreateSiteBody,
  UpdateSiteBody,
  UpdateSiteParams,
  DeleteSiteParams,
  TestSiteConnectionParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function serializeSite(site: typeof sitesTable.$inferSelect) {
  return {
    id: site.id,
    slug: site.slug,
    name: site.name,
    logoUrl: site.logoUrl ?? null,
    imapHost: site.imapHost,
    imapEmail: site.imapEmail,
    createdAt: site.createdAt.toISOString(),
  };
}

router.get("/admin/sites", requireAuth, async (req, res): Promise<void> => {
  const sites = await db.select().from(sitesTable).orderBy(sitesTable.createdAt);
  res.json(sites.map(serializeSite));
});

router.post("/admin/sites", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.slug, parsed.data.slug));
  if (existing.length > 0) {
    res.status(409).json({ error: `La ruta "/${parsed.data.slug}" ya existe` });
    return;
  }

  const [site] = await db
    .insert(sitesTable)
    .values({
      slug: parsed.data.slug,
      name: parsed.data.name,
      logoUrl: parsed.data.logoUrl ?? null,
      imapHost: parsed.data.imapHost,
      imapEmail: parsed.data.imapEmail,
      imapPasswordEncrypted: encrypt(parsed.data.imapPassword),
    })
    .returning();

  req.log.info({ slug: site.slug }, "Site created");
  res.status(201).json(serializeSite(site));
});

router.put("/admin/sites/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateSiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Partial<typeof sitesTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (parsed.data.slug != null) updateData.slug = parsed.data.slug;
  if (parsed.data.name != null) updateData.name = parsed.data.name;
  if ("logoUrl" in parsed.data) updateData.logoUrl = parsed.data.logoUrl ?? null;
  if (parsed.data.imapHost != null) updateData.imapHost = parsed.data.imapHost;
  if (parsed.data.imapEmail != null) updateData.imapEmail = parsed.data.imapEmail;
  if (parsed.data.imapPassword != null) {
    updateData.imapPasswordEncrypted = encrypt(parsed.data.imapPassword);
  }

  const [site] = await db
    .update(sitesTable)
    .set(updateData)
    .where(eq(sitesTable.id, params.data.id))
    .returning();

  if (!site) {
    res.status(404).json({ error: "Sitio no encontrado" });
    return;
  }

  res.json(serializeSite(site));
});

router.delete("/admin/sites/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteSiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(sitesTable)
    .where(eq(sitesTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Sitio no encontrado" });
    return;
  }

  res.sendStatus(204);
});

router.post("/admin/sites/:id/test", requireAuth, async (req, res): Promise<void> => {
  const params = TestSiteConnectionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [site] = await db
    .select()
    .from(sitesTable)
    .where(eq(sitesTable.id, params.data.id));

  if (!site) {
    res.status(404).json({ error: "Sitio no encontrado" });
    return;
  }

  const password = decrypt(site.imapPasswordEncrypted);
  const result = await testImapConnection({
    host: site.imapHost,
    email: site.imapEmail,
    password,
  });

  res.json(result);
});

export default router;
