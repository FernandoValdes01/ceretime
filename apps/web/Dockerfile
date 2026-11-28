# syntax=docker/dockerfile:1

# Imagen de despliegue de la Web: Bun construye la SPA y nginx la sirve como
# archivos estáticos. El contexto es la raíz del repositorio, porque la Web
# importa `convex/_generated` y comparte el lockfile de los workspaces:
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg VITE_CONVEX_URL=https://<deployment>.convex.cloud \
#     --build-arg VITE_CONVEX_SITE_URL=https://<deployment>.convex.site \
#     --build-arg VITE_SITE_URL=https://<origen-publico> \
#     -t ceretime-web .
#
# Vite incrusta las variables `VITE_*` en el bundle durante el build: son
# públicas, nunca llevan secretos (ver `apps/web/.env.example`) y cambiarlas
# exige construir otra imagen. `VITE_SITE_URL` es el origen donde se publica la
# imagen; debe ser `SITE_URL` o figurar en `BETTER_AUTH_TRUSTED_ORIGINS` del
# deployment Convex para que el login vuelva a la Web.

ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /repo

# Primero solo los manifiestos, para reutilizar la capa de dependencias
# mientras no cambien. `--frozen-lockfile` exige todos los workspaces de
# `apps/*`, aunque solo se instalan la raíz (la usa `convex/`) y la Web.
COPY package.json bun.lock ./
COPY patches ./patches
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN bun install --frozen-lockfile --filter ceretime --filter web

COPY convex ./convex
# La página del aviso de privacidad importa el documento con `?raw` (TI2-171).
# Otro archivo de fuera de `apps/web` que importe la Web va aquí y en
# `Dockerfile.dockerignore`.
COPY docs/privacidad-aviso.md ./docs/privacidad-aviso.md
COPY apps/web ./apps/web

ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
ARG VITE_SITE_URL
RUN test -n "$VITE_CONVEX_URL" && test -n "$VITE_CONVEX_SITE_URL" \
    || { echo "Faltan los build args VITE_CONVEX_URL y VITE_CONVEX_SITE_URL." >&2; exit 1; }
RUN bun run --cwd apps/web build \
    && bun apps/web/docker/security-headers.ts > /repo/security-headers.conf

FROM nginxinc/nginx-unprivileged:stable-alpine

# La imagen de nginx sustituye `${PORT}` en la plantilla al arrancar; el
# filtro evita que reemplace otras variables, como `$uri`.
ENV PORT=8080 \
    NGINX_ENVSUBST_FILTER=PORT
COPY apps/web/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
