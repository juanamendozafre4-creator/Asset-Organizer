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
      // decodeQuotedPrintable maps =XX hex bytes to String.fromCharCode(0xXX),
      // which produces Latin-1 codepoints. If the real charset is UTF-8, those
      // codepoints are actually UTF-8 byte values that must be re-assembled.
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

    // 0. Detect expired/invalid link — Netflix renders specific text
    const expiredPatterns = [
      /este\s+c[oó]digo\s+ha\s+caducado/i,
      /c[oó]digo\s+ha\s+caducado/i,
      /c[oó]digo\s+expirado/i,
      /enlace\s+ha\s+expirado/i,
      /this\s+code\s+has\s+expired/i,
      /code\s+is\s+no\s+longer\s+valid/i,
      /link\s+has\s+expired/i,
      /nftoken.*invalid/i,
    ];
    for (const p of expiredPatterns) {
      if (p.test(html)) {
        logger.info({ url }, "Netflix page indicates code is expired");
        return "EXPIRED";
      }
    }

    // 1. Look in embedded JSON state (Netflix uses server-side rendered JSON blobs)
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

    // 2. Look in HTML elements — Netflix renders the code inside a <div> or <span>
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

    // 3. Netflix sometimes renders each digit in its own element (e.g. <span>4</span><span>1</span>…)
    const digitSpan = html.match(
      /<[a-z][^>]{0,60}>\s*(\d)\s*<\/[a-z]+>\s*<[a-z][^>]{0,60}>\s*(\d)\s*<\/[a-z]+>\s*<[a-z][^>]{0,60}>\s*(\d)\s*<\/[a-z]+>\s*<[a-z][^>]{0,60}>\s*(\d)\s*<\/[a-z]+>/i
    );
    if (digitSpan) {
      const code = digitSpan[1] + digitSpan[2] + digitSpan[3] + digitSpan[4];
      logger.info({ code }, "Extracted Netflix code from digit spans");
      return code;
    }

    // 4. Last resort: scan for a lone 4-digit group in visible text (between > and <)
    //    excluding common false positives like years (1900-2099) and port numbers
    const allMatches = [...html.matchAll(/>\s*([0-9]{4})\s*</g)];
    const candidate = allMatches
      .map((m) => m[1])
      .find((n) => !/^(19|20)\d{2}$/.test(n)); // exclude years
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
      // Search for both Spanish and English Netflix temporary access code emails
      const foundEs = await client
        .search({ subject: "código de acceso temporal" })
        .catch(() => [] as number[]);
      const foundEn = await client
        .search({ subject: "Netflix temporary access code" })
        .catch(() => [] as number[]);

      const found = [...(foundEs as number[]), ...(foundEn as number[])];
      const allIds = [...new Set(found.filter((x): x is number => typeof x === "number"))];
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
  // IMPORTANT: use the raw body (with newlines) for "Hola, X" patterns so that
  // "Hola,\ncódigo de acceso" doesn't incorrectly capture "código de acceso".
  // Only use the collapsed version for "Solicitud de X desde:" which is one line.
  const flat = body.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");

  // 1. Standard greeting with newline/tag as natural boundary
  const holaPatterns = [
    /Hola[,\s]+([^\n<,\r:]{1,30})/i,
    /Hello[,\s]+([^\n<,\r:]{1,30})/i,
  ];
  for (const p of holaPatterns) {
    const m = body.match(p);
    if (m) {
      const name = m[1].trim().replace(/\s+/g, " ");
      // Reject if it looks like email body text (contains keywords or is too long)
      const isBodyText = /c[oó]digo|acceso|temporal|netflix|enlace|correo|solicitud/i.test(name);
      if (name.length > 0 && !isBodyText) return name;
    }
  }

  // 2. "Solicitud de X desde:" — X is the profile name (collapse-safe, one line)
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

  // 3. Numeric-only profile name is still valid (e.g. profile named "2")
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
    // Normalize ordinal indicators: "1.\nº" → "1.º"
    .replace(/(\d+\.)[ \t]*\r?\n[ \t]*(º)/g, "$1$2")
    // Join digit + newline + word (e.g. "1\nde junio")
    .replace(/(\d)[ \t]*\r?\n([ \t]*[a-záéíóúàèì\w])/gi, "$1 $2")
    // Join "Solicitud de X\ndesde:"
    .replace(/(Solicitud de [^\r\n]+?)[ \t]*\r?\n[ \t]*(desde\b)/gi, "$1 $2")
    // Join lines where a word wraps (e.g. "Amazon -\nDispositivo")
    .replace(/([A-Za-zÀ-ÿ0-9\-])[ \t]*\r?\n[ \t]*([A-Za-zÀ-ÿ])/g, "$1 $2")
    .replace(/\r\n/g, "\n");
}

export function extractDeviceInfo(body: string, rawHtml?: string): string {
  function cleanText(s: string): string {
    return s.replace(/\*/g, "").trim();
  }

  function cleanTime(s: string): string {
    return s
      .replace(/\s+Obtener\b.*/i, "")
      .replace(/\s+Si\s+no\b.*/i, "")
      .replace(/\s+If\s+you\b.*/i, "")
      .replace(/\s+Este\s+enlace\b.*/i, "")
      .replace(/[,\s]+$/, "")
      .trim();
  }

  function isFalseDevice(s: string): boolean {
    return /dispositivo que aparece/i.test(s) || s.length < 2;
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

    // Spanish device-only: "desde: <device>" (no time)
    const dev = text.match(/Solicitud de [\s\S]+?desde[:\s]+([^\n<]+)/i);
    if (dev) {
      const device = cleanText(dev[1]).replace(/\s+a las\b.*/i, "").trim();
      if (!isFalseDevice(device)) return device;
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
    const engDev = text.match(/(?:access\s+)?request\s+from[:\s]+([^\n<]+)/i);
    if (engDev) {
      const device = cleanText(engDev[1]);
      if (!isFalseDevice(device)) return device;
    }

    // Super-broad fallback: collapse all newlines in a window around "desde:" / "from:"
    // and re-try — catches cases where the sentence is split across multiple lines
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
      const devOnlyW = window.match(/desde[:\s]+([^<]{3,80})/i);
      if (devOnlyW) {
        const raw = cleanText(devOnlyW[1]).replace(/\s+a las\b.*/i, "").trim();
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

  // 1. Try HTML first: flatten to a single line — most reliable because
  //    HTML preserves the full sentence even when plain-text wraps it across lines.
  if (rawHtml) {
    const flat = flattenHtml(rawHtml);
    const result = tryExtract(flat);
    if (result) return result;
  }

  // 2. Try normalized plain-text body
  const normalized = normalizeForDevice(body);
  const result = tryExtract(normalized);
  if (result) return result;

  // 3. Last resort: collapse ALL newlines in the entire body and re-try
  const collapsed = body.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
  const collapsedResult = tryExtract(collapsed);
  if (collapsedResult) return collapsedResult;

  // 4. Absolute last resort: grab the raw "Solicitud de X desde: Y" line as-is
  //    from the collapsed body, even without a clean time.
  //    Still reject known false-device phrases (e.g. "el dispositivo que aparece").
  const rawLine = collapsed.match(/Solicitud de .{1,60}?desde[:\s]+([^.]{5,120})/i);
  if (rawLine) {
    const raw = rawLine[1]
      .replace(/\s+a las\b.*/i, "")
      .replace(/\s+Obtener\b.*/i, "")
      .replace(/\*/g, "")
      .trim();
    if (raw.length > 2 && !isFalseDevice(raw)) return raw;
  }

  return "";
}

export function extractCode(body: string, rawHtml?: string): string | null {
  // 1. Standalone 4-digit line — most reliable in Netflix plain-text emails where
  //    the code is presented alone on its own line with optional surrounding whitespace.
  const standalone = body.match(/^[ \t]*([0-9]{4})[ \t]*$/m);
  if (standalone) return standalone[1].trim();

  // 2. Specific contextual patterns in the decoded plain text (Spanish + English)
  const textPatterns = [
    // Spanish
    /tu\s+c[oó]digo\s+(?:de\s+acceso\s+(?:temporal\s+)?)?(?:es[:\s]+)?([0-9]{4})\b/i,
    /c[oó]digo\s+(?:de\s+acceso\s+)?(?:temporal\s+)?(?:es[:\s]+)?([0-9]{4})\b/i,
    /c[oó]digo[:\s]+([0-9]{4})\b/i,
    /acceso\s+temporal[^0-9]{0,40}([0-9]{4})\b/i,
    /temporal[^0-9]{0,20}([0-9]{4})\b/i,
    // English
    /your\s+(?:temporary\s+)?(?:access\s+)?code\s+is[:\s]+([0-9]{4})\b/i,
    /temporary\s+access\s+code[:\s]+([0-9]{4})\b/i,
    /\baccess\s+code[:\s]+([0-9]{4})\b/i,
    /\bcode[:\s]+([0-9]{4})\b/i,
  ];
  for (const p of textPatterns) {
    const m = body.match(p);
    if (m) return m[1].trim();
  }

  // 3. Structural HTML patterns — Netflix puts the code alone inside a styled element
  if (rawHtml) {
    const htmlPatterns = [
      // Standalone 4-digit number as the only content of a block element
      /<(?:td|th|p|div|span|h\d)[^>]*>\s*([0-9]{4})\s*<\/(?:td|th|p|div|span|h\d)>/i,
      // Large font-size element (Netflix renders the code at ≥36px)
      /font-size\s*:\s*(?:[3-9]\d|[1-9]\d{2,})px[^>]*>\s*([0-9]{4})\s*</i,
      // Letter-spacing or tracking hint — typically only on the code
      /letter-spacing[^>]*>\s*([0-9]{4})\s*</i,
    ];
    for (const p of htmlPatterns) {
      const m = rawHtml.match(p);
      if (m) return m[1].trim();
    }
  }

  // Do NOT use a bare /\b\d{4}\b/ fallback — it grabs years (2025, 2026),
  // phone suffixes, and other false positives. Return null so the caller
  // can fall back to fetchCodeFromNetflixLink which is far more reliable.
  return null;
}

export function extractExpiry(body: string): string {
  // Allow non-breaking spaces / garbled UTF-8 bytes between the number and unit
  const m = body.match(
    /(?:vence|expires?|v[aá]lido)[^0-9]*(\d+)[^a-z]*?(minutos?|minutes?|hours?|horas?)/i
  );
  if (m) return `${m[1]} ${m[2]}`;
  return "15 minutos";
}
