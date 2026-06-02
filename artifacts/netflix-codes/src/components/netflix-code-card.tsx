import { useState, useEffect } from "react";
import { parseISO } from "date-fns";
import type { NetflixCode } from "@workspace/api-client-react";
import { MonitorSmartphone, XCircle, HelpCircle, Mail, Clock } from "lucide-react";

const CODE_TTL_MS = 15 * 60 * 1000;
const COLOMBIA_TZ = "America/Bogota";

function cleanText(text: string): string {
  return text.replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

/** Formatea una fecha en zona Colombia. Ej: "2 de junio, 3:07 a. m." */
function formatColombiaTime(isoString: string): string {
  const date = parseISO(isoString);
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: COLOMBIA_TZ,
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** Devuelve milisegundos restantes antes del vencimiento (puede ser negativo). */
function msRemaining(receivedAt: string): number {
  const expiry = parseISO(receivedAt).getTime() + CODE_TTL_MS;
  return expiry - Date.now();
}

/** Convierte ms a texto "MM:SS". Si <= 0 devuelve "00:00". */
function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Hook que actualiza el tiempo restante cada segundo. */
function useCountdown(receivedAt: string) {
  const [remaining, setRemaining] = useState(() => msRemaining(receivedAt));

  useEffect(() => {
    setRemaining(msRemaining(receivedAt));
    const id = setInterval(() => {
      const r = msRemaining(receivedAt);
      setRemaining(r);
      if (r <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [receivedAt]);

  return remaining;
}

/** Devuelve texto "hace X segundos/minutos/horas" a partir de una fecha ISO. */
function formatTimeAgo(isoString: string): string {
  const elapsed = Date.now() - parseISO(isoString).getTime();
  const sec = Math.floor(elapsed / 1000);
  if (sec < 5) return "justo ahora";
  if (sec < 60) return `hace ${sec} segundo${sec !== 1 ? "s" : ""}`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} minuto${min !== 1 ? "s" : ""}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} hora${hr !== 1 ? "s" : ""}`;
  const days = Math.floor(hr / 24);
  return `hace ${days} día${days !== 1 ? "s" : ""}`;
}

/** Hook que actualiza el texto "hace X" en tiempo real. */
function useTimeAgo(receivedAt: string) {
  const [label, setLabel] = useState(() => formatTimeAgo(receivedAt));

  useEffect(() => {
    setLabel(formatTimeAgo(receivedAt));
    const elapsed = Date.now() - parseISO(receivedAt).getTime();
    // Actualizar cada segundo mientras sea < 2 minutos, luego cada 30s
    const interval = elapsed < 2 * 60 * 1000 ? 1000 : 30_000;
    const id = setInterval(() => setLabel(formatTimeAgo(receivedAt)), interval);
    return () => clearInterval(id);
  }, [receivedAt]);

  return label;
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
  const remaining = useCountdown(code.receivedAt);
  const timeAgo = useTimeAgo(code.receivedAt);

  const expiredByTime = remaining <= 0;
  const expiredByServer = code.code === "EXPIRED";
  const isExpired = expiredByTime || expiredByServer;
  const hasCode = code.code && code.code !== "EXPIRED";

  const codeBlockBg = dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)";
  const footerBg = dark ? "rgba(0,0,0,0.20)" : "rgba(0,0,0,0.04)";
  const expiredBg = dark ? "rgba(220,38,38,0.12)" : "rgba(220,38,38,0.06)";
  const expiredBorder = dark ? "rgba(220,38,38,0.30)" : "rgba(220,38,38,0.25)";
  const unavailableBg = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";

  // Countdown color: green > 5min, yellow 2-5min, red < 2min
  const countdownColor =
    remaining > 5 * 60 * 1000
      ? "#4ade80"
      : remaining > 2 * 60 * 1000
      ? "#facc15"
      : "#f87171";

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
              {/* Contador regresivo */}
              <div
                className="mt-4 flex items-center gap-1.5 text-sm font-semibold tabular-nums"
                style={{ color: countdownColor }}
              >
                <Clock className="h-4 w-4" />
                <span>Vence en {formatCountdown(remaining)}</span>
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

      {/* Pie — tiempo relativo + hora exacta */}
      <div
        className="px-6 py-3 border-t flex items-center justify-between text-xs"
        style={{ background: footerBg, borderColor: cardBorder, color: mutedColor }}
      >
        <span
          className="font-semibold tabular-nums transition-all duration-500"
          title={formatColombiaTime(code.receivedAt)}
        >
          {timeAgo}
        </span>
        <time dateTime={code.receivedAt}>
          {formatColombiaTime(code.receivedAt)}
        </time>
      </div>
    </div>
  );
}
