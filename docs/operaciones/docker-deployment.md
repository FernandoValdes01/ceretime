# Despliegue Web con Docker

El workflow `Docker Build` publica la Web como imagen en GitHub Container Registry (`ghcr.io/<owner>/ceretime:latest`) en cada push a `main` y al ejecutarlo a mano. Es independiente del [despliegue en Vercel](vercel-deployment.md): no espera a la CI de ese push, porque `main` solo recibe PR que ya pasaron los cuatro checks.

## Orden del workflow

1. `Desplegar Convex` instala el workspace y ejecuta `bunx convex deploy` contra la [instancia propia de Convex en Kubero](convex-kubero.md): la URL sale de la variable `VITE_CONVEX_URL` y la clave del secret `CONVEX_SELF_HOSTED_ADMIN_KEY`. Cada push a `main` actualiza las funciones, el schema y los cron jobs de producción.
2. `Construir y publicar imagen Web` corre solo si el despliegue de Convex terminó bien, así la imagen nunca llama a funciones que el backend todavía no tiene. Construye `apps/web/Dockerfile` desde la raíz del repositorio y publica la imagen.

El workflow no admite ejecuciones simultáneas: un push nuevo espera a que termine el anterior en lugar de cancelarlo a mitad del despliegue.

## Configuración del repositorio

- Secret `CONVEX_SELF_HOSTED_ADMIN_KEY`: clave administrativa de la instancia de Kubero. Sin ella, el job de Convex falla antes de desplegar.
- Variables `VITE_CONVEX_URL` y `VITE_CONVEX_SITE_URL`: dominios de la API y de las acciones HTTP de esa instancia, sin barra final. `VITE_CONVEX_URL` es también el destino del despliegue de funciones. Son públicas y Vite las incrusta en el bundle; el build falla si faltan.
- Variable opcional `VITE_SITE_URL`: origen público donde se sirve la imagen. Debe ser `SITE_URL` o figurar en `BETTER_AUTH_TRUSTED_ORIGINS` del deployment para que el inicio de sesión vuelva a la Web.

Cambiar cualquiera de las variables `VITE_*` exige construir otra imagen.

## Imagen

`apps/web/Dockerfile` construye la SPA con Bun y la sirve con nginx sin privilegios en el puerto `8080`, configurable con la variable de entorno `PORT` al arrancar el contenedor. nginx reproduce `apps/web/vercel.json`: entrega `index.html` para cualquier ruta que no sea un archivo y aplica las cabeceras de seguridad, que se generan en el build desde ese mismo archivo con `apps/web/docker/security-headers.ts`. Los assets con hash se cachean sin expirar; `index.html` y `push-sw.js` se revalidan en cada visita.

`apps/web/Dockerfile.dockerignore` limita el contexto a los manifiestos, `convex/` y `apps/web`, y excluye los `.env*` para que un `apps/web/.env.local` no termine en el bundle.

## Comprobación local

```sh
docker build -f apps/web/Dockerfile --build-arg VITE_CONVEX_URL=https://<deployment>.convex.cloud --build-arg VITE_CONVEX_SITE_URL=https://<deployment>.convex.site -t ceretime-web .
docker run --rm -p 8080:8080 ceretime-web
curl -sI http://localhost:8080/estudiante
```

La respuesta debe ser `200` con las cuatro cabeceras de `vercel.json`. Para probar el inicio de sesión en `http://localhost:8080`, ese origen debe estar autorizado en el deployment.
