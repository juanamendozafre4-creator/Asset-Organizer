# Codes Netflix

Herramienta multi-tenant para ver códigos de acceso temporal de Netflix. El administrador crea "sitios" (clientes), cada uno con su propia conexión IMAP y logo. Cada cliente accede a su URL personalizada `/{slug}` para ver sus códigos.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — servidor API (puerto asignado por workflow)
- `pnpm run typecheck` — typecheck completo de todos los paquetes
- `pnpm run build` — typecheck + build de todos los paquetes
- `pnpm --filter @workspace/api-spec run codegen` — regenerar hooks y schemas Zod desde OpenAPI spec
- `pnpm --filter @workspace/db run push` — aplicar cambios al schema de BD (solo dev)
- Env requerida: `DATABASE_URL` (PostgreSQL), `SESSION_SECRET` (JWT + cifrado IMAP)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, `imapflow` (IMAP), `bcryptjs`, `jsonwebtoken`
- DB: PostgreSQL + Drizzle ORM
- Frontend: React + Vite, Wouter, TanStack Query, shadcn/ui
- Validación: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (desde OpenAPI spec)
- Build: esbuild

## Where things live

- DB schema: `lib/db/src/schema/sites.ts` (tablas: `admin_users`, `sites`)
- API contract: `lib/api-spec/openapi.yaml`
- Hooks generados: `lib/api-client-react/src/generated/api.ts`
- Schemas Zod generados: `lib/api-zod/src/generated/api.ts`
- Rutas backend: `artifacts/api-server/src/routes/` (auth.ts, admin.ts, publicSites.ts)
- Páginas frontend: `artifacts/netflix-codes/src/pages/` (admin-login, admin-dashboard, public-site)
- Cifrado IMAP passwords: `artifacts/api-server/src/lib/crypto.ts` (AES-256-CBC con SESSION_SECRET)

## Architecture decisions

- Contraseñas IMAP cifradas en BD con AES-256-CBC usando SESSION_SECRET; nunca se exponen al frontend.
- Auth admin con JWT (7 días), almacenado en localStorage. Sin sesiones en servidor.
- Diseño contract-first: OpenAPI → codegen → hooks React + schemas Zod. Nunca editar archivos generados manualmente.
- `nodemailer` instalado explícitamente como dependencia de `imapflow` para evitar error de módulo no encontrado en build.
- La ruta `/:slug` en wouter va ÚLTIMA para no capturar `/admin`.

## Product

- `/admin` — Login / Setup inicial del administrador
- `/admin/dashboard` — Panel de gestión de sitios (CRUD + prueba de conexión IMAP)
- `/{slug}` — Página pública de cada cliente: muestra código de acceso Netflix prominente, con auto-refresh cada 30 segundos

## User preferences

- Responder siempre en español.

## Gotchas

- Correr `pnpm --filter @workspace/api-spec run codegen` después de cambiar `openapi.yaml`. El codegen también hace typecheck de libs.
- Si se añaden query params a endpoints que también tienen path params con el mismo nombre generado, Orval produce un conflicto TS2308. Solución: quitar el query param o usar otro operationId.
- `imapflow` requiere `nodemailer` instalado por separado en `artifacts/api-server`.
- No usar `bcrypt` nativo — usar `bcryptjs` (pure JS) para evitar problemas de compilación de binarios en Replit.

## Pointers

- Ver `pnpm-workspace` skill para estructura del workspace, configuración TypeScript y detalle de paquetes.
