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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useCreateSite, useUpdateSite, getListSitesQueryKey, Site } from "@workspace/api-client-react";
import { getAdminHeaders, getAdminToken } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload, X, ImageIcon, Eye, MonitorSmartphone, Volume2, RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { isDark, getTextColor, getMutedTextColor, getCardBg, getCardBorder, getLogoBg } from "@/lib/color-utils";

const PRESET_COLORS = [
  { hex: "#141414", label: "Negro Netflix" },
  { hex: "#E50914", label: "Rojo Netflix" },
  { hex: "#0f172a", label: "Azul oscuro" },
  { hex: "#0f4c75", label: "Azul océano" },
  { hex: "#1b4332", label: "Verde oscuro" },
  { hex: "#3b0764", label: "Morado" },
  { hex: "#7c2d12", label: "Naranja oscuro" },
  { hex: "#1e293b", label: "Gris pizarra" },
  { hex: "#f8fafc", label: "Blanco suave" },
  { hex: "#fef3c7", label: "Crema" },
];

const DEFAULT_WELCOME_MESSAGE = "Elige el código que sea los datos de tu dispositivo y tu perfil y ponlo en tu dispositivo para seguir disfrutando de Netflix";
const DEFAULT_NEW_CODE_MESSAGE = "Llegó un código nuevo, verifica que sean los datos de tu dispositivo y tu perfil y ponlo en tu dispositivo para seguir disfrutando de Netflix";

/** Convert stored seconds → display value + unit */
function secondsToDisplay(seconds: number | null | undefined): { value: number | null; unit: "seconds" | "minutes" } {
  if (!seconds || seconds <= 0) return { value: null, unit: "minutes" };
  if (seconds % 60 === 0) return { value: seconds / 60, unit: "minutes" };
  return { value: seconds, unit: "seconds" };
}

/** Convert display value + unit → seconds for storage */
function displayToSeconds(value: number | null | undefined, unit: "seconds" | "minutes"): number | null {
  if (!value || value <= 0) return null;
  return unit === "minutes" ? value * 60 : value;
}

const siteSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  slug: z.string().min(1, "El slug es requerido").regex(/^[a-z0-9-]+$/, "Solo letras minúsculas, números y guiones"),
  logoUrl: z.string().optional().or(z.literal("")),
  description: z.string().max(500, "Máximo 500 caracteres").optional().or(z.literal("")),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido").default("#141414"),
  imapHost: z.string().min(1, "El host IMAP es requerido"),
  imapEmail: z.string().min(1, "El correo es requerido"),
  imapPassword: z.string().optional(),
  welcomeMessage: z.string().max(600, "Máximo 600 caracteres").optional().or(z.literal("")),
  newCodeMessage: z.string().max(600, "Máximo 600 caracteres").optional().or(z.literal("")),
  repeatIntervalValue: z.coerce.number().int().min(0).max(86400).optional().nullable(),
  repeatIntervalUnit: z.enum(["seconds", "minutes"]).default("minutes"),
  voiceWelcomeEnabled: z.boolean().default(true),
  voiceNewCodeEnabled: z.boolean().default(true),
});

type SiteFormValues = z.infer<typeof siteSchema>;

interface SiteFormDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  siteToEdit?: Site;
}

function SitePreview({ name, logoUrl, themeColor }: { name: string; logoUrl: string; themeColor: string }) {
  const dark = isDark(themeColor);
  const textColor = getTextColor(themeColor);
  const mutedColor = getMutedTextColor(themeColor);
  const cardBg = getCardBg(themeColor);
  const cardBorder = getCardBorder(themeColor);
  const logoBg = getLogoBg(themeColor);

  return (
    <div className="rounded-xl overflow-hidden border border-border/50 select-none" style={{ background: themeColor, minHeight: 200 }}>
      <div className="px-4 py-4 border-b flex flex-col items-center text-center gap-2" style={{ borderColor: cardBorder, background: dark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.25)" }}>
        {logoUrl ? (
          <div className="w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center" style={{ background: logoBg }}>
            <img src={logoUrl} alt={name} className="max-w-full max-h-full object-contain" style={{ mixBlendMode: dark ? "screen" : "multiply" }} />
          </div>
        ) : (
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: logoBg }}>
            <ImageIcon className="w-5 h-5" style={{ color: mutedColor }} />
          </div>
        )}
        <div>
          <p className="text-sm font-bold" style={{ color: textColor }}>{name || "Nombre del sitio"}</p>
          <p className="text-xs font-mono" style={{ color: mutedColor }}>Códigos de Acceso</p>
        </div>
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="rounded-lg p-3" style={{ background: cardBg, border: `1px solid ${cardBorder}` }}>
          <p className="text-xs font-bold mb-1" style={{ color: textColor }}>Hola, Usuario</p>
          <div className="flex items-center gap-1.5 mb-2" style={{ color: mutedColor }}>
            <MonitorSmartphone className="w-3 h-3" />
            <p className="text-xs">Smart TV — ejemplo</p>
          </div>
          <div className="rounded-lg py-2 px-3 flex flex-col items-center" style={{ background: dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.10)" }}>
            <p className="text-xs font-mono font-bold tracking-[0.2em]" style={{ color: textColor }}>1234</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SiteFormDialog({ isOpen, onOpenChange, siteToEdit }: SiteFormDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const createSite = useCreateSite({ request: { headers: getAdminHeaders() } });
  const updateSite = useUpdateSite({ request: { headers: getAdminHeaders() } });
  const isEditing = !!siteToEdit;

  const form = useForm<SiteFormValues>({
    resolver: zodResolver(siteSchema),
    defaultValues: {
      name: "", slug: "", logoUrl: "", description: "", themeColor: "#141414",
      imapHost: "", imapEmail: "", imapPassword: "",
      welcomeMessage: "", newCodeMessage: "",
      repeatIntervalValue: null, repeatIntervalUnit: "minutes",
      voiceWelcomeEnabled: true, voiceNewCodeEnabled: true,
    },
  });

  const watchedColor = form.watch("themeColor");
  const watchedName  = form.watch("name");
  const watchedUnit  = form.watch("repeatIntervalUnit");

  useEffect(() => {
    if (!isOpen) return;
    if (siteToEdit) {
      const stored = (siteToEdit as any).repeatInterval as number | null;
      const { value: riVal, unit: riUnit } = secondsToDisplay(stored);
      form.reset({
        name: siteToEdit.name,
        slug: siteToEdit.slug,
        logoUrl: siteToEdit.logoUrl || "",
        description: siteToEdit.description || "",
        themeColor: siteToEdit.themeColor || "#141414",
        imapHost: siteToEdit.imapHost,
        imapEmail: siteToEdit.imapEmail,
        imapPassword: "",
        welcomeMessage: (siteToEdit as any).welcomeMessage ?? "",
        newCodeMessage: (siteToEdit as any).newCodeMessage ?? "",
        repeatIntervalValue: riVal,
        repeatIntervalUnit: riUnit,
        voiceWelcomeEnabled: (siteToEdit as any).voiceWelcomeEnabled === true || (siteToEdit as any).voiceWelcomeEnabled == null,
        voiceNewCodeEnabled: (siteToEdit as any).voiceNewCodeEnabled === true || (siteToEdit as any).voiceNewCodeEnabled == null,
      });
      setLogoPreview(siteToEdit.logoUrl || "");
    } else {
      form.reset({
        name: "", slug: "", logoUrl: "", description: "", themeColor: "#141414",
        imapHost: "", imapEmail: "", imapPassword: "",
        welcomeMessage: "", newCodeMessage: "",
        repeatIntervalValue: null, repeatIntervalUnit: "minutes",
        voiceWelcomeEnabled: true, voiceNewCodeEnabled: true,
      });
      setLogoPreview("");
    }
    setShowPreview(false);
  }, [isOpen, siteToEdit]);

  const uploadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) { toast({ title: "Solo se permiten imágenes", variant: "destructive" }); return; }
    if (file.size > 5 * 1024 * 1024) { toast({ title: "La imagen no puede superar 5MB", variant: "destructive" }); return; }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const token = getAdminToken();
      const res = await fetch("/api/admin/upload-logo", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: formData });
      if (!res.ok) throw new Error("Error al subir imagen");
      const { url } = await res.json();
      form.setValue("logoUrl", url);
      setLogoPreview(url);
      toast({ title: "Logo subido correctamente" });
    } catch { toast({ title: "Error al subir el logo", variant: "destructive" }); }
    finally { setIsUploading(false); }
  }, [form, toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; };
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) { if (item.type.startsWith("image/")) { const f = item.getAsFile(); if (f) { uploadFile(f); break; } } }
  }, [uploadFile]);
  const handleClearLogo = () => { setLogoPreview(""); form.setValue("logoUrl", ""); };

  const onSubmit = (values: SiteFormValues) => {
    const repeatInterval = displayToSeconds(values.repeatIntervalValue, values.repeatIntervalUnit);
    const data: any = {
      name: values.name,
      slug: values.slug,
      logoUrl: values.logoUrl || null,
      description: values.description || null,
      themeColor: values.themeColor,
      imapHost: values.imapHost,
      imapEmail: values.imapEmail,
      welcomeMessage: values.welcomeMessage || null,
      newCodeMessage: values.newCodeMessage || null,
      repeatInterval,
      voiceWelcomeEnabled: values.voiceWelcomeEnabled,
      voiceNewCodeEnabled: values.voiceNewCodeEnabled,
    };
    if (values.imapPassword) data.imapPassword = values.imapPassword;

    if (isEditing) {
      updateSite.mutate(
        { id: siteToEdit.id, data },
        {
          onSuccess: () => { toast({ title: "Sitio actualizado correctamente" }); queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() }); onOpenChange(false); },
          onError: (err: any) => { toast({ title: "Error al actualizar", description: err.error || "Ocurrió un error", variant: "destructive" }); },
        }
      );
    } else {
      if (!values.imapPassword) { form.setError("imapPassword", { message: "La contraseña es requerida para nuevos sitios" }); return; }
      createSite.mutate(
        { data },
        {
          onSuccess: () => { toast({ title: "Sitio creado correctamente" }); queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() }); onOpenChange(false); },
          onError: (err: any) => { toast({ title: "Error al crear", description: err.error || "Ocurrió un error", variant: "destructive" }); },
        }
      );
    }
  };

  const isPending = createSite.isPending || updateSite.isPending;
  const isValidColor = /^#[0-9a-fA-F]{6}$/.test(watchedColor);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar Sitio" : "Crear Nuevo Sitio"}</DialogTitle>
          <DialogDescription>{isEditing ? "Actualiza la configuración de este sitio." : "Configura un nuevo sitio y su conexión IMAP."}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" onPaste={handlePaste}>
            {/* Name + Slug */}
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Nombre del Sitio</FormLabel><FormControl><Input placeholder="Mi Sitio" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="slug" render={({ field }) => (
                <FormItem><FormLabel>Slug URL</FormLabel><FormControl><Input placeholder="mi-sitio" data-testid="input-slug" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>

            {/* Logo */}
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">Logo (Opcional)</label>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              {logoPreview ? (
                <div className="relative w-full flex items-center gap-3 p-3 border border-border rounded-lg bg-muted/30">
                  <img src={logoPreview} alt="Logo" className="w-14 h-14 object-contain rounded-md border border-border bg-background" />
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground">Logo cargado</p><p className="text-xs text-muted-foreground truncate">{form.watch("logoUrl")}</p></div>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={handleClearLogo}><X className="h-4 w-4" /></Button>
                </div>
              ) : (
                <div className="w-full border-2 border-dashed border-border rounded-lg p-5 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors" onClick={() => fileInputRef.current?.click()}>
                  {isUploading ? <Loader2 className="h-7 w-7 animate-spin text-primary" /> : <ImageIcon className="h-7 w-7 text-muted-foreground" />}
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">{isUploading ? "Subiendo..." : "Haz clic o pega una imagen"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">PNG, JPG, SVG hasta 5MB · También puedes pegar con Ctrl+V</p>
                  </div>
                  {!isUploading && <Button type="button" variant="outline" size="sm" className="mt-1" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}><Upload className="h-3.5 w-3.5 mr-1.5" />Seleccionar archivo</Button>}
                </div>
              )}
            </div>

            {/* Description */}
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Instrucciones para el cliente <span className="text-muted-foreground font-normal">(Opcional)</span></FormLabel>
                <FormControl><Textarea placeholder="Ej: Para solicitar tu código, ve a Ajustes en tu TV → Obtener código de acceso." className="resize-none text-sm min-h-[80px]" {...field} /></FormControl>
                <p className="text-xs text-muted-foreground">{(field.value?.length ?? 0)}/500 · Se mostrará debajo del nombre en la página del cliente</p>
                <FormMessage />
              </FormItem>
            )} />

            {/* Color */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium leading-none">Color de la Página</label>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => setShowPreview(v => !v)}>
                  <Eye className="h-3.5 w-3.5" />{showPreview ? "Ocultar vista previa" : "Ver vista previa"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map(preset => (
                  <button key={preset.hex} type="button" title={preset.label} onClick={() => form.setValue("themeColor", preset.hex, { shouldValidate: true })}
                    className="w-8 h-8 rounded-full border-2 transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                    style={{ background: preset.hex, borderColor: watchedColor === preset.hex ? "hsl(var(--primary))" : "transparent", boxShadow: watchedColor === preset.hex ? "0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--primary))" : "0 0 0 1px rgba(0,0,0,0.15)" }} />
                ))}
                <div className="relative">
                  <input type="color" value={isValidColor ? watchedColor : "#141414"} onChange={e => form.setValue("themeColor", e.target.value, { shouldValidate: true })} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" title="Color personalizado" />
                  <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-[10px] font-bold cursor-pointer hover:scale-110 transition-all"
                    style={{ background: isValidColor ? watchedColor : "#888", borderColor: "rgba(0,0,0,0.15)", color: isValidColor && isDark(watchedColor) ? "#fff" : "#000" }}>+</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded border border-border shrink-0" style={{ background: isValidColor ? watchedColor : "#888" }} />
                <FormField control={form.control} name="themeColor" render={({ field }) => (
                  <FormItem className="flex-1"><FormControl><Input placeholder="#141414" className="font-mono text-sm h-8" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              {showPreview && (
                <div className="rounded-xl border border-border/60 overflow-hidden">
                  <div className="px-3 py-2 bg-muted/50 border-b border-border/50 flex items-center gap-2">
                    <div className="flex gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-400" /><span className="w-2.5 h-2.5 rounded-full bg-yellow-400" /><span className="w-2.5 h-2.5 rounded-full bg-green-400" /></div>
                    <span className="text-xs text-muted-foreground font-mono truncate">/{form.watch("slug") || "mi-sitio"}</span>
                  </div>
                  <SitePreview name={watchedName} logoUrl={logoPreview} themeColor={isValidColor ? watchedColor : "#141414"} />
                </div>
              )}
            </div>

            {/* ── MENSAJES DE VOZ ─────────────────────────────────────────────── */}
            <div className="border-t border-border pt-4 mt-4">
              <div className="flex items-center gap-2 mb-1">
                <Volume2 className="h-4 w-4 text-muted-foreground" />
                <h4 className="font-medium text-sm text-muted-foreground">Mensajes de Voz</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                El mensaje de bienvenida suena cuando el cliente toca la pantalla o mueve el mouse por primera vez.
                El de nuevo código suena cuando llega un código (siempre tiene prioridad). Nunca suenan al mismo tiempo.
              </p>
              <div className="space-y-4">
                {/* Welcome message */}
                <FormField control={form.control} name="welcomeMessage" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mensaje de bienvenida <span className="text-muted-foreground font-normal">(Opcional)</span></FormLabel>
                    <FormControl><Textarea placeholder={DEFAULT_WELCOME_MESSAGE} className="resize-none text-sm min-h-[80px]" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">{(field.value?.length ?? 0)}/600 · Suena al primer toque/movimiento del cliente</p>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* New code message */}
                <FormField control={form.control} name="newCodeMessage" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mensaje de nuevo código <span className="text-muted-foreground font-normal">(Opcional)</span></FormLabel>
                    <FormControl><Textarea placeholder={DEFAULT_NEW_CODE_MESSAGE} className="resize-none text-sm min-h-[80px]" {...field} /></FormControl>
                    <p className="text-xs text-muted-foreground">{(field.value?.length ?? 0)}/600 · Suena con prioridad cuando llega un código nuevo</p>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* Repeat interval with unit selector */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                    <label className="text-sm font-medium leading-none">
                      Repetir mensaje de bienvenida cada <span className="text-muted-foreground font-normal">(Opcional)</span>
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <FormField control={form.control} name="repeatIntervalValue" render={({ field }) => (
                      <FormItem className="flex-none w-24">
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            max={watchedUnit === "minutes" ? 1440 : 86400}
                            placeholder="0"
                            className="text-sm"
                            {...field}
                            value={field.value ?? ""}
                            onChange={e => field.onChange(e.target.value === "" ? null : parseInt(e.target.value, 10))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="repeatIntervalUnit" render={({ field }) => (
                      <FormItem className="flex-none w-36">
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="text-sm">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="seconds">segundos</SelectItem>
                            <SelectItem value="minutes">minutos</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Deja en 0 o vacío para no repetir. Ej: 30 segundos o 5 minutos.
                    Solo repite si no está sonando el mensaje de nuevo código.
                  </p>
                </div>
              </div>
            </div>

            {/* Voice Enable/Disable Toggles */}
            <div className="border-t border-border pt-4 mt-4">
              <h4 className="font-medium text-sm mb-3 text-muted-foreground flex items-center gap-1.5"><Volume2 className="h-3.5 w-3.5" />Activar / desactivar voz</h4>
              <div className="space-y-0 rounded-lg border border-border overflow-hidden bg-muted/20">
                <FormField control={form.control} name="voiceWelcomeEnabled" render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="flex-1">
                      <FormLabel className="text-sm font-medium cursor-pointer">Voz de bienvenida</FormLabel>
                      <p className="text-xs text-muted-foreground mt-0.5">Habla cuando el cliente abre la página</p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )} />
                <div className="border-t border-border/50" />
                <FormField control={form.control} name="voiceNewCodeEnabled" render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="flex-1">
                      <FormLabel className="text-sm font-medium cursor-pointer">Voz de nuevo código</FormLabel>
                      <p className="text-xs text-muted-foreground mt-0.5">Avisa cuando llega un código nuevo</p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )} />
              </div>
            </div>

            {/* IMAP */}
            <div className="border-t border-border pt-4 mt-4">
              <h4 className="font-medium text-sm mb-3 text-muted-foreground">Configuración IMAP</h4>
              <div className="space-y-4">
                <FormField control={form.control} name="imapHost" render={({ field }) => (
                  <FormItem><FormLabel>Host IMAP</FormLabel><FormControl><Input placeholder="imap.gmail.com" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="imapEmail" render={({ field }) => (
                    <FormItem><FormLabel>Correo Electrónico</FormLabel><FormControl><Input placeholder="cliente@gmail.com" type="text" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="imapPassword" render={({ field }) => (
                    <FormItem><FormLabel>Contraseña de App</FormLabel><FormControl><Input placeholder={isEditing ? "(sin cambios)" : "••••••••"} type="password" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4 gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
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
