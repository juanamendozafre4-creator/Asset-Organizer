import { google } from "googleapis";
import { logger } from "./logger";

const CONNECTION_ID = process.env.GMAIL_CONNECTION_ID;
const CONNECTORS_HOSTNAME = process.env.REPLIT_CONNECTORS_HOSTNAME;
const REPL_IDENTITY = process.env.REPL_IDENTITY;
const WEB_REPL_RENEWAL = process.env.WEB_REPL_RENEWAL;

export async function getGmailClient() {
  if (!CONNECTION_ID || !CONNECTORS_HOSTNAME) {
    throw new Error("Gmail integration not configured. Please connect Gmail first.");
  }

  const tokenEndpoint = `https://${CONNECTORS_HOSTNAME}/api/v2/connection/${CONNECTION_ID}/token`;

  const headers: Record<string, string> = {};
  if (REPL_IDENTITY) headers["X-Replit-Identity"] = REPL_IDENTITY;
  if (WEB_REPL_RENEWAL) headers["X-Replit-Identity-Renewal"] = WEB_REPL_RENEWAL;

  const resp = await fetch(tokenEndpoint, { headers });
  if (!resp.ok) {
    const text = await resp.text();
    logger.error({ status: resp.status, text }, "Failed to get Gmail token from connector");
    throw new Error("Failed to get Gmail OAuth token from connector proxy");
  }

  const tokenData = await resp.json() as { access_token: string };
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: tokenData.access_token });
  return google.gmail({ version: "v1", auth });
}

export function isGmailConfigured(): boolean {
  return !!(CONNECTION_ID && CONNECTORS_HOSTNAME);
}

export async function getConnectedEmail(): Promise<string | null> {
  try {
    const gmail = await getGmailClient();
    const profile = await gmail.users.getProfile({ userId: "me" });
    return profile.data.emailAddress ?? null;
  } catch {
    return null;
  }
}
