import { ImapFlow } from "imapflow";
import { logger } from "./logger";

export function isGmailConfigured(): boolean {
  return !!(
    process.env.GMAIL_EMAIL &&
    process.env.GMAIL_APP_PASSWORD &&
    process.env.GMAIL_IMAP_HOST
  );
}

export async function getConnectedEmail(): Promise<string | null> {
  if (!isGmailConfigured()) return null;
  return process.env.GMAIL_EMAIL ?? null;
}

export async function fetchNetflixEmails(limit = 10): Promise<RawEmail[]> {
  const client = new ImapFlow({
    host: process.env.GMAIL_IMAP_HOST!,
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_EMAIL!,
      pass: process.env.GMAIL_APP_PASSWORD!,
    },
    logger: false,
  });

  const results: RawEmail[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const searchResults = await client.search({
        subject: "código de acceso temporal",
      });

      const altResults = await client.search({
        subject: "temporary access code",
      });

      const allIds = [...new Set([...searchResults, ...altResults])];
      const ids = allIds.slice(-limit).reverse();

      for (const seq of ids) {
        try {
          const msg = await client.fetchOne(String(seq), {
            source: true,
            internalDate: true,
            envelope: true,
          });

          if (msg) {
            results.push({
              uid: String(seq),
              source: msg.source?.toString("utf-8") ?? "",
              receivedAt: msg.internalDate ?? new Date(),
              subject: msg.envelope?.subject ?? "",
            });
          }
        } catch (err) {
          logger.warn({ err, seq }, "Error fetching individual email");
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return results;
}

export interface RawEmail {
  uid: string;
  source: string;
  receivedAt: Date;
  subject: string;
}
