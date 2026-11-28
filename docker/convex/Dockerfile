# syntax=docker/dockerfile:1

# Convex de producción para Kubero UCT: una sola instancia del backend oficial
# y un proxy Caddy en el mismo contenedor. Kubero publica un único puerto por
# app, pero Convex escucha en dos: `3210` (API y WebSockets) y `3211` (acciones
# HTTP y Better Auth). Caddy recibe los dos dominios en `PORT` y elige el
# puerto interno según el host (ver `Caddyfile`).
#
#   docker build -t ceretime-convex docker/convex
#
# La versión de Convex es fija: la etiqueta es el commit de
# `get-convex/convex-backend` de la imagen publicada. Para actualizarla, cambia
# el valor, construye y prueba antes de reiniciar la app en Kubero.

ARG CONVEX_BACKEND_VERSION=3d585751a2de8c9066dc3fc5ac18340c1ef48810
ARG CADDY_VERSION=2.11.9

FROM caddy:${CADDY_VERSION}-alpine AS caddy

FROM ghcr.io/convex/convex-backend:${CONVEX_BACKEND_VERSION}

# El binario de Caddy es estático: funciona sobre la base Ubuntu de Convex.
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY --chmod=755 start.sh /convex/start.sh

# Datos de SQLite, archivos y credenciales de la instancia: Kubero monta aquí el
# volumen persistente.
VOLUME /convex/data

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["./start.sh"]
