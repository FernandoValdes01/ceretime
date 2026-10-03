# Despliegue Web en Vercel

El workflow `CI` conserva las validaciones de lint, formato, pruebas, tipos y build. Cuando pasan los cuatro jobs, despliega `apps/web` con Vercel CLI. La validación manual de builds y AI Review permanecen en workflows independientes; el status informativo de IA no es una dependencia del despliegue.

## Configuración del proyecto Vercel

- El proyecto identificado por `VERCEL_PROJECT_ID` debe tener `apps/web` como Root Directory, framework Vite y salida `dist`. Activa el acceso a archivos fuera del Root Directory: el build usa el workspace Bun de la raíz y tipos generados en `convex/`.
- Configura `VITE_CONVEX_URL` y `VITE_CONVEX_SITE_URL` como variables públicas del proyecto para los entornos Preview y Production con los valores que correspondan a cada entorno. El workflow no despliega Convex ni necesita `CONVEX_DEPLOY_KEY`.
- Si se prueba el inicio de sesión en una URL Preview, autoriza su origen en la configuración de Better Auth/Convex. `SITE_URL` y los orígenes de confianza del backend deben concordar con el entorno que se pruebe; un Preview con URL nueva puede cargar la interfaz aunque el inicio de sesión no esté autorizado todavía.
- GitHub Actions usa solo los secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID`. No guardes sus valores en el repositorio.

## Preview y Production

Al abrir una PR interna hacia `main` o enviarle un nuevo commit, el job Preview espera la CI y ejecuta `vercel pull --environment=preview`, `vercel build` y `vercel deploy --prebuilt`. Usa las variables Preview de Vercel, incluidas las específicas de la rama. Publica la URL en el resumen del run y actualiza un comentario en la PR con dos SHA: `Commit de la PR` identifica `github.event.pull_request.head.sha`, y `Commit construido` identifica el `HEAD` que el job obtuvo con `git rev-parse HEAD`. En eventos `pull_request`, el checkout predeterminado usa el merge temporal de GitHub, así que el Preview puede incluir también cambios de la rama base. Para reproducir el Preview, conserva ambos SHA y el run de CI asociado. Reabrir la PR o marcarla lista para revisión no despliega otra vez el mismo commit. Las PR de forks mantienen la CI, pero el despliegue se omite porque sus jobs no reciben secrets. Ninguna PR ejecuta un despliegue Production de Vercel ni de Convex.

En un push a `main`, el job Production espera la misma CI y usa `vercel pull --environment=production`, `vercel build --prod` y `vercel deploy --prebuilt --prod`. El workflow no ejecuta comandos de despliegue de Convex.

Las ramas de PR abiertas antes de integrar cambios en este workflow o en `apps/web/vercel.json` deben actualizarse con `main` y enviar un nuevo commit a GitHub para incorporar la configuración. Mientras sigan con la versión anterior, sus Preview pueden mostrar el SHA equivocado o provocar despliegues duplicados.

## Comprobación y despliegues duplicados

Abre una PR interna y espera a que termine `CI`. Comprueba que el comentario `Preview Web` muestre `Commit de la PR` igual al SHA de la rama y `Commit construido` igual al `HEAD` del checkout registrado en ese run. En una PR, este último puede ser el merge temporal de GitHub. Abre la URL y recarga una ruta interna como `/estudiante`. Después de integrar la PR, comprueba que el run de `CI` del push a `main` publica una URL Production. Revisa en Vercel que ambas URLs pertenezcan al proyecto y entorno previstos.

La integración GitHub de Vercel ya creó despliegues Preview en este repositorio. `apps/web/vercel.json` establece `git.deploymentEnabled: false` para impedir que esa integración cree otro despliegue por cada push; los despliegues hechos por CLI siguen permitidos. Tras validar el primer Preview, comprueba en Vercel que haya solo un despliegue nuevo para ese commit. Si la integración sigue creando otro, verifica que el proyecto Vercel usa `apps/web` como Root Directory y que la rama recibió el `vercel.json` actualizado. No hace falta desconectar el repositorio para usar Vercel CLI. [Vercel documenta `git.deploymentEnabled`](https://vercel.com/docs/project-configuration/git-configuration#turning-off-all-automatic-deployments).

Si `vercel pull` muestra `Could not retrieve Project Settings`, comprueba que el token tenga acceso al equipo y que `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID` correspondan al mismo proyecto. [Vercel CLI tiene una incidencia abierta](https://github.com/vercel/vercel/issues/17506) con ese error al usar tokens limitados a un solo proyecto; en ese caso, usa un token con alcance de equipo hasta que Vercel lo corrija. No publiques los valores al diagnosticarlo.

## Acceso público a Preview

`vercel.json` no configura Deployment Protection. Si el Preview pide iniciar sesión en Vercel, una persona con acceso al proyecto debe abrir el proyecto en el dashboard de Vercel, entrar en **Settings → Deployment Protection**, desactivar **Vercel Authentication** y guardar. Comprueba también que no haya otra protección activa para Preview. Esto hace públicos los Preview existentes y futuros; no agregues `--public`, enlaces de bypass ni secretos al workflow. [Vercel explica cómo desactivar Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication#managing-vercel-authentication).

Antes de guardar, revisa el alcance actual de la protección. Si figura **Standard Protection**, el dominio Production ya es público y desactivar Vercel Authentication no cambia su acceso; las URL generadas de deployments Production sí pueden perder la protección. Si figura **All Deployments**, la misma opción también protege Production: desactivarla haría público ese entorno. En ese caso, no cambies la opción sin decidir primero cómo mantener la protección de Production. [Vercel detalla los alcances de Deployment Protection](https://vercel.com/docs/deployment-protection#protection-scope).
