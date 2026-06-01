import { useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAdminLogin, useAdminSetup, useGetSetupStatus } from "@workspace/api-client-react";
import { setAdminToken, getAdminToken } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const loginSchema = z.object({
  email: z.string().min(1, "El usuario es requerido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: setupStatus, isLoading: isCheckingSetup } = useGetSetupStatus();
  const login = useAdminLogin();
  const setup = useAdminSetup();

  const isSetup = setupStatus?.needsSetup === true;

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    if (getAdminToken()) {
      setLocation("/admin/dashboard");
    }
  }, [setLocation]);

  const onSubmit = async (values: LoginFormValues) => {
    try {
      if (isSetup) {
        setup.mutate(
          { data: values },
          {
            onSuccess: (data) => {
              setAdminToken(data.token);
              toast({ title: "Configuración exitosa", description: "Cuenta de administrador creada." });
              setLocation("/admin/dashboard");
            },
            onError: () => {
              toast({ title: "Error al crear admin", description: "Verifica los datos e inténtalo de nuevo", variant: "destructive" });
            },
          }
        );
      } else {
        login.mutate(
          { data: values },
          {
            onSuccess: (data) => {
              setAdminToken(data.token);
              toast({ title: "Sesión iniciada correctamente" });
              setLocation("/admin/dashboard");
            },
            onError: () => {
              toast({ title: "Error al iniciar sesión", description: "Credenciales incorrectas", variant: "destructive" });
            },
          }
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  if (isCheckingSetup) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const isPending = login.isPending || setup.isPending;

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Códigos Netflix
          </h1>
          <p className="text-muted-foreground mt-2">
            Panel de administración
          </p>
        </div>

        <Card className="border-border shadow-xl">
          <CardHeader>
            <CardTitle>{isSetup ? "Configuración Inicial" : "Iniciar Sesión"}</CardTitle>
            <CardDescription>
              {isSetup
                ? "Crea la primera cuenta de administrador para comenzar."
                : "Ingresa tus credenciales para acceder al panel."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Usuario</FormLabel>
                      <FormControl>
                        <Input type="text" placeholder="admin@codigosnetflix" data-testid="input-email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contraseña</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" data-testid="input-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isPending} data-testid="button-submit">
                  {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isSetup ? "Crear Administrador" : "Ingresar"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
