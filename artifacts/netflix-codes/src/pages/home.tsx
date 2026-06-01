import { useGetAuthStatus, useGetNetflixCodes, getGetNetflixCodesQueryKey } from "@workspace/api-client-react";
import { RefreshCw, Mail, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NetflixCodeCard } from "@/components/netflix-code-card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const { data: authStatus, isLoading: isLoadingAuth } = useGetAuthStatus();

  const isConnected = authStatus?.connected === true;

  const {
    data: codesData,
    isLoading: isLoadingCodes,
    isRefetching,
    refetch,
  } = useGetNetflixCodes(
    undefined,
    {
      query: {
        refetchInterval: 30000,
        queryKey: getGetNetflixCodesQueryKey(),
        enabled: isConnected,
      },
    }
  );

  const codes = codesData || [];
  const sortedCodes = [...codes].sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

  if (isLoadingAuth) {
    return (
      <div className="min-h-[100dvh] bg-background text-foreground flex flex-col items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="min-h-[100dvh] bg-background text-foreground flex flex-col items-center justify-center p-6" data-testid="status-auth">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-6">
            <Mail className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Gmail no conectado</h1>
          <p className="text-muted-foreground">
            Para poder recibir y mostrar los códigos de acceso temporal, es necesario conectar una cuenta de Gmail. 
            Por favor, contacta al administrador del sistema.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground pb-20">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-6 bg-primary rounded-full" />
            <h1 className="font-semibold tracking-tight">Accesos Netflix</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center text-sm text-muted-foreground" data-testid="status-auth">
              <div className="w-2 h-2 rounded-full bg-green-500 mr-2" />
              {authStatus?.email}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={isRefetching || isLoadingCodes}
              data-testid="button-refresh"
              className="h-9 w-9 rounded-full bg-secondary/50 border-border/50 hover:bg-secondary"
            >
              <RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {isLoadingCodes && !isRefetching && codes.length === 0 ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-xl border border-border/50 bg-card p-6 space-y-4">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-full max-w-[280px]" />
                <Skeleton className="h-20 w-full rounded-lg" />
              </div>
            ))}
          </div>
        ) : sortedCodes.length > 0 ? (
          <div className="space-y-4">
            {sortedCodes.map(code => (
              <NetflixCodeCard key={code.id} code={code} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 px-6 rounded-2xl border border-dashed border-border/50 bg-card/30">
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-medium mb-2">No hay códigos recientes</h2>
            <p className="text-muted-foreground text-sm max-w-sm mx-auto">
              Los códigos de acceso temporal que lleguen al correo conectado aparecerán aquí automáticamente.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
