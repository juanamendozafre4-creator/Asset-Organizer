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

    // Detect charset — needed for correct multi-byte decoding
    const charsetMatch = part.match(/charset=["']?([\w-]+)["']?/i);
    const charset = (charsetMatch?.[1] ?? "utf-8").toLowerCase().replace(/-/g, "");
    const isLatin1 = charset === "iso88591" || charset === "latin1" || charset === "windows1252" || charset === "windows1250";

    const encMatch = part.match(/Content-Transfer-Encoding:\s*(base64|quoted-printable)/i);
    const encoding = encMatch?.[1]?.toLowerCase();
    const bodyMatch = part.match(/(?:\r?\n){2}([\s\S]+)/);
    if (!bodyMatch) continue;

    let body = bodyMatch[1].trim();
    if (encoding === "base64") {
      try {
        const buf = Buffer.from(body.replace(/\s+/g, ""), "base64");
        body = isLatin1 ? buf.toString("latin1") : buf.toString("utf-8");
      } catch {
        // keep raw
      }
    } else if (encoding === "quoted-printable") {
      body = decodeQuotedPrintable(body);
      if (!isLatin1) {
        try {
          body = Buffer.from(body, "latin1").toString("utf-8");
        } catch {
          // keep as-is — better garbled than crashed
        }
      }
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

export function extractCodeFromSubject(subject: string): string | null {
  if (!subject) return null;
  const patterns = [
    /c[oó]digo(?:\s+de\s+acceso(?:\s+temporal)?)?\s*[:\-]\s*([0-9]{4})\b/i,
    /(?:temporary\s+)?access\s+code\s*[:\-]\s*([0-9]{4})\b/i,
    /\b([0-9]{4})\b/,
  ];
  for (const p of patterns) {
    const m = subject.match(p);
    if (m) return m[1];
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
      signal: AbortSignal.timeout(4000),
      redirect: "follow",
    });

    if (!res.ok) {
      logger.warn({ status: res.status, url }, "Netflix link returned non-OK status");
      return null;
    }

    const finalUrl = res.url;
    const html = await res.text();

    logger.debug({ finalUrl, htmlLength: html.length, snippet: html.slice(0, 600) }, "Netflix page fetched");

    if (finalUrl && !finalUrl.includes("travel/verify") && !finalUrl.includes("temporaryAccess")) {
      logger.info({ url, finalUrl }, "Netflix redirected away from verify page — token expired/invalid");
      return "EXPIRED";
    }

    const expiredPatterns = [
      /este\s+c[oó]digo\s+ha\s+caducado/i,
      /c[oó]digo\s+ha\s+caducado/i,
      /c[oó]digo\s+expirado/i,
      /enlace\s+ha\s+expirado/i,
      /este\s+enlace\s+(?:ya\s+no\s+es\s+v[aá]lido|ha\s+vencido|expir)/i,
      /enlace\s+(?:ya\s+no\s+es\s+v[aá]lido|expirado|vencido)/i,
      /this\s+code\s+has\s+expired/i,
      /code\s+is\s+no\s+longer\s+valid/i,
      /link\s+has\s+expired/i,
      /nftoken.*invalid/i,
      /token.*(?:invalid|expired|caducado)/i,
      /no\s+(?:es|fue)\s+posible\s+verificar/i,
      /no\s+se\s+pudo\s+verificar/i,
      /verif.*no\s+v[aá]lid/i,
    ];
    for (const p of expiredPatterns) {
      if (p.test(html)) {
        logger.info({ url }, "Netflix page indicates code is expired");
        return "EXPIRED";
      }
    }

    const jsonPatterns = [
      /"accessCode"\s*:\s*"?([0-9]{4})"?/i,
      /"code"\s*:\s*"([0-9]{4})"/i,
      /"verificationCode"\s*:\s*"?([0-9]{4})"?/i,
      /"pin"\s*:\s*"?([0-9]{4})"?/i,
      /accessCode['":\s]+([0-9]{4})\b/i,
      /"temporaryCode"\s*:\s*"?([0-9]{4})"?/i,
      /"travelCode"\s*:\s*"?([0-9]{4})"?/i,
      /['"](code|pin|access)['"]\s*:\s*['"]\s*([0-9]{4})\s*['"]/i,
    ];
    for (const p of jsonPatterns) {
      const m = html.match(p);
      if (m) {
        const code = m[m.length - 1];
        logger.info({ code }, "Extracted Netflix code from JSON blob");
        return code;
      }
    }

    const htmlPatterns = [
      /class="[^"]*(?:code|pin|access)[^"]*"[^>]*>\s*([0-9]{4})\s*</i,
      /data-testid="[^"]*code[^"]*"[^>]*>\s*([0-9]{4})\s*</i,
      />\s{0,8}([0-9]{4})\s{0,8}</,
    ];
    for (const p of htmlPatterns) {
      const m = html.match(p);
      if (m) {
        logger.info({ code: m[1] }, "Extracted Netflix code from HTML element");
        return m[1];
      }
    }

    const digitSpan = html.match(
      /<[a-z][^>]{0,60}>\s*(\d)\s*<\/[a-z]+>\s*<[a-z][^>]{0,60}>\s*(\d)\s*<\/[a-z]+>\s*<[a-z][^>]{0,60}>\s*(\d)\s*<\/[a-z]+>\s*<[a-z][^>]{0,60}>\s*(\d)\s*<\/[a-z]+>/i
    );
    if (digitSpan) {
      const code = digitSpan[1] + digitSpan[2] + digitSpan[3] + digitSpan[4];
      logger.info({ code }, "Extracted Netflix code from digit spans");
      return code;
    }

    const allMatches = [...html.matchAll(/>\s*([0-9]{4})\s*</g)];
    const candidate = allMatches
      .map((m) => m[1])
      .find((n) => !/^(19|20)\d{2}$/.test(n));
    if (candidate) {
      logger.info({ code: candidate }, "Extracted Netflix code via fallback scan");
      return candidate;
    }

    logger.warn({ url, htmlLength: html.length }, "Could not extract 4-digit code from Netflix page");
    return null;
  } catch (err) {
    logger.warn({ err, url }, "Error fetching Netflix code from link");
    return null;
  }
}

/**
 * Fetch Netflix emails using an already-connected ImapFlow client
 * that already has INBOX locked. Does NOT connect or disconnect.
 */
export async function fetchEmailsFromLockedInbox(
  client: ImapFlow,
  limit = 20
): Promise<RawEmail[]> {
  const results: RawEmail[] = [];

  const foundEs = await client
    .search({ subject: "acceso temporal" })
    .catch(() => [] as number[]);
  const foundEn = await client
    .search({ subject: "Netflix temporary access code" })
    .catch(() => [] as number[]);

  const found = [...(foundEs as number[]), ...(foundEn as number[])];
  const allIds = [...new Set(found.filter((x): x is number => typeof x === "number"))];
  const ids = allIds.sort((a, b) => b - a).slice(0, limit);

  if (ids.length === 0) return results;

  const range = ids.join(",");
  try {
    for await (const msg of client.fetch(range, {
      source: true,
      internalDate: true,
      envelope: true,
    })) {
      const receivedRaw = msg.internalDate;
      const receivedAt =
        receivedRaw instanceof Date
          ? receivedRaw
          : typeof receivedRaw === "string"
            ? new Date(receivedRaw)
            : new Date();

      results.push({
        uid: String(msg.seq),
        source: msg.source?.toString("utf-8") ?? "",
        receivedAt,
        subject: msg.envelope?.subject ?? "",
      });
    }
  } catch (err) {
    logger.warn({ err, range }, "Error batch-fetching emails");
  }

  return results;
}

export async function fetchNetflixEmailsForSite(
  config: SiteImapConfig,
  limit = 20
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

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      return await fetchEmailsFromLockedInbox(client, limit);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
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
    const raw = err instanceof Error ? err.message : "Error desconocido";
    const code = (err as NodeJS.ErrnoException).code ?? "";

    let message: string;

    if (raw.includes("Command failed") || raw.includes("AUTHENTICATE") || raw.includes("LOGIN")) {
      if (config.host.includes("gmail")) {
        message =
          "Autenticación rechazada por Gmail. Asegúrate de usar una Contraseña de Aplicación (no la contraseña normal). " +
          "Si ya la tienes, espera 1–2 minutos antes de volver a probar — Gmail bloquea temporalmente los intentos repetidos.";
      } else {
        message =
          "Autenticación rechazada. Verifica que el correo y la contraseña sean correctos y que el acceso IMAP esté habilitado.";
      }
    } else if (code === "ENOTFOUND" || raw.includes("ENOTFOUND")) {
      message = `Servidor no encontrado: "${config.host}". Verifica que el host IMAP sea correcto.`;
    } else if (code === "ECONNREFUSED" || raw.includes("ECONNREFUSED")) {
      message = `Conexión rechazada por "${config.host}:993". Verifica que el puerto IMAP (993) esté abierto.`;
    } else if (code === "ETIMEDOUT" || raw.includes("ETIMEDOUT") || raw.includes("timeout")) {
      message = `Tiempo de espera agotado al conectar con "${config.host}". El servidor no responde.`;
    } else if (raw.includes("certificate") || raw.includes("SSL") || raw.includes("TLS")) {
      message = `Error de certificado SSL con "${config.host}". El servidor puede no soportar conexiones seguras en el puerto 993.`;
    } else {
      message = `Error de conexión: ${raw}`;
    }

    return { success: false, message };
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
  const flat = body.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");

  const holaPatterns = [
    /Hola[,\s]+([^\n<,\r:]{1,30})/i,
    /Hello[,\s]+([^\n<,\r:]{1,30})/i,
  ];
  for (const p of holaPatterns) {
    const m = body.match(p);
    if (m) {
      const name = m[1].trim().replace(/\s+/g, " ");
      const isBodyText = /c[oó]digo|acceso|temporal|netflix|enlace|correo|solicitud/i.test(name);
      if (name.length > 0 && !isBodyText) return name;
    }
  }

  const solicitudPatterns = [
    /Solicitud de ([^\n<,\r:]{1,30}?)\s+desde[:\s]/i,
    /request from ([^\n<,\r:]{1,30}?) at\b/i,
  ];
  for (const p of solicitudPatterns) {
    const m = flat.match(p);
    if (m) {
      const name = m[1].trim().replace(/\s+/g, " ");
      if (name.length > 0) return name;
    }
  }

  for (const p of holaPatterns) {
    const m = body.match(p);
    if (m) return m[1].trim().replace(/\s+/g, " ");
  }

  return "Usuario";
}

function flattenHtml(html: string): string {
  return html
    .replace(/<(?:br|p|tr|th|div|li|h\d|table|section|article)[^>]*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForDevice(text: string): string {
  return text
    .replace(/(\d+\.)[ \t]*\r?\n[ \t]*(º)/g, "$1$2")
    .replace(/(\d)[ \t]*\r?\n([ \t]*[a-záéíóúàèì\w])/gi, "$1 $2")
    .replace(/(Solicitud de [^\r\n]+?)[ \t]*\r?\n[ \t]*(desde\b)/gi, "$1 $2")
    .replace(/([A-Za-zÀ-ÿ0-9\-])[ \t]*\r?\n[ \t]*([A-Za-zÀ-ÿ])/g, "$1 $2")
    .replace(/\r\n/g, "\n");
}

/**
 * Strip trailing noise that Netflix appends after the timestamp on the same line.
 * e.g. "30 de mayo, 21:58 GMT-5 Solicitar código El enlace caduca…"
 */
function stripTrailingNoise(s: string): string {
  return s
    .replace(/\s+Obtener\b.*/i, "")
    .replace(/\s+Solicitar\b.*/i, "")
    .replace(/\s+Si\s+no\b.*/i, "")
    .replace(/\s+If\s+you\b.*/i, "")
    .replace(/\s+Este\s+enlace\b.*/i, "")
    .replace(/\s+El\s+enlace\b.*/i, "")
    .replace(/\s+Protege\b.*/i, "")
    .replace(/\s+Cuida\b.*/i, "")
    .replace(/[,\s]+$/, "")
    .trim();
}

export function extractDeviceInfo(body: string, rawHtml?: string): string {
  function cleanText(s: string): string {
    return s.replace(/\*/g, "").trim();
  }

  function cleanTime(s: string): string {
    return stripTrailingNoise(s);
  }

  /**
   * Returns true when the extracted string is obviously NOT a device name.
   * Catches:
   *  - Netflix placeholder phrases ("el dispositivo que aparece", "el dispositivo que ves", etc.)
   *  - Strings that are too short or absurdly long (> 200 chars means we grabbed a paragraph)
   */
  function isFalseDevice(s: string): boolean {
    return (
      /dispositivo que aparece/i.test(s) ||
      /el dispositivo/i.test(s) ||
      /dispositivo que ves/i.test(s) ||
      s.length < 2 ||
      s.length > 200
    );
  }

  function tryExtract(text: string): string | null {
    // Spanish full: "Solicitud de <name> desde: <device> a las <time>"
    const full = text.match(
      /Solicitud de [\s\S]+?desde[:\s]+([^\n]+?)[ \t]*\n?[ \t]*a las[ \t]+([^\n<]+)/i
    );
    if (full) {
      const device = cleanText(full[1]);
      const time = cleanTime(cleanText(full[2]));
      if (!isFalseDevice(device)) return `${device} — ${time}`;
    }

    // Spanish inline: "desde: <device> a las <time>" on one line
    const fullInline = text.match(/desde[:\s]+(.+?)\s+a las\s+([^\n<]+)/i);
    if (fullInline) {
      const device = cleanText(fullInline[1]);
      const time = cleanTime(cleanText(fullInline[2]));
      if (!isFalseDevice(device)) return `${device} — ${time}`;
    }

    // Spanish device-only: "Solicitud de <name> desde: <device>" (no time on same line)
    // FIX: limit captured length to 150 chars to avoid grabbing the whole collapsed body
    const dev = text.match(/Solicitud de [\s\S]+?desde[:\s]+([^\n<]{1,150})/i);
    if (dev) {
      const device = cleanText(dev[1]).replace(/\s+a las\b.*/i, "").trim();
      const clean = stripTrailingNoise(device);
      if (!isFalseDevice(clean)) return clean;
    }

    // NEW: "X ha enviado una solicitud desde <device> [— <date>]"
    // Handles Netflix format: "4 ha enviado una solicitud desde Roku – Decodificador — 30 de mayo, 21:58 GMT-5"
    const haEnviado = text.match(
      /ha\s+enviado\s+una\s+solicitud\s+desde\s+([^—–\n<]{3,80})(?:\s*[—–]\s*([^\n<]{3,60}))?/i
    );
    if (haEnviado) {
      const device = cleanText(haEnviado[1]).trim();
      const rawTime = haEnviado[2] ? cleanTime(cleanText(haEnviado[2])) : null;
      const cleanDev = stripTrailingNoise(device);
      if (!isFalseDevice(cleanDev)) {
        return rawTime ? `${cleanDev} — ${rawTime}` : cleanDev;
      }
    }

    // English full: "request from: <device> at <time>"
    const engFull = text.match(
      /(?:access\s+)?request\s+from[:\s]+([^\n]+?)[ \t]*\n?[ \t]*at[ \t]+([^\n<]+)/i
    );
    if (engFull) {
      const device = cleanText(engFull[1]);
      const time = cleanTime(cleanText(engFull[2]));
      if (!isFalseDevice(device)) return `${device} — ${time}`;
    }

    // English inline
    const engFallback = text.match(
      /(?:access\s+)?request\s+from[:\s]+(.+?)\s+at\s+([^\n<]+)/i
    );
    if (engFallback) {
      const device = cleanText(engFallback[1]);
      const time = cleanTime(cleanText(engFallback[2]));
      if (!isFalseDevice(device)) return `${device} — ${time}`;
    }

    // English device-only
    const engDev = text.match(/(?:access\s+)?request\s+from[:\s]+([^\n<]{1,100})/i);
    if (engDev) {
      const device = cleanText(engDev[1]);
      if (!isFalseDevice(device)) return device;
    }

    // Super-broad fallback: collapse all newlines in a window around "desde:" / "from:"
    const desdeIdx = text.search(/desde[:\s]|from[:\s]/i);
    if (desdeIdx !== -1) {
      const window = text
        .slice(Math.max(0, desdeIdx - 120), desdeIdx + 250)
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ");
      const inlineW = window.match(/desde[:\s]+(.+?)\s+a las\s+([^\n<]+)/i);
      if (inlineW) {
        const device = cleanText(inlineW[1]);
        const time = cleanTime(cleanText(inlineW[2]));
        if (!isFalseDevice(device)) return `${device} — ${time}`;
      }
      // haEnviado inside window
      const haEnviadoW = window.match(
        /ha\s+enviado\s+una\s+solicitud\s+desde\s+([^—–\n<]{3,80})(?:\s*[—–]\s*([^\n<]{3,60}))?/i
      );
      if (haEnviadoW) {
        const device = stripTrailingNoise(cleanText(haEnviadoW[1]).trim());
        const rawTime = haEnviadoW[2] ? cleanTime(cleanText(haEnviadoW[2])) : null;
        if (!isFalseDevice(device)) {
          return rawTime ? `${device} — ${rawTime}` : device;
        }
      }
      // FIX: limit devOnlyW to 80 chars (already was {3,80}) — keep as-is
      const devOnlyW = window.match(/desde[:\s]+([^<]{3,80})/i);
      if (devOnlyW) {
        const raw = stripTrailingNoise(cleanText(devOnlyW[1]).replace(/\s+a las\b.*/i, "").trim());
        if (!isFalseDevice(raw) && raw.length > 2) return raw;
      }
      const fromW = window.match(/from[:\s]+(.+?)\s+at\s+([^\n<]+)/i);
      if (fromW) {
        const device = cleanText(fromW[1]);
        const time = cleanTime(cleanText(fromW[2]));
        if (!isFalseDevice(device)) return `${device} — ${time}`;
      }
    }

    return null;
  }

  // ─── Step 0: Direct HTML bold-tag extraction (HIGHEST PRIORITY) ───────────
  if (rawHtml) {
    const boldFull = rawHtml.match(
      /desde[:\s]+<(?:strong|b|span)[^>]*>([^<]{2,80})<\/(?:strong|b|span)>[^<]{0,300}?a las[:\s]*([^<\r\n]{3,60})/i
    );
    if (boldFull) {
      const device = cleanText(boldFull[1]);
      const time = cleanTime(cleanText(boldFull[2]));
      if (!isFalseDevice(device)) {
        logger.debug({ device, time }, "Device extracted via bold-tag full match");
        return `${device} — ${time}`;
      }
    }

    const desdeHtmlIdx = rawHtml.search(/desde[:\s]/i);
    if (desdeHtmlIdx !== -1) {
      const window = rawHtml.slice(Math.max(0, desdeHtmlIdx - 30), desdeHtmlIdx + 500);
      const nearBoldFull = window.match(
        /<(?:strong|b|span)[^>]*>([^<]{2,80})<\/(?:strong|b|span)>[^<]{0,300}?a las[:\s]*([^<\r\n]{3,60})/i
      );
      if (nearBoldFull) {
        const device = cleanText(nearBoldFull[1]);
        const time = cleanTime(cleanText(nearBoldFull[2]));
        if (!isFalseDevice(device)) {
          logger.debug({ device, time }, "Device extracted via nearby bold-tag full match");
          return `${device} — ${time}`;
        }
      }

      const nearBoldDevice = window.match(
        /<(?:strong|b|span)[^>]*>([^<]{2,80})<\/(?:strong|b|span)>/i
      );
      if (nearBoldDevice) {
        const device = cleanText(nearBoldDevice[1]);
        if (!isFalseDevice(device)) {
          logger.debug({ device }, "Device extracted via bold-tag device-only fallback");
          return device;
        }
      }
    }
  }

  // ─── Step 1: HTML flatten + text patterns ────────────────────────────────
  if (rawHtml) {
    const flat = flattenHtml(rawHtml);
    const result = tryExtract(flat);
    if (result) return result;
  }

  // ─── Step 2: Normalized plain-text body ──────────────────────────────────
  const normalized = normalizeForDevice(body);
  const result = tryExtract(normalized);
  if (result) return result;

  // ─── Step 3: Collapse ALL newlines in entire body and retry ──────────────
  const collapsed = body.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
  const collapsedResult = tryExtract(collapsed);
  if (collapsedResult) return collapsedResult;

  // ─── Step 4: Absolute last resort — grab raw "desde: Y" line ─────────────
  const rawLine = collapsed.match(/Solicitud de .{1,60}?desde[:\s]+([^.]{5,120})/i);
  if (rawLine) {
    const raw = stripTrailingNoise(
      rawLine[1]
        .replace(/\s+a las\b.*/i, "")
        .replace(/\*/g, "")
        .trim()
    );
    if (raw.length > 2 && !isFalseDevice(raw)) return raw;
  }

  return "";
}

export function extractCode(body: string, rawHtml?: string): string | null {
  const standalone = body.match(/^[ \t]*([0-9]{4})[ \t]*$/m);
  if (standalone) return standalone[1].trim();

  const textPatterns = [
    /tu\s+c[oó]digo\s+(?:de\s+acceso\s+(?:temporal\s+)?)?(?:es[:\s]+)?([0-9]{4})\b/i,
    /c[oó]digo\s+(?:de\s+acceso\s+)?(?:temporal\s+)?(?:es[:\s]+)?([0-9]{4})\b/i,
    /c[oó]digo[:\s]+([0-9]{4})\b/i,
    /acceso\s+temporal[^0-9]{0,40}([0-9]{4})\b/i,
    /temporal[^0-9]{0,20}([0-9]{4})\b/i,
    /your\s+(?:temporary\s+)?(?:access\s+)?code\s+is[:\s]+([0-9]{4})\b/i,
    /temporary\s+access\s+code[:\s]+([0-9]{4})\b/i,
    /\baccess\s+code[:\s]+([0-9]{4})\b/i,
    /\bcode[:\s]+([0-9]{4})\b/i,
  ];
  for (const p of textPatterns) {
    const m = body.match(p);
    if (m) return m[1].trim();
  }

  if (rawHtml) {
    const htmlPatterns = [
      /<(?:td|th|p|div|span|h\d)[^>]*>\s*([0-9]{4})\s*<\/(?:td|th|p|div|span|h\d)>/i,
      /font-size\s*:\s*(?:[2-9]\d|[1-9]\d{2,})px[^>]*>\s*([0-9]{4})\s*</i,
      /letter-spacing[^>]*>\s*([0-9]{4})\s*</i,
      /<font[^>]+size\s*=\s*["']?[5-9]["']?[^>]*>\s*([0-9]{4})\s*<\/font>/i,
      /<td[^>]*align\s*=\s*["']?center["']?[^>]*>\s*<?[^>]*>?\s*([0-9]{4})\s*<?\/[^>]*>?\s*<\/td>/i,
      /<(?:b|strong)[^>]*>\s*([0-9]{4})\s*<\/(?:b|strong)>/i,
      /data-testid=["'][^"']*(?:code|pin|acceso)[^"']*["'][^>]*>\s*([0-9]{4})\s*</i,
      /aria-label=["'][^"']*([0-9]{4})[^"']*["']/i,
    ];
    for (const p of htmlPatterns) {
      const m = rawHtml.match(p);
      if (m) {
        const candidate = m[m.length - 1];
        if (candidate) return candidate.trim();
      }
    }
  }

  return null;
}

export function extractExpiry(body: string): string {
  const m = body.match(
    /(?:vence|expires?|v[aá]lido)[^0-9]*(\d+)[^a-z]*?(minutos?|minutes?|hours?|horas?)/i
  );
  if (m) return `${m[1]} ${m[2]}`;
  return "15 minutos";
}
