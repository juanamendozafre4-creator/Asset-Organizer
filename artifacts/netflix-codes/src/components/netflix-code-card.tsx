import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import type { NetflixCode } from "@workspace/api-client-react";
import { MonitorSmartphone, Clock } from "lucide-react";

export function NetflixCodeCard({ code }: { code: NetflixCode }) {
  const isPending = !code.code;

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
            Hola, {code.profileName}
          </h2>
          
          <div className="flex items-start sm:items-center gap-2 text-sm text-muted-foreground mt-2">
            <MonitorSmartphone className="h-4 w-4 shrink-0 mt-0.5 sm:mt-0" />
            <p className="leading-snug">{code.deviceInfo}</p>
          </div>
        </div>

        <div className="pt-2">
          {isPending ? (
            <div className="w-full bg-primary/10 border border-primary/20 rounded-xl py-6 flex items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-shimmer" style={{ backgroundSize: '200% 100%' }} />
              <p className="text-primary font-medium tracking-wide">Extrayendo código...</p>
            </div>
          ) : (
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
              
              {code.expiresIn && (
                <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <p>* El enlace vence en {code.expiresIn}</p>
                </div>
              )}
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
