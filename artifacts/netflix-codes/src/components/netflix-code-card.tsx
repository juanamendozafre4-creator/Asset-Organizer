import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import type { NetflixCode } from "@workspace/api-client-react";
import { MonitorSmartphone, XCircle, Loader2, Mail } from "lucide-react";

const CODE_TTL_MS = 15 * 60 * 1000;

function cleanText(text: string): string {
  return text.replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

export function NetflixCodeCard({ code }: { code: NetflixCode }) {
  const expired = Date.now() - parseISO(code.receivedAt).getTime() > CODE_TTL_MS;

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm"
      data-testid={`card-netflix-${code.id}`}
    >
      <div className="p-6 sm:p-8 space-y-5">
        {/* Perfil y dispositivo */}
        <div className="space-y-2">
          <h2
            className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground"
            data-testid={`text-profile-${code.id}`}
          >
            Hola, {cleanText(code.profileName)}
          </h2>

          <div className="flex items-start sm:items-center gap-2 text-base text-muted-foreground">
            <MonitorSmartphone className="h-5 w-5 shrink-0 mt-0.5 sm:mt-0" />
            <p className="leading-snug font-medium">{cleanText(code.deviceInfo)}</p>
          </div>

          {code.accountEmail && (
            <div className="flex items-center gap-2 text-base text-muted-foreground">
              <Mail className="h-5 w-5 shrink-0" />
              <p className="font-medium">{code.accountEmail}</p>
            </div>
          )}
        </div>

        {/* Código o vencido */}
        <div className="pt-1">
          {expired ? (
            <div className="w-full border border-destructive/30 bg-destructive/5 rounded-xl py-6 px-4 flex flex-col items-center gap-2">
              <XCircle className="h-7 w-7 text-destructive/70" />
              <p className="text-destructive/80 font-semibold text-base">Código vencido</p>
              <p className="text-xs text-muted-foreground">El enlace expiró (más de 15 minutos)</p>
            </div>
          ) : code.code ? (
            <div className="w-full bg-primary rounded-xl py-5 sm:py-7 px-4 flex flex-col items-center justify-center shadow-lg shadow-primary/20">
              <p className="text-primary-foreground/80 text-xs font-medium uppercase tracking-widest mb-3">
                Código de acceso temporal
              </p>
              <div
                className="text-5xl sm:text-6xl font-mono font-bold tracking-[0.25em] text-white"
                data-testid={`text-code-${code.id}`}
              >
                {code.code}
              </div>
            </div>
          ) : (
            <div className="w-full border border-border rounded-xl py-6 px-4 flex flex-col items-center gap-2 bg-muted/20">
              <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
              <p className="text-sm text-muted-foreground">Obteniendo código...</p>
            </div>
          )}
        </div>
      </div>

      {/* Pie */}
      <div className="px-6 py-3 bg-secondary/30 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
        <span>Recibido</span>
        <time dateTime={code.receivedAt}>
          {format(parseISO(code.receivedAt), "d 'de' MMMM, h:mm a", { locale: es })}
        </time>
      </div>
    </div>
  );
}
