# Convex (backend)

El backend vive en `convex/` y se desarrolla con `bunx convex dev` desde la raíz del repo, que sincroniza las funciones y regenera los tipos en `convex/_generated/`.

## Primera vez: login y vinculación

Si es la primera vez que clonas el repositorio y nunca has ejecutado Convex en tu entorno local, al correr el comando por primera vez aparece un asistente interactivo para iniciar sesión:

1. Login: la terminal te pedirá un nombre del dispositivo, con ENTER puedes utilizar el recomendado, después deberás permitirle entrar en la página web para hacer el login con tu cuenta de Convex con Google o GitHub.
2. Vinculación: el asistente te ofrecerá crear un proyecto nuevo o vincular uno existente: elige vincular el proyecto compartido del equipo. No crees un proyecto propio: todos los miembros trabajan contra el mismo proyecto y cada uno obtiene su entorno de desarrollo personal dentro de él. Si no lo ves en la lista, pide acceso al equipo antes de continuar.
3. Generación de la `CONVEX_URL`: una vez completado el vínculo, la plataforma de Convex provisiona automáticamente el entorno en la nube y genera las credenciales de conexión necesarias (incluyendo la `CONVEX_URL` y `CONVEX_SITE_URL`), además de crear localmente la carpeta de tipos `convex/_generated/`.

## Variables de entorno

El comando genera solo el `.env.local` de la raíz (`CONVEX_DEPLOYMENT`, `CONVEX_URL`, `CONVEX_SITE_URL`); la plantilla versionada es `.env.example`. Los secretos del backend se configuran en el entorno de Convex, nunca en archivos del repositorio.

## Autenticación institucional (TI2-3)

El proveedor de identidad es Google Workspace con OpenID Connect y solo los alcances `openid`, `email` y `profile`; pedir Calendar, Drive o correo queda prohibido en Sprint 1. Better Auth corre como rutas HTTP dentro del deployment Convex (`convex/auth.ts`, `convex/http.ts`) y persiste sus tablas (`user`, `session`, `account`, `verification`) en el componente `betterAuth`, aisladas del dominio; `convex/schema.ts` solo contendrá tablas de negocio.

El callback OAuth de Google es `{CONVEX_SITE_URL}/api/auth/callback/google` y debe registrarse exacto (esquema, mayúsculas y slash final) como URI de redirección autorizada del OAuth Client Web en Google Cloud Console; el flujo de retorno de la SPA son `callbackURL: "/"` y `errorCallbackURL: "/?auth=error"`, que la pantalla traduce a un mensaje genérico sin detalles sensibles.

Hay dos inicios lógicos sobre el mismo OAuth Client, uno por población: `alu.uct.cl` (estudiante) y `uct.cl` (personal). Los botones orientan a elegir la cuenta correcta y el servidor rechaza de verdad: `databaseHooks` impide crear usuario y sesión para correos fuera de ambos sufijos, y `getSessionState` responde `unauthenticated` ante cualquier identidad no institucional; no se envía `hd` a Google porque esta versión de Better Auth (1.6.x) no admite parámetros por llamada en `/sign-in/social`. No hay roles ni habilitaciones en este alcance (TI2-4 / TI2-5).

La sesión se recupera con la query `presentation/session:getSessionState`, que resuelve la identidad con `ctx.auth.getUserIdentity()` y devuelve solo datos mínimos (`email`, `name`, población) o `unauthenticated` ante ausencia, expiración o correo no institucional, sin exponer el motivo. La Web combina esa verdad autoritativa con `authClient.useSession()` y ante expiración muestra únicamente “Tu sesión terminó. Vuelve a ingresar.”. Una llamada anónima con `bunx convex run presentation/session:getSessionState '{}'` debe responder `{"status":"unauthenticated"}`.

Las variables del backend se declaran con sus tipos en `convex/convex.config.ts` y se leen con `env` desde `./_generated/server`, nunca con `process.env`. Configura los secretos solo con `convex env set` en el deployment (nunca con prefijo `VITE_` ni en el bundle): `BETTER_AUTH_SECRET` (firma de sesiones), `SITE_URL` (origen de la SPA, p. ej. `http://localhost:5173` en desarrollo), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y, cuando haya orígenes extra (Vercel), `BETTER_AUTH_TRUSTED_ORIGINS` separados por comas. Las variables públicas del cliente (`VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, `VITE_SITE_URL`) solo localizan servicios y se documentan sin valores en `apps/web/.env.example`; los `.env.local` nunca se versionan.

Las pruebas del backend corren con `bun run test:convex` (Vitest + convex-test con identidad simulada) y también se ejecutan en CI; el flujo OAuth real contra Google queda como evidencia manual.
