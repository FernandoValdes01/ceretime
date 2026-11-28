# Convex de producción en Kubero

Producción usa una instancia propia de Convex en el pipeline `ceretime` de Kubero UCT, junto a la Web de `https://ceretime.inf.uct.cl`. Desarrollo sigue en Convex Cloud con `bunx convex dev` y no cambia. La base de producción parte vacía: los datos del deployment de Convex Cloud eran de prueba y no se migran.

## Arquitectura

Kubero publica un solo puerto por app, pero Convex escucha en dos: `3210` para la API, los WebSockets y la CLI, y `3211` para las acciones HTTP y Better Auth. La imagen de [`docker/convex`](../../docker/convex) parte de la imagen oficial `ghcr.io/convex/convex-backend` con versión fija y agrega Caddy en el mismo contenedor. Caddy recibe los dos dominios en el puerto `8080` y envía el dominio de `CONVEX_SITE_ORIGIN` al `3211` y cualquier otro al `3210`, conservando el host y los WebSockets. Es una sola instancia de Convex con SQLite en el volumen `/convex/data`; si Caddy o el backend terminan, el contenedor sale y Kubernetes lo reinicia.

El certificado HTTPS de Kubero cubre `*.inf.uct.cl`, es decir, un solo nivel de subdominio. Los dominios de Convex son:

| Uso                   | Dominio                                   | Variable                                 |
| --------------------- | ----------------------------------------- | ---------------------------------------- |
| API y WebSockets      | `https://ceretime-convex.inf.uct.cl`      | `CONVEX_CLOUD_ORIGIN`, `VITE_CONVEX_URL` |
| Acciones HTTP y login | `https://ceretime-convex-site.inf.uct.cl` | `CONVEX_SITE_ORIGIN`, `VITE_CONVEX_SITE_URL` |

Todas las URLs van sin barra final.

## Imagen

El workflow `Imagen Convex` construye `docker/convex` y publica `ghcr.io/<owner>/ceretime-convex:<commit>` cada vez que cambia esa carpeta, en cualquier rama. La etiqueta es el SHA completo del commit y aparece en el resumen de la ejecución. Kubero solo descarga imágenes públicas: la primera vez, en GitHub → Packages → `ceretime-convex` → Package settings, cambia la visibilidad a Public.

Para actualizar Convex, cambia `CONVEX_BACKEND_VERSION` en el `Dockerfile` por el commit de otra imagen oficial, prueba la imagen y luego elige la etiqueta nueva en Kubero. Reiniciar la app sin cambiar la etiqueta nunca cambia de versión.

## Puesta en marcha

El cambio que apunta el workflow a Kubero se fusiona a `main` solo al terminar el paso 6: antes de eso, el job `Desplegar Convex` falla por falta de la clave y la Web no se reconstruye. Los pasos con credenciales los hace la persona responsable del despliegue. Ningún secreto se pega en el chat, en Linear ni en el repositorio.

### 1. Clave de la instancia y clave administrativa

En PowerShell, genera el secreto de la instancia y guárdalo en tu gestor de contraseñas:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
```

Con ese valor, genera la clave administrativa con la misma imagen oficial y guárdala también:

```powershell
docker run --rm --entrypoint ./generate_key ghcr.io/convex/convex-backend:3d585751a2de8c9066dc3fc5ac18340c1ef48810 ceretime-prod <INSTANCE_SECRET>
```

La salida empieza con `ceretime-prod|`. La clave administrativa permite desplegar y leer todo el backend.

### 2. App en Kubero

En `https://kubero.inf.uct.cl` → Pipelines → `ceretime` → Producción → Nueva app:

- Nombre de la app: `ceretime-convex`.
- Puerto del contenedor: `8080`.
- Dominio: `ceretime-convex.inf.uct.cl`. Con «Añadir dominio», agrega `ceretime-convex-site.inf.uct.cl`.
- Despliegue: imagen `ghcr.io/<owner>/ceretime-convex` y como etiqueta el SHA del workflow.
- Variables de entorno: `INSTANCE_NAME=ceretime-prod`, `INSTANCE_SECRET=<secreto del paso 1>`, `CONVEX_CLOUD_ORIGIN=https://ceretime-convex.inf.uct.cl`, `CONVEX_SITE_ORIGIN=https://ceretime-convex-site.inf.uct.cl` y, si no quieres enviar datos de uso anónimos a Convex, `DISABLE_BEACON=true`.
- Seguridad: desactiva «Sistema de archivos raíz de sólo lectura». Deja el usuario y el grupo en `0` y «Ejecutar como no-root» desactivado, porque la imagen oficial corre como root.
- Recursos: tamaño de pod Medium (2 CPU, 2 GiB), 1 réplica web, 0 worker y sin escalado automático. Dos réplicas sobre el mismo SQLite corrompen la base.
- Volúmenes: nombre `convex-data`, clase de almacenamiento `csi-cephfs-sc`, ruta de montaje `/convex/data`, modo `ReadWriteOnce` y un tamaño de al menos `5Gi`. El formulario propone la clase `standard`, que no existe en el clúster: el pod queda esperando el volumen con `storageclass "standard" not found`. La clase de un volumen creado no cambia al editarla; para corregirla, cambia el nombre del volumen y Kubero crea uno nuevo. El modo no se puede cambiar después, y eliminar la app elimina el volumen con todos los datos.
- Deja desactivados SSL, autenticación básica, CORS y las comprobaciones de estado. El certificado de `*.inf.uct.cl` ya cubre HTTPS, y Convex y Better Auth envían sus propias cabeceras CORS.

Al crearla, el pod debe quedar en ejecución y `https://ceretime-convex.inf.uct.cl/version` debe responder `unknown`, el texto normal de una instancia propia de Convex. Si tu equipo no encuentra el dominio, el DNS de la red guardó la respuesta «no existe» de antes de crear la app y puede conservarla hasta un día; mientras tanto, agrega los dos dominios con una IP de `proxy.inf.uct.cl` a `C:\Windows\System32\drivers\etc\hosts` y elimina esas líneas cuando la red ya los resuelva.

### 3. Variables del backend

Crea fuera del repositorio un archivo, por ejemplo `$HOME\ceretime-prod.env`, con dos líneas: `CONVEX_SELF_HOSTED_URL=https://ceretime-convex.inf.uct.cl` y `CONVEX_SELF_HOSTED_ADMIN_KEY=<clave del paso 1>`. Todos los comandos contra producción llevan `--env-file` con ese archivo, que reemplaza al `.env.local` de desarrollo; sin él, la CLI actúa sobre tu deployment de desarrollo.

Configura las variables que exige `convex/convex.config.ts`, una por comando:

```powershell
bunx convex env set SITE_URL https://ceretime.inf.uct.cl --env-file $HOME\ceretime-prod.env
```

Repite con `BETTER_AUTH_SECRET` (genera un valor nuevo con el comando del paso 1), `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Para los secretos, escribe solo el nombre y la CLI pide el valor sin dejarlo en el historial. Google Cloud no vuelve a mostrar un secreto de cliente después de crearlo: toma el valor del deployment de Convex Cloud o agrega un secreto nuevo al mismo cliente, sin deshabilitar el que usa desarrollo. Las variables opcionales del correo (`GMAIL_*`, `EMAIL_ALLOWED_RECIPIENTS`) y de Web Push (`VAPID_*`) se configuran igual cuando corresponda. `TEST_SEEDS_ENABLED` nunca se configura en producción. Comprueba la lista con `bunx convex env list --env-file $HOME\ceretime-prod.env`.

### 4. Google Cloud

En Google Cloud Console → APIs y servicios → Credenciales → el cliente OAuth de `GOOGLE_CLIENT_ID`, agrega estas direcciones en «Authorized redirect URIs»:

- `https://ceretime-convex-site.inf.uct.cl/api/auth/oauth2/callback/google-alu`
- `https://ceretime-convex-site.inf.uct.cl/api/auth/oauth2/callback/google-uct`
- `https://ceretime-convex-site.inf.uct.cl/api/auth/callback/google`

Conserva los de desarrollo. Google puede tardar unos minutos en aplicar el cambio.

### 5. Primer despliegue

Desde la raíz del repositorio, con `main` actualizado, publica el esquema y las funciones en la instancia vacía:

```powershell
bunx convex deploy --env-file $HOME\ceretime-prod.env
```

Debe terminar sin errores. Si falta una variable obligatoria del paso 3, la CLI la nombra.

### 6. GitHub Actions

En Settings → Secrets and variables → Actions del repositorio:

- Secret `CONVEX_SELF_HOSTED_ADMIN_KEY`: clave del paso 1.
- Variables `VITE_CONVEX_URL=https://ceretime-convex.inf.uct.cl` y `VITE_CONVEX_SITE_URL=https://ceretime-convex-site.inf.uct.cl`.
- Variable `VITE_SITE_URL=https://ceretime.inf.uct.cl`.

Son **variables**, no secrets: el workflow lee `vars.*` y un secret con el mismo nombre no tiene efecto. Los dominios de la instancia también figuran en `connect-src` de la CSP de `apps/web/vercel.json`; si cambian, hay que actualizarla o el navegador bloquea la conexión y la Web queda en «Cargando…». El job `Desplegar Convex` toma el destino de `VITE_CONVEX_URL`, así las funciones siempre llegan al mismo backend que usa la imagen Web. Cambia las variables justo antes de fusionar el cambio a `main`: el push construye la imagen Web con las URLs nuevas y `Deploy to Kubero` reinicia la app `ceretime`.

### 7. App móvil

Para la próxima publicación de producción, en EAS (`eas env:create --environment production`) configura `EXPO_PUBLIC_CONVEX_URL=https://ceretime-convex.inf.uct.cl` y `EXPO_PUBLIC_CONVEX_SITE_URL=https://ceretime-convex-site.inf.uct.cl`. Los entornos `development` y `preview` siguen apuntando a Convex Cloud.

## Verificación

- `https://ceretime.inf.uct.cl` sirve un bundle nuevo que contiene `ceretime-convex.inf.uct.cl` y ya no contiene `.convex.cloud`.
- En las herramientas de red del navegador, el WebSocket `wss://ceretime-convex.inf.uct.cl/api/<versión>/sync` queda abierto.
- El inicio con una cuenta `@alu.uct.cl` o `@uct.cl` pasa por Google y vuelve a `https://ceretime.inf.uct.cl`.

## Administrador inicial

Con la Web ya conectada a la instancia nueva, sigue el [procedimiento de arranque](../../convex/domain/accounts/enablement.md#procedimiento-de-arranque-por-entorno) con `--env-file $HOME\ceretime-prod.env` en lugar de `--prod`. El `tokenIdentifier` existe solo después de que el Administrador inicia sesión, pero ese primer ingreso también crea su perfil de Profesional pendiente, y `ensureBootstrapAdmin` rechaza una identidad que ya tiene perfil. Ese procedimiento aún no resuelve el caso y debe definirse antes de habilitar al primer Administrador de producción.

## Riesgos conocidos

- El Ingress de Kubero limita las peticiones a 1 MB y `convex deploy` responde `413`. En Redes de `ceretime-convex`, la anotación `nginx.ingress.kubernetes.io/proxy-body-size` con valor `64m` sube el límite.
- Si los WebSockets se cortan cada pocos segundos o minutos, revisa el tiempo de espera del Ingress; el cliente de Convex vuelve a conectarse solo, pero los cortes frecuentes se notan en las suscripciones.
- La Web de Vercel sigue apuntando al deployment de Convex Cloud, que deja de recibir despliegues desde este workflow. No debe usarse como producción.
- Los respaldos no son automáticos. `bunx convex export --path <archivo>.zip --env-file $HOME\ceretime-prod.env` descarga una copia de la base.
