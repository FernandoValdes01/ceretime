# Despliegue Web en Vercel

El workflow `CI` conserva las validaciones de lint, formato, pruebas, tipos y build. Cuando pasan los cuatro jobs, despliega `apps/web` con Vercel CLI. La validación manual de builds y el check de Greptile siguen en sus workflows actuales.

## Configuración del proyecto Vercel

- El proyecto identificado por `VERCEL_PROJECT_ID` debe tener `apps/web` como Root Directory, framework Vite y salida `dist`. Activa el acceso a archivos fuera del Root Directory: el build usa el workspace Bun de la raíz y tipos generados en `convex/`.
- Configura `VITE_CONVEX_URL` y `VITE_CONVEX_SITE_URL` como variables públicas del proyecto para los entornos Preview y Production con los valores que correspondan a cada entorno. El workflow no despliega Convex ni necesita `CONVEX_DEPLOY_KEY`.
- Si se prueba el inicio de sesión en una URL Preview, autoriza su origen en la configuración de Better Auth/Convex. `SITE_URL` y los orígenes de confianza del backend deben concordar con el entorno que se pruebe; un Preview con URL nueva puede cargar la interfaz aunque el inicio de sesión no esté autorizado todavía.
- GitHub Actions usa solo los secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID`. No guardes sus valores en el repositorio.

## Preview y Production

Al abrir una PR interna hacia `main` o enviarle un nuevo commit, el job Preview espera la CI y ejecuta `vercel pull --environment=preview`, `vercel build` y `vercel deploy --prebuilt`. Usa las variables Preview de Vercel, incluidas las específicas de la rama. Publica la URL en el resumen del run y actualiza un comentario en la PR. Reabrir la PR o marcarla lista para revisión no despliega otra vez el mismo commit. Las PR de forks mantienen la CI, pero el despliegue se omite porque sus jobs no reciben secrets. Ninguna PR ejecuta un despliegue Production de Vercel ni de Convex.

En un push a `main`, el job Production espera la misma CI y usa `vercel pull --environment=production`, `vercel build --prod` y `vercel deploy --prebuilt --prod`. El workflow no ejecuta comandos de despliegue de Convex.

## Comprobación y despliegues duplicados

Abre una PR interna y espera a que termine `CI`. Comprueba el comentario `Preview Web`, abre la URL y recarga una ruta interna como `/estudiante`. Después de integrar la PR, comprueba que el run de `CI` del push a `main` publica una URL Production. Revisa en Vercel que ambas URLs pertenezcan al proyecto y entorno previstos.

La integración GitHub de Vercel ya creó despliegues Preview en este repositorio. `apps/web/vercel.json` establece `git.deploymentEnabled: false` para impedir que esa integración cree otro despliegue por cada push; los despliegues hechos por CLI siguen permitidos. Tras validar el primer Preview, comprueba en Vercel que haya solo un despliegue nuevo para ese commit. Si la integración sigue creando otro, desactiva los despliegues automáticos del proyecto en Vercel antes de integrar la PR a `main`. No hace falta desconectar el repositorio para usar Vercel CLI.

Si `vercel pull` muestra `Could not retrieve Project Settings`, comprueba que el token tenga acceso al equipo y que `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID` correspondan al mismo proyecto. [Vercel CLI tiene una incidencia abierta](https://github.com/vercel/vercel/issues/17506) con ese error al usar tokens limitados a un solo proyecto; en ese caso, usa un token con alcance de equipo hasta que Vercel lo corrija. No publiques los valores al diagnosticarlo.
