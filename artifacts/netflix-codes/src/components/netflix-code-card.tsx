import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import type { NetflixCode } from "@workspace/api-client-react";
import { MonitorSmartphone, Clock, ExternalLink, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutos en milisegundos

function isCodeExpired(receivedAt: string): boolean {
  return Date.now() - parseISO(receivedAt).getTime() > CODE_TTL_MS;
}

function cleanText(text: string): string {
  return text.replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

export function NetflixCodeCard({ code }: { code: NetflixCode }) {
  const expired = isCodeExpired(code.receivedAt);
  const hasCode = !!code.code;
  const hasLink = !!code.netflixLink;

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border/50 bg-card transition-all hover:border-border shadow-sm hover:shadow-md"
      data-testid={`card-netflix-${code.id}`}
    >
      <div className="p-6 sm:p-8 space-y-6">
        <div className="space-y-1.5">
          <h2
            className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground"
            data-testid={`text-profile-${code.id}`}
          >
            Hola, {cleanText(code.profileName)}
          </h2>

          <div className="flex items-start sm:items-center gap-2 text-sm text-muted-foreground mt-2">
            <MonitorSmartphone className="h-4 w-4 shrink-0 mt-0.5 sm:mt-0" />
            <p className="leading-snug">{cleanText(code.deviceInfo)}</p>
          </div>
        </div>

        <div className="pt-2">
          {expired ? (
            /* ── VENCIDO ── */
            <div className="w-full border border-destructive/30 bg-destructive/5 rounded-xl py-5 px-4 flex flex-col items-center justify-center gap-2">
              <XCircle className="h-6 w-6 text-destructive/70" />
              <p className="text-destructive/80 font-semibold text-base">Código vencido</p>
              <p className="text-xs text-muted-foreground">
                El enlace de acceso ya superó los 15 minutos
              </p>
            </div>
          ) : hasCode ? (
            /* ── CÓDIGO ENCONTRADO ── */
            <div className="space-y-3">
              <div className="w-full bg-primary rounded-xl py-5 sm:py-6 px-4 flex flex-col items-center justify-center shadow-lg shadow-primary/20">
                <p className="text-primary-foreground/80 text-xs font-medium uppercase tracking-wider mb-2">
                  CÓDIGO DE ACCESO TEMPORAL
                </p>
                <div
                  className="text-4xl sm:text-5xl font-mono font-bold tracking-[0.2em] text-white"
                  data-testid={`text-code-${code.id}`}
                >
                  {code.code}
                </div>
              </div>

              <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <p>* El enlace vence en {code.expiresIn ?? "15 minutos"}</p>
              </div>
            </div>
          ) : hasLink ? (
            /* ── LINK DISPONIBLE (código pendiente) ── */
            <div className="space-y-3">
              <div className="w-full border border-border rounded-xl py-5 px-4 flex flex-col items-center justify-center gap-3 bg-muted/30">
                <p className="text-sm text-muted-foreground text-center">
                  El código se genera al hacer clic en el botón de Netflix
                </p>
                <Button
                  asChild
                  className="bg-[#E50914] hover:bg-[#b8070f] text-white font-semibold px-6"
                >
                  <a href={code.netflixLink!} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Obtener código en Netflix
                  </a>
                </Button>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <p>Enlace válido por {code.expiresIn ?? "15 minutos"}</p>
                </div>
              </div>
            </div>
          ) : (
            /* ── SIN CÓDIGO NI LINK ── */
            <div className="w-full bg-primary/10 border border-primary/20 rounded-xl py-6 flex items-center justify-center relative overflow-hidden">
              <div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-shimmer"
                style={{ backgroundSize: "200% 100%" }}
              />
              <p className="text-primary font-medium tracking-wide">
                Procesando solicitud...
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="px-6 py-3 bg-secondary/30 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
        <span>Recibido</span>
        <time dateTime={code.receivedAt}>
          {format(parseISO(code.receivedAt), "d 'de' MMMM, h:mm a", { locale: es })}
        </time>
      </div>
    </div>
  );
}
