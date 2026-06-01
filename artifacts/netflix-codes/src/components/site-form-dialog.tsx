import { useEffect, useRef, useState, useCallback } from "react";
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
import { getAdminHeaders, getAdminToken } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload, X, ImageIcon } from "lucide-react";

const siteSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  slug: z.string().min(1, "El slug es requerido").regex(/^[a-z0-9-]+$/, "Solo letras minúsculas, números y guiones"),
  logoUrl: z.string().optional().or(z.literal("")),
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);

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
        setLogoPreview(siteToEdit.logoUrl || "");
      } else {
        form.reset({ name: "", slug: "", logoUrl: "", imapHost: "", imapEmail: "", imapPassword: "" });
        setLogoPreview("");
      }
    }
  }, [isOpen, siteToEdit, form]);

  const uploadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Solo se permiten imágenes", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "La imagen no puede superar 5MB", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const token = getAdminToken();
      const res = await fetch("/api/admin/upload-logo", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) throw new Error("Error al subir imagen");
      const { url } = await res.json();
      form.setValue("logoUrl", url);
      setLogoPreview(url);
      toast({ title: "Logo subido correctamente" });
    } catch {
      toast({ title: "Error al subir el logo", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }, [form, toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) { uploadFile(file); break; }
      }
    }
  }, [uploadFile]);

  const handleClearLogo = () => {
    setLogoPreview("");
    form.setValue("logoUrl", "");
  };

  const onSubmit = (values: SiteFormValues) => {
    const data = { ...values, logoUrl: values.logoUrl || null };

    if (isEditing) {
      if (!values.imapPassword) delete (data as any).imapPassword;
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
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" onPaste={handlePaste}>
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

            {/* Logo upload */}
            <div className="space-y-2">
              <FormLabel>Logo (Opcional)</FormLabel>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />

              {logoPreview ? (
                <div className="relative w-full flex items-center gap-3 p-3 border border-border rounded-lg bg-muted/30">
                  <img
                    src={logoPreview}
                    alt="Logo"
                    className="w-14 h-14 object-contain rounded-md border border-border bg-background"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">Logo cargado</p>
                    <p className="text-xs text-muted-foreground truncate">{form.watch("logoUrl")}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={handleClearLogo}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div
                  className="w-full border-2 border-dashed border-border rounded-lg p-5 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isUploading ? (
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  ) : (
                    <ImageIcon className="h-7 w-7 text-muted-foreground" />
                  )}
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">
                      {isUploading ? "Subiendo..." : "Haz clic o pega una imagen"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      PNG, JPG, SVG hasta 5MB · También puedes pegar con Ctrl+V
                    </p>
                  </div>
                  {!isUploading && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-1"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    >
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      Seleccionar archivo
                    </Button>
                  )}
                </div>
              )}
            </div>

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
              <Button type="submit" disabled={isPending || isUploading}>
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
