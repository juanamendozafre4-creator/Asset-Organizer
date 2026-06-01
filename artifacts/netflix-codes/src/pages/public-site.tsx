import { useParams } from "wouter";
import { 
  useGetSiteInfo, 
  useListSiteCodes, 
  getListSiteCodesQueryKey,
  getGetSiteInfoQueryKey
} from "@workspace/api-client-react";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NetflixCodeCard } from "@/components/netflix-code-card";

export default function PublicSite() {
  const { slug } = useParams<{ slug: string }>();

  const { data: site, isLoading: isLoadingSite, error: siteError } = useGetSiteInfo(slug, {
    query: {
      retry: false,
      queryKey: getGetSiteInfoQueryKey(slug),
    }
  });

  const { 
    data: codes, 
    isLoading: isLoadingCodes,
    isRefetching,
    refetch 
  } = useListSiteCodes(slug, {
    query: {
      enabled: !!site,
      refetchInterval: 30000,
      queryKey: getListSiteCodesQueryKey(slug),
    }
  });

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

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col">
      <header className="py-6 px-4 md:py-10 border-b border-border/50 bg-card/30">
        <div className="container mx-auto max-w-3xl flex flex-col items-center text-center">
          {site.logoUrl && (
            <div className="w-16 h-16 md:w-20 md:h-20 mb-4 rounded-xl overflow-hidden bg-muted flex items-center justify-center shadow-lg">
              <img src={site.logoUrl} alt={site.name} className="max-w-full max-h-full object-cover" />
            </div>
          )}
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{site.name}</h1>
          <p className="text-muted-foreground mt-2 font-mono text-sm">Códigos de Acceso</p>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-medium text-muted-foreground">Solicitudes Recientes</h2>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => refetch()}
            disabled={isRefetching || isLoadingCodes}
            className="h-8"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </div>

        {isLoadingCodes ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary/50" />
          </div>
        ) : codes && codes.length > 0 ? (
          <div className="space-y-6">
            {codes.map((code) => (
              <NetflixCodeCard key={code.id} code={code} />
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-border/50 rounded-xl">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <AlertCircle className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-1">No hay solicitudes</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              No se han detectado solicitudes de código de acceso temporal de Netflix. Aparecerán aquí automáticamente.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
