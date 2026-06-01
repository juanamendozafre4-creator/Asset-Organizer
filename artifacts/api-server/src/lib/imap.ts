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

function decodeQuotedPrintable(str: string): string {
  return str
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

function decodeBase64Mime(str: string): string {
  try {
    return Buffer.from(str.replace(/\s+/g, ""), "base64").toString("utf-8");
  } catch {
    return str;
  }
}

interface EmailParts {
  plain: string;
  html: string;
}

export function extractEmailParts(source: string): EmailParts {
  const result: EmailParts = { plain: "", html: "" };

  // Split on MIME boundaries
  const boundaryMatch = source.match(/boundary=["']?([^"'\r\n;]+)["']?/i);
  const boundary = boundaryMatch?.[1]?.trim();
  const parts = boundary
    ? source.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--|\\s)`, "g"))
    : [source];

  for (const part of parts) {
    const ctMatch = part.match(/Content-Type:\s*(text\/(?:plain|html))/i);
    if (!ctMatch) continue;
    const contentType = ctMatch[1].toLowerCase();
    const encMatch = part.match(/Content-Transfer-Encoding:\s*(base64|quoted-printable)/i);
    const encoding = encMatch?.[1]?.toLowerCase();
    const bodyMatch = part.match(/(?:\r?\n){2}([\s\S]+)/);
    if (!bodyMatch) continue;

    let body = bodyMatch[1].trim();
    if (encoding === "base64") {
      body = decodeBase64Mime(body);
    } else if (encoding === "quoted-printable") {
      body = decodeQuotedPrintable(body);
    }

    if (contentType === "text/plain" && !result.plain) result.plain = body;
    if (contentType === "text/html" && !result.html) result.html = body;
  }

  // Fallback: try the whole source
  if (!result.plain && !result.html) {
    result.plain = source;
  }

  return result;
}

export function decodeEmailBody(source: string): string {
  const { plain, html } = extractEmailParts(source);
  if (plain && plain.length > 50) return plain;
  if (html) {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/\s+/g, " ")
      .trim();
  }
  return source.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

export function extractNetflixLink(source: string): string | null {
  const { html } = extractEmailParts(source);
  const searchIn = [html, source];

  const urlPatterns = [
    /https?:\/\/(?:www\.)?netflix\.com\/account\/travel\/verify[^\s"'<>\r\n)]+/gi,
    /https?:\/\/(?:www\.)?netflix\.com\/[^\s"'<>\r\n)]*temporaryAccess[^\s"'<>\r\n)]*/gi,
    /https?:\/\/click\.netflix\.com[^\s"'<>\r\n)]+/gi,
    /https?:\/\/[^\s"'<>\r\n)]*netflix[^\s"'<>\r\n)]*(?:verify|acceso|codigo|code)[^\s"'<>\r\n)]*/gi,
  ];

  for (const content of searchIn) {
    if (!content) continue;
    // Also try with quoted-printable unescaped
    const decoded = content.includes("=\r\n") || content.includes("=\n")
      ? decodeQuotedPrintable(content)
      : content;

    for (const p of urlPatterns) {
      p.lastIndex = 0;
      const m = decoded.match(p);
      if (m?.[0]) {
        return m[0]
          .replace(/&amp;/g, "&")
          .replace(/['">\s]+$/, "");
      }
    }
  }
  return null;
}

export async function fetchCodeFromNetflixLink(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "es-419,es;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
      },
      signal: AbortSignal.timeout(12000),
      redirect: "follow",
    });

    if (!res.ok) {
      logger.warn({ status: res.status, url }, "Netflix link returned non-OK status");
      return null;
    }

    const html = await res.text();

    // 1. Look in embedded JSON state (Netflix uses server-side rendered JSON blobs)
    const jsonPatterns = [
      /"accessCode"\s*:\s*"?([0-9]{4})"?/i,
      /"code"\s*:\s*"([0-9]{4})"/i,
      /"verificationCode"\s*:\s*"?([0-9]{4})"?/i,
      /"pin"\s*:\s*"?([0-9]{4})"?/i,
      /accessCode['":\s]+([0-9]{4})\b/i,
    ];
    for (const p of jsonPatterns) {
      const m = html.match(p);
      if (m) {
        logger.info({ code: m[1] }, "Extracted Netflix code from JSON blob");
        return m[1];
      }
    }

    // 2. Look in HTML elements — Netflix renders the code inside a <div> or <span>
    const htmlPatterns = [
      /class="[^"]*(?:code|pin|access)[^"]*"[^>]*>\s*([0-9]{4})\s*</i,
      /data-testid="[^"]*code[^"]*"[^>]*>\s*([0-9]{4})\s*</i,
      />\s{0,5}([0-9]{4})\s{0,5}</,
    ];
    for (const p of htmlPatterns) {
      const m = html.match(p);
      if (m) {
        logger.info({ code: m[1] }, "Extracted Netflix code from HTML element");
        return m[1];
      }
    }

    logger.warn({ url, htmlLength: html.length }, "Could not extract 4-digit code from Netflix page");
    return null;
  } catch (err) {
    logger.warn({ err, url }, "Error fetching Netflix code from link");
    return null;
  }
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
      const searches = await Promise.all([
        client.search({ subject: "código de acceso temporal" }).catch(() => []),
        client.search({ subject: "temporary access code" }).catch(() => []),
        client.search({ subject: "acceso temporal" }).catch(() => []),
        client.search({ from: "netflix.com" }).catch(() => []),
      ]);

      const allIds = [...new Set(searches.flat().filter((x): x is number => typeof x === "number"))];
      const ids = allIds.sort((a, b) => b - a).slice(0, limit);

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

export function extractAccountEmail(body: string): string | null {
  const patterns = [
    /Netflix\s+te\s+envi[oó]\s+este\s+mensaje\s+a\s+\[?([^\]\s<>\r\n,]+@[^\]\s<>\r\n,]+)\]?/i,
    /enviamos\s+este\s+correo\s+a\s+\[?([^\]\s<>\r\n,]+@[^\]\s<>\r\n,]+)\]?/i,
    /Netflix\s+sent\s+this\s+(?:email|message)\s+to\s+\[?([^\]\s<>\r\n,]+@[^\]\s<>\r\n,]+)\]?/i,
    /\[([^\]]+@[^\]]+)\]\s+como\s+parte/i,
    /mensaje\s+a\s+([^\s<>\r\n,]+@[^\s<>\r\n,]+)/i,
  ];
  for (const p of patterns) {
    const m = body.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

export function extractProfileName(body: string): string {
  const patterns = [
    /Hola[,\s]+([^\n<,\r:]+)/i,
    /Hello[,\s]+([^\n<,\r:]+)/i,
  ];
  for (const p of patterns) {
    const m = body.match(p);
    if (m) return m[1].trim().replace(/\s+/g, " ");
  }
  return "Usuario";
}

export function extractDeviceInfo(body: string): string {
  // "Solicitud de Sebastian desde: Hyundai - Smart TV a las 31 de mayo, 10:15 p. m. GMT-5"
  // Pattern: "Solicitud de <name/anything> desde[:]" then device, "a las" then time
  const full = body.match(
    /Solicitud de [^.]+?desde[:\s]+(.+?)\s+a las\s+([^\n<\r.]+)/i
  );
  if (full) return `${full[1].trim()} — ${full[2].trim()}`;

  const dev = body.match(/Solicitud de [^.]+?desde[:\s]+([^\n<\r.]+)/i);
  if (dev) return dev[1].trim();

  const eng = body.match(/request (?:is )?from[:\s]+([^\n<\r]+)/i);
  if (eng) return `Request from: ${eng[1].trim()}`;

  return "Información del dispositivo no disponible";
}

export function extractCode(body: string): string | null {
  const patterns = [
    /tu\s+c[oó]digo\s+(?:de\s+acceso\s+(?:temporal\s+)?)?(?:es[:\s]+)?([0-9]{4})\b/i,
    /c[oó]digo[:\s]+([0-9]{4})\b/i,
    /\bcode[:\s]+([0-9]{4})\b/i,
    /\b([0-9]{4})\b/,
  ];
  for (const p of patterns) {
    const m = body.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

export function extractExpiry(body: string): string {
  const m = body.match(
    /(?:vence|expires?|v[aá]lido)[^\d]*(\d+)\s*(minutos?|minutes?|hours?|horas?)/i
  );
  if (m) return `${m[1]} ${m[2]}`;
  return "15 minutos";
}
