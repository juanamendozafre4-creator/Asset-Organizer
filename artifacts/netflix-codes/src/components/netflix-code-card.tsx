import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import type { NetflixCode } from "@workspace/api-client-react";
import { MonitorSmartphone, ExternalLink, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const CODE_TTL_MS = 15 * 60 * 1000;

function cleanText(text: string): string {
  return text.replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

export function NetflixCodeCard({ code }: { code: NetflixCode }) {
  const expired = Date.now() - parseISO(code.receivedAt).getTime() > CODE_TTL_MS;

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
            <div className="w-full border border-destructive/30 bg-destructive/5 rounded-xl py-6 px-4 flex flex-col items-center justify-center gap-2">
              <XCircle className="h-7 w-7 text-destructive/70" />
              <p className="text-destructive/80 font-semibold text-base">Código vencido</p>
              <p className="text-xs text-muted-foreground">El enlace expiró (más de 15 minutos)</p>
            </div>
          ) : (
            <div className="w-full border border-border rounded-xl py-6 px-4 flex flex-col items-center justify-center gap-3 bg-muted/30">
              <p className="text-sm text-muted-foreground text-center">
                Toca el botón para obtener tu código de acceso
              </p>
              <Button
                asChild
                size="lg"
                className="bg-[#E50914] hover:bg-[#b8070f] text-white font-semibold px-8"
              >
                <a href={code.netflixLink ?? "https://www.netflix.com"} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Obtener código en Netflix
                </a>
              </Button>
              <p className="text-xs text-muted-foreground">Válido por 15 minutos desde que llegó el correo</p>
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
