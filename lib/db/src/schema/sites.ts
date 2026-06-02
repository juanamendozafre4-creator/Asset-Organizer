import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const adminUsersTable = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sitesTable = pgTable("sites", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  themeColor: text("theme_color").default("#141414").notNull(),
  imapHost: text("imap_host").notNull(),
  imapEmail: text("imap_email").notNull(),
  imapPasswordEncrypted: text("imap_password_encrypted").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSiteSchema = createInsertSchema(sitesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSite = z.infer<typeof insertSiteSchema>;
export type Site = typeof sitesTable.$inferSelect;
export type AdminUser = typeof adminUsersTable.$inferSelect;
