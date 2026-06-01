import { useParams } from "wouter";
import { 
  useGetSiteInfo, 
  useListSiteCodes, 
  getListSiteCodesQueryKey,
  getGetSiteInfoQueryKey
} from "@workspace/api-client-react";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
          Site Not Found
        </h1>
        <p className="text-muted-foreground">
          The requested access portal does not exist or has been removed.
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
          <p className="text-muted-foreground mt-2 font-mono text-sm">Access Codes</p>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-medium text-muted-foreground">Recent Access Requests</h2>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => refetch()}
            disabled={isRefetching || isLoadingCodes}
            className="h-8"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {isLoadingCodes ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary/50" />
          </div>
        ) : codes && codes.length > 0 ? (
          <div className="space-y-6">
            {codes.map((code) => (
              <Card 
                key={code.id} 
                className="overflow-hidden border-border bg-card shadow-md relative"
                data-testid={`card-netflix-${code.id}`}
              >
                <div className="p-5 md:p-6 flex flex-col md:flex-row gap-6 md:items-center">
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Requested by</p>
                    <p className="text-xl font-bold">Hello, {code.profileName}</p>
                    <p className="text-sm text-muted-foreground mt-2 bg-muted/50 inline-block px-2 py-1 rounded">
                      {code.deviceInfo}
                    </p>
                    <p className="text-xs text-muted-foreground mt-4">
                      Received: {new Date(code.receivedAt).toLocaleString()}
                    </p>
                  </div>
                  
                  <div className="md:w-64 shrink-0 flex flex-col items-center justify-center p-6 bg-secondary/50 rounded-xl border border-border/50">
                    <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Access Code</p>
                    
                    {code.code ? (
                      <div className="w-full text-center">
                        <div 
                          className="text-4xl md:text-5xl font-black text-primary tracking-widest leading-none drop-shadow-md"
                          data-testid={`text-code-${code.id}`}
                          style={{ fontFamily: "monospace" }}
                        >
                          {code.code}
                        </div>
                      </div>
                    ) : (
                      <div className="w-full text-center h-[50px] flex items-center justify-center">
                        <p className="text-primary font-medium flex items-center animate-pulse">
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Extracting...
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                
                {code.expiresIn && (
                  <div className="bg-muted/30 px-6 py-3 border-t border-border/50 text-xs text-muted-foreground text-center md:text-left">
                    * This link expires in {code.expiresIn}
                  </div>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-border/50 rounded-xl">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <AlertCircle className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-1">No requests found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              We haven't detected any recent Netflix access code requests for this account. They will appear here automatically.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
