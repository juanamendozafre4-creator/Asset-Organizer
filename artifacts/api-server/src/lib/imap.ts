import { ImapFlow } from "imapflow";
import { logger } from "./logger";

export interface RawEmail {
  uid: string;
  source: string;
  receivedAt: Date;
  subject: string;
}

export interface SiteImapConfig {
  host: string;
  email: string;
  password: string;
}

export async function fetchNetflixEmailsForSite(
  config: SiteImapConfig,
  limit = 10
): Promise<RawEmail[]> {
  const client = new ImapFlow({
    host: config.host,
    port: 993,
    secure: true,
    auth: {
      user: config.email,
      pass: config.password,
    },
    logger: false,
  });

  const results: RawEmail[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const [r1, r2] = await Promise.all([
        client.search({ subject: "código de acceso temporal" }).catch(() => []),
        client.search({ subject: "temporary access code" }).catch(() => []),
      ]);

      const r1Arr = Array.isArray(r1) ? r1 : [];
      const r2Arr = Array.isArray(r2) ? r2 : [];
      const allIds = [...new Set([...r1Arr, ...r2Arr])];
      const ids = allIds.slice(-limit).reverse();

      for (const seq of ids) {
        try {
          const msg = await client.fetchOne(String(seq), {
            source: true,
            internalDate: true,
            envelope: true,
          });

          if (msg) {
            const receivedRaw = msg.internalDate;
            const receivedAt =
              receivedRaw instanceof Date
                ? receivedRaw
                : typeof receivedRaw === "string"
                  ? new Date(receivedRaw)
                  : new Date();

            results.push({
              uid: String(seq),
              source: msg.source?.toString("utf-8") ?? "",
              receivedAt,
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

export async function testImapConnection(config: SiteImapConfig): Promise<{ success: boolean; message: string }> {
  const client = new ImapFlow({
    host: config.host,
    port: 993,
    secure: true,
    auth: { user: config.email, pass: config.password },
    logger: false,
  });

  try {
    await client.connect();
    await client.logout();
    return { success: true, message: `Conexión exitosa con ${config.email}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return { success: false, message: `Error de conexión: ${message}` };
  }
}

export function extractProfileName(body: string): string {
  const m = body.match(/Hola[,\s]+([^\n<,\r]+)/i);
  if (m) return m[1].trim().replace(/\s+/g, " ");
  const m2 = body.match(/Hello[,\s]+([^\n<,\r]+)/i);
  if (m2) return m2[1].trim();
  return "Usuario";
}

export function extractDeviceInfo(body: string): string {
  const full = body.match(/Solicitud de \d+ desde[:\s]+(.+?)\s+a las\s+([^\n<\r]+)/i);
  if (full) return `Solicitud desde: ${full[1].trim()} — ${full[2].trim()}`;
  const dev = body.match(/Solicitud de \d+ desde[:\s]+([^\n<\r]+)/i);
  if (dev) return `Solicitud desde: ${dev[1].trim()}`;
  const eng = body.match(/request (?:is )?from[:\s]+([^\n<\r]+)/i);
  if (eng) return `Request from: ${eng[1].trim()}`;
  return "Información del dispositivo no disponible";
}

export function extractCode(body: string): string | null {
  const patterns = [
    /tu\s+c[oó]digo\s+(?:de\s+acceso\s+(?:temporal\s+)?)?(?:es[:\s]+)?([A-Z0-9]{4,8})/i,
    /\b([A-Z]{1,2}[0-9]{4,6})\b/,
    /\b([0-9]{6,8})\b/,
  ];
  for (const p of patterns) {
    const m = body.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

export function extractExpiry(body: string): string | null {
  const m = body.match(/(?:vence|expires?|v[aá]lido)[^\d]*(\d+)\s*(minutos?|minutes?|hours?|horas?)/i);
  if (m) return `${m[1]} ${m[2]}`;
  return "15 minutos";
}

export function decodeEmailBody(source: string): string {
  const plain = source.match(
    /Content-Type: text\/plain[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]+?)(?=\r?\n--|\r?\n\r?\n--)/i
  );
  if (plain) return plain[1];
  const html = source.match(
    /Content-Type: text\/html[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]+?)(?=\r?\n--)/i
  );
  if (html) {
    return html[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ");
  }
  return source.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}
