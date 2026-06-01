import { Router, type IRouter } from "express";
import {
  isGmailConfigured,
  getConnectedEmail,
  fetchNetflixEmails,
} from "../lib/gmail";
import {
  GetNetflixCodesResponse,
  GetAuthStatusResponse,
  GetNetflixCodesQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function extractProfileName(body: string): string {
  const match = body.match(/Hola[,\s]+([^\n<,\r]+)/i);
  if (match) return match[1].trim().replace(/\s+/g, " ");
  const match2 = body.match(/Hello[,\s]+([^\n<,\r]+)/i);
  if (match2) return match2[1].trim();
  return "Usuario";
}

function extractDeviceInfo(body: string): string {
  // Pattern: "Solicitud de 1 desde: PC Chrome - Navegador web a las 31 de mayo, 4:50 p. m. GMT-7"
  const fullMatch = body.match(
    /Solicitud de \d+ desde[:\s]+(.+?)\s+a las\s+([^\n<\r]+)/i
  );
  if (fullMatch) {
    return `Solicitud desde: ${fullMatch[1].trim()} — ${fullMatch[2].trim()}`;
  }
  const deviceOnly = body.match(/Solicitud de \d+ desde[:\s]+([^\n<\r]+)/i);
  if (deviceOnly) return `Solicitud desde: ${deviceOnly[1].trim()}`;
  const reqFrom = body.match(/request (?:is )?from[:\s]+([^\n<\r]+)/i);
  if (reqFrom) return `Request from: ${reqFrom[1].trim()}`;
  return "Información del dispositivo no disponible";
}

function extractCode(body: string): string | null {
  // Netflix codes are typically 4-8 alphanumeric chars shown prominently
  const patterns = [
    // After "Tu código es" or similar
    /tu\s+c[oó]digo\s+(?:de\s+acceso\s+(?:temporal\s+)?)?(?:es[:\s]+)?([A-Z0-9]{4,8})/i,
    // Standalone code block (6-8 digits or mixed)
    /\b([A-Z]{1,2}[0-9]{4,6})\b/,
    /\b([0-9]{6,8})\b/,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function extractExpiry(body: string): string | null {
  const match = body.match(
    /(?:vence|expires?|v[aá]lido)[^\d]*(\d+)\s*(minutos?|minutes?|hours?|horas?)/i
  );
  if (match) return `${match[1]} ${match[2]}`;
  return "15 minutos";
}

function decodeEmailBody(source: string): string {
  // Extract plain text or html from raw email source
  const plainMatch = source.match(
    /Content-Type: text\/plain[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]+?)(?=\r?\n--|\r?\n\r?\n--)/i
  );
  if (plainMatch) return plainMatch[1];

  const htmlMatch = source.match(
    /Content-Type: text\/html[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]+?)(?=\r?\n--)/i
  );
  if (htmlMatch) {
    return htmlMatch[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ");
  }

  // Fallback: strip all tags from full source
  return source.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

router.get("/netflix/auth-status", async (req, res): Promise<void> => {
  if (!isGmailConfigured()) {
    res.json(GetAuthStatusResponse.parse({ connected: false, email: null }));
    return;
  }
  const email = await getConnectedEmail();
  res.json(GetAuthStatusResponse.parse({ connected: !!email, email }));
});

router.get("/netflix/codes", async (req, res): Promise<void> => {
  if (!isGmailConfigured()) {
    res
      .status(401)
      .json({ error: "Correo no configurado. Agrega las credenciales IMAP." });
    return;
  }

  const queryParsed = GetNetflixCodesQueryParams.safeParse(req.query);
  const limit = queryParsed.success ? (queryParsed.data.limit ?? 10) : 10;

  try {
    const rawEmails = await fetchNetflixEmails(limit);

    const results = rawEmails.map((email) => {
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

    req.log.info({ count: results.length }, "Fetched Netflix codes via IMAP");
    res.json(GetNetflixCodesResponse.parse(results));
  } catch (err) {
    req.log.error({ err }, "Error fetching Netflix codes via IMAP");
    res.status(500).json({ error: "Error al conectar con el servidor de correo. Verifica las credenciales." });
  }
});

export default router;
