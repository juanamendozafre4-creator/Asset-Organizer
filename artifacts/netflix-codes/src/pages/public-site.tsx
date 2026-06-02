import { useParams } from "wouter";
import { useGetSiteInfo, getGetSiteInfoQueryKey } from "@workspace/api-client-react";
import { Loader2, AlertCircle, Radio, Volume2 } from "lucide-react";
import { NetflixCodeCard } from "@/components/netflix-code-card";
import { useSiteCodesStream } from "@/hooks/useSiteCodesStream";
import { useSpeechNotification } from "@/hooks/useSpeechNotification";
import {
  isDark,
  getTextColor,
  getMutedTextColor,
  getCardBg,
  getCardBorder,
  getLogoBg,
} from "@/lib/color-utils";

function LiveBadge({
  status,
  textColor,
  mutedColor,
}: {
  status: "connecting" | "live" | "reconnecting" | "error";
  textColor: string;
  mutedColor: string;
}) {
  if (status === "live") {
    return (
      <div className="flex items-center gap-1.5 text-xs" style={{ color: mutedColor }}>
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
        En vivo
      </div>
    );
  }
  if (status === "reconnecting") {
    return (
      <div className="flex items-center gap-1.5 text-xs" style={{ color: mutedColor }}>
        <Radio className="w-3.5 h-3.5 animate-pulse" />
        Reconectando…
      </div>
    );
  }
  if (status === "connecting") {
    return (
      <div className="flex items-center gap-1.5 text-xs" style={{ color: mutedColor }}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Conectando…
      </div>
    );
  }
  return null;
}

export default function PublicSite() {
  const { slug } = useParams<{ slug: string }>();

  const { data: site, isLoading: isLoadingSite, error: siteError } = useGetSiteInfo(slug, {
    query: {
      retry: false,
      queryKey: getGetSiteInfoQueryKey(slug),
    }
  });

  const { codes, status, isLoading: isLoadingCodes, imapError } = useSiteCodesStream(
    site ? slug : undefined
  );

  const { needsUnlock, unlock } = useSpeechNotification(codes);

  if (isLoadingSite) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (siteError || !site) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background p-4 text-center">
        <AlertCircle className="w-16 h-16 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground mb-2">
          Sitio no encontrado
        </h1>
        <p className="text-muted-foreground">
          El portal de acceso solicitado no existe o ha sido eliminado.
        </p>
      </div>
    );
  }

  const themeColor = site.themeColor || "#141414";
  const dark = isDark(themeColor);
  const textColor = getTextColor(themeColor);
  const mutedColor = getMutedTextColor(themeColor);
  const cardBg = getCardBg(themeColor);
  const cardBorder = getCardBorder(themeColor);
  const logoBg = getLogoBg(themeColor);
  const headerBg = dark ? "rgba(0,0,0,0.30)" : "rgba(255,255,255,0.30)";
  const dividerColor = cardBorder;

  return (
    <div
      className="min-h-[100dvh] flex flex-col"
      style={{ background: themeColor, color: textColor }}
    >
      <header
        className="py-6 px-4 md:py-10 border-b"
        style={{ borderColor: dividerColor, background: headerBg }}
      >
        <div className="container mx-auto max-w-3xl flex flex-col items-center text-center">
          {site.logoUrl && (
            <div
              className="w-16 h-16 md:w-20 md:h-20 mb-4 rounded-xl overflow-hidden flex items-center justify-center shadow-lg"
              style={{ background: logoBg }}
            >
              <img
                src={site.logoUrl}
                alt={site.name}
                className="max-w-full max-h-full object-contain"
                style={{ mixBlendMode: dark ? "screen" : "multiply" }}
              />
            </div>
          )}
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: textColor }}>
            {site.name}
          </h1>
          <p className="mt-1 font-mono text-sm" style={{ color: mutedColor }}>
            Códigos de Acceso
          </p>
          {site.description && (
            <p
              className="mt-3 text-sm leading-relaxed max-w-md whitespace-pre-line"
              style={{ color: mutedColor }}
            >
              {site.description}
            </p>
          )}
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-medium" style={{ color: mutedColor }}>
            Solicitudes Recientes
          </h2>
          <LiveBadge status={status} textColor={textColor} mutedColor={mutedColor} />
        </div>

        {isLoadingCodes ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: mutedColor }} />
          </div>
        ) : imapError ? (
          <div
            className="flex-1 flex flex-col items-center justify-center py-20 text-center rounded-xl border-2 border-dashed"
            style={{ borderColor: cardBorder }}
          >
            <AlertCircle className="w-8 h-8 mb-3" style={{ color: mutedColor }} />
            <p className="text-sm" style={{ color: mutedColor }}>{imapError}</p>
          </div>
        ) : codes.length > 0 ? (
          <div className="space-y-6">
            {codes.map((code) => (
              <NetflixCodeCard
                key={code.id}
                code={code}
                themeColor={themeColor}
                dark={dark}
                textColor={textColor}
                mutedColor={mutedColor}
                cardBg={cardBg}
                cardBorder={cardBorder}
              />
            ))}
          </div>
        ) : (
          <div
            className="flex-1 flex flex-col items-center justify-center py-20 text-center rounded-xl border-2 border-dashed"
            style={{ borderColor: cardBorder }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
              style={{ background: cardBg }}
            >
              <AlertCircle className="w-6 h-6" style={{ color: mutedColor }} />
            </div>
            <h3 className="text-lg font-medium mb-1" style={{ color: textColor }}>
              No hay solicitudes
            </h3>
            <p className="text-sm max-w-sm" style={{ color: mutedColor }}>
              No se han detectado solicitudes de código de acceso temporal de Netflix. Aparecerán aquí automáticamente.
            </p>
          </div>
        )}
      </main>

      {needsUnlock && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center p-4 pb-safe"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
        >
          <button
            onClick={unlock}
            className="flex items-center gap-2.5 px-6 py-3.5 rounded-full font-semibold text-sm shadow-2xl active:scale-95 transition-transform select-none"
            style={{
              background: themeColor,
              color: textColor,
              border: `1.5px solid ${cardBorder}`,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <Volume2 className="w-4 h-4 shrink-0" />
            Toca para activar las notificaciones de voz
          </button>
        </div>
      )}
    </div>
  );
}
