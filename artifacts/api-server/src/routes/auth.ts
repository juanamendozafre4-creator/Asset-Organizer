import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, adminUsersTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { signToken } from "../lib/jwtAuth";
import { AdminLoginBody, AdminSetupBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/auth/status", async (_req, res): Promise<void> => {
  const [{ value }] = await db.select({ value: count() }).from(adminUsersTable);
  res.json({ needsSetup: Number(value) === 0 });
});

router.post("/auth/setup", async (req, res): Promise<void> => {
  const [{ value }] = await db.select({ value: count() }).from(adminUsersTable);
  if (Number(value) > 0) {
    res.status(409).json({ error: "Ya existe un administrador. Usa el login." });
    return;
  }

  const parsed = AdminSetupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const [admin] = await db
    .insert(adminUsersTable)
    .values({ email: parsed.data.email, passwordHash })
    .returning();

  const token = signToken({ id: admin.id, email: admin.email });
  res.status(201).json({ token, email: admin.email });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [admin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.email, parsed.data.email));

  if (!admin) {
    res.status(401).json({ error: "Credenciales incorrectas" });
    return;
  }

  const valid = await bcrypt.compare(parsed.data.password, admin.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Credenciales incorrectas" });
    return;
  }

  const token = signToken({ id: admin.id, email: admin.email });
  res.json({ token, email: admin.email });
});

export default router;
