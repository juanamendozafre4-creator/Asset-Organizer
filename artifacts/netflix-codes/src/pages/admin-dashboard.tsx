import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useListSites, getListSitesQueryKey, useDeleteSite, useTestSiteConnection, Site } from "@workspace/api-client-react";
import { getAdminToken, getAdminHeaders, removeAdminToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Plus, LogOut, Trash2, Edit2, Play, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import SiteFormDialog from "@/components/site-form-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const token = getAdminToken();

  useEffect(() => {
    if (!token) {
      setLocation("/admin");
    }
  }, [token, setLocation]);

  const { data: sites, isLoading } = useListSites({
    query: {
      queryKey: getListSitesQueryKey(),
      enabled: !!token,
    },
    request: {
      headers: getAdminHeaders(),
    },
  });

  const deleteSite = useDeleteSite({ request: { headers: getAdminHeaders() } });
  const testConnection = useTestSiteConnection({ request: { headers: getAdminHeaders() } });

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | undefined>();
  const [siteToDelete, setSiteToDelete] = useState<number | null>(null);

  const handleLogout = () => {
    removeAdminToken();
    setLocation("/admin");
  };

  const handleDelete = (id: number) => {
    deleteSite.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Site deleted" });
          queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
          setSiteToDelete(null);
        },
        onError: () => {
          toast({ title: "Failed to delete site", variant: "destructive" });
        },
      }
    );
  };

  const handleTestConnection = (id: number) => {
    toast({ title: "Probando conexión...", description: "Por favor espera." });

    testConnection.mutate(
      { id },
      {
        onSuccess: (data) => {
          if (data.success) {
            toast({ title: "Conexión exitosa", description: data.message });
          } else {
            toast({ title: "Conexión fallida", description: data.message, variant: "destructive" });
          }
        },
        onError: () => {
          toast({ title: "Error", description: "No se pudo probar la conexión", variant: "destructive" });
        },
      }
    );
  };

  if (!token) return null;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50 sticky top-0 z-10">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between max-w-6xl">
          <h1 className="font-bold text-xl tracking-tight">Nexus Admin</h1>
          <div className="flex items-center gap-4">
            <Button
              onClick={() => {
                setEditingSite(undefined);
                setIsFormOpen(true);
              }}
              data-testid="button-create-site"
              size="sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Site
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <h2 className="text-2xl font-bold tracking-tight">Managed Sites</h2>
          <p className="text-muted-foreground">Configure client sites and IMAP connections.</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : sites?.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-lg">
            <h3 className="text-lg font-medium">No sites created</h3>
            <p className="text-muted-foreground mb-4">Get started by creating your first site.</p>
            <Button onClick={() => setIsFormOpen(true)}>Create Site</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sites?.map((site) => (
              <Card key={site.id} className="flex flex-col border-border bg-card" data-testid={`card-site-${site.id}`}>
                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{site.name}</CardTitle>
                      <CardDescription className="text-xs font-mono mt-1">/{site.slug}</CardDescription>
                    </div>
                    {site.logoUrl && (
                      <div className="w-10 h-10 rounded-md overflow-hidden bg-muted flex items-center justify-center shrink-0">
                        <img src={site.logoUrl} alt={site.name} className="max-w-full max-h-full object-contain" />
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col justify-between">
                  <div className="space-y-2 mb-6 text-sm text-muted-foreground">
                    <div className="flex justify-between">
                      <span>IMAP:</span>
                      <span className="truncate ml-2">{site.imapHost}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Email:</span>
                      <span className="truncate ml-2">{site.imapEmail}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between pt-4 border-t border-border/50">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditingSite(site);
                          setIsFormOpen(true);
                        }}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive border-transparent hover:border-destructive/20"
                        onClick={() => setSiteToDelete(site.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 text-xs font-medium"
                        onClick={() => handleTestConnection(site.id)}
                        disabled={testConnection.isPending}
                      >
                        <Play className="h-3 w-3 mr-1.5" />
                        Test
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        className="h-8 text-xs font-medium"
                        onClick={() => window.open(`/${site.slug}`, '_blank')}
                      >
                        <ExternalLink className="h-3 w-3 mr-1.5" />
                        Visit
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <SiteFormDialog
        isOpen={isFormOpen}
        onOpenChange={setIsFormOpen}
        siteToEdit={editingSite}
      />

      <AlertDialog open={!!siteToDelete} onOpenChange={(open) => !open && setSiteToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the site and all its configuration. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => siteToDelete && handleDelete(siteToDelete)}
              disabled={deleteSite.isPending}
            >
              {deleteSite.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
