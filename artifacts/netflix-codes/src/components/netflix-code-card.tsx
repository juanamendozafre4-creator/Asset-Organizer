import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import type { NetflixCode } from "@workspace/api-client-react";
import { MonitorSmartphone, XCircle, HelpCircle, Mail } from "lucide-react";

const CODE_TTL_MS = 15 * 60 * 1000;

function cleanText(text: string): string {
  return text.replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

interface NetflixCodeCardProps {
  code: NetflixCode;
  themeColor?: string;
  dark?: boolean;
  textColor?: string;
  mutedColor?: string;
  cardBg?: string;
  cardBorder?: string;
}

export function NetflixCodeCard({
  code,
  themeColor,
  dark = true,
  textColor = "#ffffff",
  mutedColor = "rgba(255,255,255,0.55)",
  cardBg = "rgba(255,255,255,0.07)",
  cardBorder = "rgba(255,255,255,0.10)",
}: NetflixCodeCardProps) {
  const expiredByTime = Date.now() - parseISO(code.receivedAt).getTime() > CODE_TTL_MS;
  const expiredByServer = code.code === "EXPIRED";
  const isExpired = expiredByTime || expiredByServer;
  const hasCode = code.code && code.code !== "EXPIRED";

  const codeBlockBg = dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)";
  const footerBg = dark ? "rgba(0,0,0,0.20)" : "rgba(0,0,0,0.04)";
  const expiredBg = dark ? "rgba(220,38,38,0.12)" : "rgba(220,38,38,0.06)";
  const expiredBorder = dark ? "rgba(220,38,38,0.30)" : "rgba(220,38,38,0.25)";
  const unavailableBg = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";

  return (
    <div
      className="relative overflow-hidden rounded-2xl shadow-sm"
      style={{ background: cardBg, border: `1px solid ${cardBorder}` }}
      data-testid={`card-netflix-${code.id}`}
    >
      <div className="p-6 sm:p-8 space-y-5">
        {/* Perfil y dispositivo */}
        <div className="space-y-2">
          <h2
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ color: textColor }}
            data-testid={`text-profile-${code.id}`}
          >
            Hola, {cleanText(code.profileName)}
          </h2>

          {code.deviceInfo && cleanText(code.deviceInfo) && (
            <div className="flex items-start sm:items-center gap-2 text-base" style={{ color: mutedColor }}>
              <MonitorSmartphone className="h-5 w-5 shrink-0 mt-0.5 sm:mt-0" />
              <p className="leading-snug font-medium">{cleanText(code.deviceInfo)}</p>
            </div>
          )}

          {code.accountEmail && (
            <div className="flex items-center gap-2 text-base" style={{ color: mutedColor }}>
              <Mail className="h-5 w-5 shrink-0" />
              <p className="font-medium">{code.accountEmail}</p>
            </div>
          )}
        </div>

        {/* Código / Vencido / No disponible */}
        <div className="pt-1">
          {isExpired ? (
            <div
              className="w-full rounded-xl py-6 px-4 flex flex-col items-center gap-2"
              style={{ background: expiredBg, border: `1px solid ${expiredBorder}` }}
            >
              <XCircle className="h-7 w-7" style={{ color: "rgba(220,38,38,0.75)" }} />
              <p className="font-semibold text-base" style={{ color: "rgba(220,38,38,0.85)" }}>
                Código vencido
              </p>
              <p className="text-xs" style={{ color: mutedColor }}>
                {expiredByServer ? "El enlace ya no es válido en Netflix" : "El enlace expiró (más de 15 minutos)"}
              </p>
            </div>
          ) : hasCode ? (
            <div
              className="w-full rounded-xl py-5 sm:py-7 px-4 flex flex-col items-center justify-center"
              style={{ background: codeBlockBg }}
            >
              <p
                className="text-xs font-medium uppercase tracking-widest mb-3"
                style={{ color: mutedColor }}
              >
                Código de acceso temporal
              </p>
              <div
                className="text-5xl sm:text-6xl font-mono font-bold tracking-[0.25em]"
                style={{ color: textColor }}
                data-testid={`text-code-${code.id}`}
              >
                {code.code}
              </div>
            </div>
          ) : (
            <div
              className="w-full rounded-xl py-6 px-4 flex flex-col items-center gap-2"
              style={{ background: unavailableBg, border: `1px solid ${cardBorder}` }}
            >
              <HelpCircle className="h-6 w-6" style={{ color: mutedColor }} />
              <p className="text-sm font-medium" style={{ color: mutedColor }}>
                Código no disponible
              </p>
              <p className="text-xs text-center" style={{ color: mutedColor }}>
                No se pudo leer el código desde el correo
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Pie */}
      <div
        className="px-6 py-3 border-t flex items-center justify-between text-xs"
        style={{ background: footerBg, borderColor: cardBorder, color: mutedColor }}
      >
        <span>Recibido</span>
        <time dateTime={code.receivedAt}>
          {format(parseISO(code.receivedAt), "d 'de' MMMM, h:mm a", { locale: es })}
        </time>
      </div>
    </div>
  );
}
