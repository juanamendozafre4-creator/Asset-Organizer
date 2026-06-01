import { useEffect, useState } from "react";
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
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required").regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers, and dashes"),
  logoUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  imapHost: z.string().min(1, "IMAP Host is required"),
  imapEmail: z.string().email("Invalid email address"),
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
          imapPassword: "", // Don't prefill password for security
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
            toast({ title: "Site updated successfully" });
            queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
            onOpenChange(false);
          },
          onError: (err: any) => {
            toast({ title: "Update failed", description: err.error || "An error occurred", variant: "destructive" });
          },
        }
      );
    } else {
      if (!values.imapPassword) {
        form.setError("imapPassword", { message: "Password is required for new sites" });
        return;
      }

      createSite.mutate(
        { data: data as any },
        {
          onSuccess: () => {
            toast({ title: "Site created successfully" });
            queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
            onOpenChange(false);
          },
          onError: (err: any) => {
            toast({ title: "Creation failed", description: err.error || "An error occurred", variant: "destructive" });
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
          <DialogTitle>{isEditing ? "Edit Site" : "Create New Site"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the configuration for this client site."
              : "Set up a new client site and IMAP connection."}
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
                    <FormLabel>Site Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Acme Corp" {...field} />
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
                    <FormLabel>URL Slug</FormLabel>
                    <FormControl>
                      <Input placeholder="acme" data-testid="input-slug" {...field} />
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
                  <FormLabel>Logo URL (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="https://example.com/logo.png" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="border-t border-border pt-4 mt-4">
              <h4 className="font-medium text-sm mb-3 text-muted-foreground">IMAP Configuration</h4>
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="imapHost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>IMAP Host</FormLabel>
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
                        <FormLabel>Email Address</FormLabel>
                        <FormControl>
                          <Input placeholder="client@gmail.com" type="email" {...field} />
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
                        <FormLabel>App Password</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={isEditing ? "(unchanged)" : "••••••••"}
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
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? "Save Changes" : "Create Site"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
