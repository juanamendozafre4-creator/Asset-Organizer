import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useCreateSite, useUpdateSite, getListSitesQueryKey, Site } from "@workspace/api-client-react";
import { getAdminHeaders } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

const siteSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  slug: z.string().min(1, "El slug es requerido").regex(/^[a-z0-9-]+$/, "Solo letras minúsculas, números y guiones"),
  logoUrl: z.string().url("Debe ser una URL válida").optional().or(z.literal("")),
  imapHost: z.string().min(1, "El host IMAP es requerido"),
  imapEmail: z.string().min(1, "El correo es requerido"),
  imapPassword: z.string().optional(),
});

type SiteFormValues = z.infer<typeof siteSchema>;

interface SiteFormDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  siteToEdit?: Site;
}

export default function SiteFormDialog({ isOpen, onOpenChange, siteToEdit }: SiteFormDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createSite = useCreateSite({ request: { headers: getAdminHeaders() } });
  const updateSite = useUpdateSite({ request: { headers: getAdminHeaders() } });

  const isEditing = !!siteToEdit;

  const form = useForm<SiteFormValues>({
    resolver: zodResolver(siteSchema),
    defaultValues: {
      name: "",
      slug: "",
      logoUrl: "",
      imapHost: "",
      imapEmail: "",
      imapPassword: "",
    },
  });

  useEffect(() => {
    if (isOpen) {
      if (siteToEdit) {
        form.reset({
          name: siteToEdit.name,
          slug: siteToEdit.slug,
          logoUrl: siteToEdit.logoUrl || "",
          imapHost: siteToEdit.imapHost,
          imapEmail: siteToEdit.imapEmail,
          imapPassword: "",
        });
      } else {
        form.reset({
          name: "",
          slug: "",
          logoUrl: "",
          imapHost: "",
          imapEmail: "",
          imapPassword: "",
        });
      }
    }
  }, [isOpen, siteToEdit, form]);

  const onSubmit = (values: SiteFormValues) => {
    const data = {
      ...values,
      logoUrl: values.logoUrl || null,
    };

    if (isEditing) {
      if (!values.imapPassword) {
        delete (data as any).imapPassword;
      }
      
      updateSite.mutate(
        { id: siteToEdit.id, data },
        {
          onSuccess: () => {
            toast({ title: "Sitio actualizado correctamente" });
            queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
            onOpenChange(false);
          },
          onError: (err: any) => {
            toast({ title: "Error al actualizar", description: err.error || "Ocurrió un error", variant: "destructive" });
          },
        }
      );
    } else {
      if (!values.imapPassword) {
        form.setError("imapPassword", { message: "La contraseña es requerida para nuevos sitios" });
        return;
      }

      createSite.mutate(
        { data: data as any },
        {
          onSuccess: () => {
            toast({ title: "Sitio creado correctamente" });
            queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
            onOpenChange(false);
          },
          onError: (err: any) => {
            toast({ title: "Error al crear", description: err.error || "Ocurrió un error", variant: "destructive" });
          },
        }
      );
    }
  };

  const isPending = createSite.isPending || updateSite.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar Sitio" : "Crear Nuevo Sitio"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Actualiza la configuración de este sitio."
              : "Configura un nuevo sitio y su conexión IMAP."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre del Sitio</FormLabel>
                    <FormControl>
                      <Input placeholder="Mi Sitio" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="slug"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Slug URL</FormLabel>
                    <FormControl>
                      <Input placeholder="mi-sitio" data-testid="input-slug" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="logoUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL del Logo (Opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="https://ejemplo.com/logo.png" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="border-t border-border pt-4 mt-4">
              <h4 className="font-medium text-sm mb-3 text-muted-foreground">Configuración IMAP</h4>
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="imapHost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Host IMAP</FormLabel>
                      <FormControl>
                        <Input placeholder="imap.gmail.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="imapEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Correo Electrónico</FormLabel>
                        <FormControl>
                          <Input placeholder="cliente@gmail.com" type="text" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="imapPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contraseña de App</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={isEditing ? "(sin cambios)" : "••••••••"}
                            type="password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4 gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? "Guardar Cambios" : "Crear Sitio"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
