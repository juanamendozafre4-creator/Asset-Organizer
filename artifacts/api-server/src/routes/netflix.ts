import { Router, type IRouter } from "express";
import { getGmailClient, isGmailConfigured, getConnectedEmail } from "../lib/gmail";
import {
  GetNetflixCodesResponse,
  GetAuthStatusResponse,
  GetNetflixCodesQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const NETFLIX_SUBJECT_KEYWORD = "código de acceso temporal";
const NETFLIX_SUBJECT_KEYWORD_EN = "temporary access code";

function extractProfileName(body: string): string {
  const match = body.match(/Hola[,\s]+([^\n<,]+)/i);
  if (match) return match[1].trim();
  const match2 = body.match(/Hello[,\s]+([^\n<,]+)/i);
  if (match2) return match2[1].trim();
  return "Usuario";
}

function extractDeviceInfo(body: string): string {
  const patterns = [
    /Solicitud de \d+ desde[:\s]+(.+?)(?=\s+a las|\s+at)/i,
    /solicitud es del ([^\n<]+)/i,
    /request is from ([^\n<]+)/i,
    /(?:desde|from)[:\s]+([^\n<]+?)(?=\s+a las|\s+at|\s*<)/i,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) {
      const raw = match[1].trim().replace(/<[^>]+>/g, "").trim();
      const dateMatch = body.match(/(?:a las|at)\s+([^\n<]+)/i);
      if (dateMatch) {
        return `Solicitud desde: ${raw} — ${dateMatch[1].trim()}`;
      }
      return `Solicitud desde: ${raw}`;
    }
  }
  return "Dispositivo no identificado";
}

function extractCode(body: string): string | null {
  // Look for a 4-8 digit code that appears near "código" keyword
  const codePatterns = [
    /código[^0-9]{0,50}([A-Z0-9]{4,8})/i,
    /code[^0-9]{0,50}([A-Z0-9]{4,8})/i,
    /\b([A-Z]{2}[0-9]{4,6})\b/,
    /\b([0-9]{6,8})\b/,
  ];
  for (const pattern of codePatterns) {
    const match = body.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

function extractExpiry(body: string): string | null {
  const match = body.match(/(?:vence|expires?|válido)[^\d]*(\d+)\s*(minutos?|minutes?|hours?|horas?)/i);
  if (match) return `${match[1]} ${match[2]}`;
  return "15 minutos";
}

function decodeBase64(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const binaryString = Buffer.from(base64, "base64").toString("utf-8");
  return binaryString;
}

function extractTextFromParts(parts: any[]): string {
  let text = "";
  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      text += decodeBase64(part.body.data);
    } else if (part.mimeType === "text/html" && part.body?.data && !text) {
      const html = decodeBase64(part.body.data);
      text += html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    } else if (part.parts) {
      text += extractTextFromParts(part.parts);
    }
  }
  return text;
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
    res.status(401).json({ error: "Gmail not connected. Please connect your Gmail account first." });
    return;
  }

  const queryParsed = GetNetflixCodesQueryParams.safeParse(req.query);
  const limit = queryParsed.success ? (queryParsed.data.limit ?? 10) : 10;

  try {
    const gmail = await getGmailClient();

    const query = `subject:(${NETFLIX_SUBJECT_KEYWORD} OR ${NETFLIX_SUBJECT_KEYWORD_EN})`;

    const listResp = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: limit,
    });

    const messages = listResp.data.messages ?? [];

    const results = await Promise.all(
      messages.map(async (msg) => {
        const full = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "full",
        });

        const payload = full.data.payload;
        let bodyText = "";

        if (payload?.body?.data) {
          bodyText = decodeBase64(payload.body.data);
          if (payload.mimeType === "text/html") {
            bodyText = bodyText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
          }
        } else if (payload?.parts) {
          bodyText = extractTextFromParts(payload.parts);
        }

        const receivedAt = full.data.internalDate
          ? new Date(parseInt(full.data.internalDate)).toISOString()
          : new Date().toISOString();

        return {
          id: msg.id!,
          profileName: extractProfileName(bodyText),
          deviceInfo: extractDeviceInfo(bodyText),
          code: extractCode(bodyText),
          receivedAt,
          expiresIn: extractExpiry(bodyText),
        };
      })
    );

    req.log.info({ count: results.length }, "Fetched Netflix codes");
    res.json(GetNetflixCodesResponse.parse(results));
  } catch (err) {
    req.log.error({ err }, "Error fetching Netflix codes");
    res.status(500).json({ error: "Failed to fetch emails from Gmail" });
  }
});

export default router;
