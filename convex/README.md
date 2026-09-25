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

## Cierre de sesión y errores seguros (TI2-14)

El cierre se ejecuta con `authClient.signOut()` en la Web y se verifica en el servidor: tras cerrar, `presentation/session:getSessionState` vuelve a responder `{"status":"unauthenticated"}` sin datos mínimos, por lo que la pantalla retorna al acceso institucional sin conservar datos de sesión.

La cuenta no autorizada, el callback inválido y los errores del proveedor comparten el mismo tratamiento seguro: `databaseHooks` impide crear usuario y sesión fuera de `@alu.uct.cl` y `@uct.cl`, `getSessionState` responde `unauthenticated` sin motivo ante ausencia, expiración o dominio externo, y la Web traduce solo el marcador controlado `?auth=error` al mensaje genérico “No pudimos iniciar sesión. Inténtalo de nuevo.”. Los fallos del proveedor llegan como `/?auth=error&error=...&error_description=...` y los callbacks sin estado de flujo usan el `errorURL` controlado de `onAPIError` hacia la SPA; la limpieza retira únicamente `auth`, `error` y `error_description` sin mostrar valores ni borrar el resto de la URL.

Los secretos del backend (`BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) se configuran solo con `convex env set` y se leen con `env` desde `./_generated/server`; el cliente solo usa `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` y `VITE_SITE_URL` como localizadores públicos sin valores en `apps/web/.env.example`, y los `.env.local` nunca se versionan.

Las variables del backend se declaran con sus tipos en `convex/convex.config.ts` y se leen con `env` desde `./_generated/server`, nunca con `process.env`. Configura los secretos solo con `convex env set` en el deployment (nunca con prefijo `VITE_` ni en el bundle): `BETTER_AUTH_SECRET` (firma de sesiones), `SITE_URL` (origen de la SPA, p. ej. `http://localhost:5173` en desarrollo), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y, cuando haya orígenes extra (Vercel), `BETTER_AUTH_TRUSTED_ORIGINS` separados por comas. Las variables públicas del cliente (`VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, `VITE_SITE_URL`) solo localizan servicios y se documentan sin valores en `apps/web/.env.example`; los `.env.local` nunca se versionan.

Las pruebas del backend corren con `bun run test:convex` (Vitest + convex-test con identidad simulada) y también se ejecutan en CI; el flujo OAuth real contra Google queda como evidencia manual.

## Pruebas y evidencia reproducible (TI2-15)

La matriz automatizada cubre el flujo ya implementado sin ampliar funcionalidad: cuenta válida (`convex/session.test.ts` con `@alu.uct.cl` y `@uct.cl`, más `apps/web/src/application/session/institutional-login.test.ts` para el inicio por población y el retorno controlado), cuenta no autorizada (`convex/session.test.ts` con respuesta idéntica ante dominio externo y ausencia, más `reject_external_user.test.ts`, `minimal_identity.test.ts` y `auth-error.test.ts` para el mensaje genérico), sesión expirada (`convex/session.test.ts` fija el contrato del estado anónimo que Convex expone al expirar la identidad, más el aviso visible en `apps/web/src/presentation/auth/AuthScreen.test.tsx`) y cierre (`convex/session.test.ts` fija el mismo contrato tras el cierre, más `AuthScreen.test.tsx` donde el `signOut` simulado invalida la sesión observada, con error resuelto y rechazo hacia el mensaje genérico de `institutional-login.test.ts`).

Para reproducir desde la raíz: `bun run test:convex`, `bun run test:web`, `bun run --cwd apps/web tsc -p ../../convex/tsconfig.json --noEmit`, `bun run --cwd apps/web tsc -p ../../convex/tsconfig.tests.json --noEmit`, `bun run lint`, `bun run format:check`, `bun --cwd apps/web run lint` y `bun --cwd apps/web run build`.

## Evidencia manual pendiente de registro (TI2-15)

El vínculo entre `signOut` y el estado observado por Convex solo se verifica contra el flujo real con cuentas ficticias, fuera del alcance automatizable en CI: requiere el deployment de desarrollo, sus variables y un navegador.

Requisitos: `bunx convex dev` vinculado al proyecto compartido, secretos del backend configurados con `convex env set` (`BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SITE_URL=http://localhost:5173`), `.env.local` en `apps/web` con `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` y `VITE_SITE_URL=http://localhost:5173`, aplicación levantada con `bun run dev:web` desde la raíz (Convex más SPA en `http://localhost:5173`; ver README raíz) y dos cuentas ficticias (una `@alu.uct.cl` y una externa).

Pasos: 1) ingresar con la cuenta `@alu.uct.cl` y comprobar “Sesión iniciada” con `getSessionState` en `authenticated`; 2) pulsar `Cerrar sesión` y comprobar el retorno al acceso institucional con la query en `{"status":"unauthenticated"}`; 3) ingresar con la cuenta externa y comprobar el mensaje genérico sin detalles; 4) con la sesión iniciada en dos pestañas, cerrar en una y comprobar en la otra el aviso “Tu sesión terminó. Vuelve a ingresar.”.

| Paso | Fecha     | Entorno          | Responsable | Resultado     |
| ---- | --------- | ---------------- | ----------- | ------------- |
| 1    | pendiente | desarrollo local | por asignar | por registrar |
| 2    | pendiente | desarrollo local | por asignar | por registrar |
| 3    | pendiente | desarrollo local | por asignar | por registrar |
| 4    | pendiente | desarrollo local | por asignar | por registrar |
