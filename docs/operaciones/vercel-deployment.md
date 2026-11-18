# Despliegue Web en Vercel

El workflow `CI` conserva las validaciones de lint, formato, pruebas, tipos y build. Cuando pasan los cuatro jobs, despliega `apps/web` con Vercel CLI. La validación manual de builds permanece en un workflow independiente. La integración en main requiere los cuatro checks de CI y la aprobación humana.

## Configuración del proyecto Vercel

- El proyecto identificado por `VERCEL_PROJECT_ID` debe tener `apps/web` como Root Directory, framework Vite y salida `dist`. Activa el acceso a archivos fuera del Root Directory: el build usa el workspace Bun de la raíz y tipos generados en `convex/`.
- Configura `VITE_CONVEX_URL` y `VITE_CONVEX_SITE_URL` como variables públicas del proyecto para los entornos Preview y Production con los valores que correspondan a cada entorno. El workflow no despliega Convex ni necesita `CONVEX_DEPLOY_KEY`.
- Si se prueba el inicio de sesión en una URL Preview, autoriza su origen en la configuración de Better Auth/Convex. `SITE_URL` y los orígenes de confianza del backend deben concordar con el entorno que se pruebe; un Preview con URL nueva puede cargar la interfaz aunque el inicio de sesión no esté autorizado todavía.
- GitHub Actions usa solo los secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID`. No guardes sus valores en el repositorio.

## Preview y Production

Al abrir una PR interna hacia `main` o enviarle un nuevo commit, el job Preview espera la CI y ejecuta `vercel pull --environment=preview`, `vercel build` y `vercel deploy --prebuilt`. Usa las variables Preview de Vercel, incluidas las específicas de la rama. Publica la URL en el resumen del run y actualiza un comentario en la PR con dos SHA: `Commit de la PR` identifica `github.event.pull_request.head.sha`, y `Commit construido` identifica el `HEAD` que el job obtuvo con `git rev-parse HEAD`. En eventos `pull_request`, el checkout predeterminado usa el merge temporal de GitHub, así que el Preview puede incluir también cambios de la rama base. Para reproducir el Preview, conserva ambos SHA y el run de CI asociado. Reabrir la PR o marcarla lista para revisión no despliega otra vez el mismo commit. Las PR de forks mantienen la CI, pero el despliegue se omite porque sus jobs no reciben secrets. Ninguna PR ejecuta un despliegue Production de Vercel ni de Convex.

En un push a `main`, el job Production espera la misma CI y usa `vercel pull --environment=production`, `vercel build --prod` y `vercel deploy --prebuilt --prod`. El workflow no ejecuta comandos de despliegue de Convex.

Las ramas de PR abiertas antes de integrar cambios en este workflow o en `apps/web/vercel.json` deben actualizarse con `main` y enviar un nuevo commit a GitHub para incorporar la configuración. Mientras sigan con la versión anterior, sus Preview pueden mostrar el SHA equivocado o provocar despliegues duplicados.

## Cabeceras de seguridad

`apps/web/vercel.json` declara en `headers` las cabeceras que Vercel aplica a las respuestas de la Web publicada. No se configuran en el panel de Vercel ni en el workflow: `vercel build` las incorpora al artefacto y `vercel deploy --prebuilt` las publica.

| Cabecera                  | Valor                             | Efecto                                                                                                                  |
| ------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy` | Política descrita abajo           | Restringe scripts, estilos, fuentes, imágenes y conexiones; `frame-ancestors 'none'` impide incluir la Web en un marco. |
| `X-Content-Type-Options`  | `nosniff`                         | Evita que el navegador adivine un tipo MIME distinto del declarado.                                                     |
| `X-Frame-Options`         | `DENY`                            | Refuerza `frame-ancestors` en navegadores que no aplican esa directiva.                                                 |
| `Referrer-Policy`         | `strict-origin-when-cross-origin` | Comparte solo el origen, no rutas ni parámetros, con otros orígenes.                                                    |

La CSP permite scripts y estilos propios; `https://fonts.googleapis.com` para la hoja de Fira Sans de `index.html`, `https://fonts.gstatic.com` para sus fuentes y `'unsafe-inline'` solo en `style-src`, porque la interfaz usa atributos `style`. `connect-src` habilita la API de Convex por HTTPS y su sincronización por WebSocket; no se permite ningún otro origen externo.

### Orígenes de Convex

`vercel.json` es un archivo estático y no interpola `VITE_CONVEX_URL` ni `VITE_CONVEX_SITE_URL`. Cada entorno usa un deployment distinto (desarrollo local y producción tienen subdominios propios), así que una lista de orígenes explícitos quedaría incompleta al cambiar de deployment o al probar un entorno nuevo. La política admite los dominios de Convex en `connect-src`: `https://*.convex.cloud`, `wss://*.convex.cloud` y `https://*.convex.site`. El comodín no alcanza a otros servicios; agregar un origen externo exige editar la política de forma deliberada. Si más adelante se muestran archivos alojados en Convex Storage, hay que añadir `https://*.convex.cloud` a `img-src`; hoy no se usa.

### Comprobación local

`vite.config.ts` lee las cabeceras de `vercel.json` y las aplica en `server.headers` y `preview.headers`; no existe una segunda lista. `dev` agrega solo dos concesiones para el servidor de Vite, que no existen en la Web publicada: `'unsafe-inline'` en `script-src` por el script inline de React Refresh y `ws://localhost:* ws://127.0.0.1:*` en `connect-src` por HMR. `preview` sirve el build real y aplica la política publicada sin concesiones, así que es la comprobación fiel antes de integrar.

```sh
bun run --cwd apps/web dev
curl -sI http://localhost:5173/
bun run --cwd apps/web build
bun run --cwd apps/web preview -- --port 5173
curl -sI http://localhost:5173/
```

Comprueba las cuatro cabeceras en ambas respuestas y, en el navegador, abre la consola: no debe haber violaciones de CSP. El botón institucional debe llegar a `accounts.google.com` y el Site URL de Convex debe resolver la sesión con el WebSocket abierto. Completar el acceso requiere una cuenta autorizada. Detén el servidor de `dev` antes de usar `preview` en el mismo puerto; si el backend solo confía en `http://localhost:5173`, usa ese puerto, porque otro origen bloquea `get-session` por CORS y no por CSP.

### Comprobación después de integrar

Después del push a `main`, espera el job de Production y ejecuta `curl -sI https://ceretime.vercel.app/`. Deben aparecer las cuatro cabeceras con los valores de `vercel.json`. Abre la Web, inicia sesión con Google y confirma que la sesión y los datos en tiempo real de Convex funcionan sin errores de CSP en la consola. Si el acceso falla, revierte o corrige el cambio de inmediato; si faltan las cabeceras, comprueba que el despliegue corresponde al commit integrado y que `apps/web` sigue siendo el Root Directory del proyecto.

## Comprobación y despliegues duplicados

Abre una PR interna y espera a que termine `CI`. Comprueba que el comentario `Preview Web` muestre `Commit de la PR` igual al SHA de la rama y `Commit construido` igual al `HEAD` del checkout registrado en ese run. En una PR, este último puede ser el merge temporal de GitHub. Abre la URL y recarga una ruta interna como `/estudiante`. Después de integrar la PR, comprueba que el run de `CI` del push a `main` publica una URL Production. Revisa en Vercel que ambas URLs pertenezcan al proyecto y entorno previstos.

La integración GitHub de Vercel ya creó despliegues Preview en este repositorio. `apps/web/vercel.json` establece `git.deploymentEnabled: false` para impedir que esa integración cree otro despliegue por cada push; los despliegues hechos por CLI siguen permitidos. Tras validar el primer Preview, comprueba en Vercel que haya solo un despliegue nuevo para ese commit. Si la integración sigue creando otro, verifica que el proyecto Vercel usa `apps/web` como Root Directory y que la rama recibió el `vercel.json` actualizado. No hace falta desconectar el repositorio para usar Vercel CLI. [Vercel documenta `git.deploymentEnabled`](https://vercel.com/docs/project-configuration/git-configuration#turning-off-all-automatic-deployments).

Si `vercel pull` muestra `Could not retrieve Project Settings`, comprueba que el token tenga acceso al equipo y que `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID` correspondan al mismo proyecto. [Vercel CLI tiene una incidencia abierta](https://github.com/vercel/vercel/issues/17506) con ese error al usar tokens limitados a un solo proyecto; en ese caso, usa un token con alcance de equipo hasta que Vercel lo corrija. No publiques los valores al diagnosticarlo.

## Acceso público a Preview

`vercel.json` no configura Deployment Protection. Si el Preview pide iniciar sesión en Vercel, una persona con acceso al proyecto debe abrir el proyecto en el dashboard de Vercel, entrar en **Settings → Deployment Protection**, desactivar **Vercel Authentication** y guardar. Comprueba también que no haya otra protección activa para Preview. Esto hace públicos los Preview existentes y futuros; no agregues `--public`, enlaces de bypass ni secretos al workflow. [Vercel explica cómo desactivar Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication#managing-vercel-authentication).

Antes de guardar, revisa el alcance actual de la protección. Si figura **Standard Protection**, el dominio Production ya es público y desactivar Vercel Authentication no cambia su acceso; las URL generadas de deployments Production sí pueden perder la protección. Si figura **All Deployments**, la misma opción también protege Production: desactivarla haría público ese entorno. En ese caso, no cambies la opción sin decidir primero cómo mantener la protección de Production. [Vercel detalla los alcances de Deployment Protection](https://vercel.com/docs/deployment-protection#protection-scope).
