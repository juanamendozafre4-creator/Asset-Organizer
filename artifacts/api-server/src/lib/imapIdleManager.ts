import { ImapFlow } from "imapflow";
import { logger } from "./logger";
import { decrypt } from "./crypto";
import { setCacheEntry } from "./codesCache";

type SiteRow = {
  slug: string;
  imapHost: string;
  imapEmail: string;
  imapPasswordEncrypted: string;
};

/**
 * Fetches and processes emails using an existing connected IMAP client.
 * Passed in from backgroundPoller to avoid a circular import.
 */
type BuildWithClientFn = (client: ImapFlow, site: SiteRow) => Promise<unknown[]>;

interface IdleState {
  active: boolean;
  connected: boolean;
  client: ImapFlow | null;
}

const states = new Map<string, IdleState>();

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function runIdleLoop(site: SiteRow, buildWithClient: BuildWithClientFn) {
  const state = states.get(site.slug)!;
  let retryDelay = 5_000;

  while (state.active) {
    const client = new ImapFlow({
      host: site.imapHost,
      port: 993,
      secure: true,
      auth: {
        user: site.imapEmail,
        pass: decrypt(site.imapPasswordEncrypted),
      },
      logger: false,
    });

    state.client = client;

    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");

      retryDelay = 5_000;
      state.connected = true;
      logger.info({ slug: site.slug }, "IDLE: connected and INBOX selected");

      // Initial fetch using the SAME connection — no second IMAP connection opened
      // Timeout of 45s to avoid blocking the IDLE loop indefinitely
      try {
        const codes = await Promise.race([
          buildWithClient(client, site),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Initial fetch timed out after 15s")), 15_000)
          ),
        ]);
        setCacheEntry(site.slug, codes);
        logger.info({ slug: site.slug, count: (codes as unknown[]).length }, "IDLE: initial fetch done");
      } catch (err) {
        logger.warn({ err, slug: site.slug }, "IDLE: initial fetch failed");
      }

      try {
        while (state.active) {
          let existsReceived = false;

          const existsHandler = () => {
            existsReceived = true;
            client.idleNotify().catch(() => {});
          };

          client.on("exists", existsHandler);

          try {
            await client.idle();
          } finally {
            client.off("exists", existsHandler);
          }

          if (!state.active) break;

          if (existsReceived) {
            logger.info({ slug: site.slug }, "IDLE: EXISTS — fetching with existing connection");
            try {
              const codes = await buildWithClient(client, site);
              setCacheEntry(site.slug, codes);
              logger.info(
                { slug: site.slug, count: (codes as unknown[]).length },
                "IDLE: cache updated after new email"
              );
            } catch (err) {
              logger.warn({ err, slug: site.slug }, "IDLE: fetch after EXISTS failed");
            }
          }
        }
      } finally {
        state.connected = false;
        lock.release();
      }

      await client.logout().catch(() => {});
    } catch (err) {
      state.connected = false;
      logger.warn(
        { err, slug: site.slug, retryDelay },
        "IDLE: connection error — will reconnect"
      );
      try {
        await client.logout();
      } catch {}
      state.client = null;

      if (state.active) {
        await sleep(retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60_000);
      }
    }
  }

  state.connected = false;
  state.client = null;
  logger.info({ slug: site.slug }, "IDLE: loop stopped");
}

export function startIdleForSite(site: SiteRow, buildWithClient: BuildWithClientFn) {
  if (states.has(site.slug)) return;

  const state: IdleState = { active: true, connected: false, client: null };
  states.set(site.slug, state);

  runIdleLoop(site, buildWithClient).catch((err) =>
    logger.error({ err, slug: site.slug }, "IDLE: fatal unhandled error")
  );

  logger.info({ slug: site.slug }, "IDLE: started");
}

export function stopIdleForSite(slug: string) {
  const state = states.get(slug);
  if (!state) return;
  state.active = false;
  state.connected = false;
  state.client?.idleNotify().catch(() => {});
  states.delete(slug);
  logger.info({ slug }, "IDLE: stop requested");
}

export function getActiveIdleSlugs(): string[] {
  return [...states.keys()];
}

/** Returns true only when the IMAP connection is live and INBOX is selected */
export function isIdleConnected(slug: string): boolean {
  return states.get(slug)?.connected ?? false;
}
