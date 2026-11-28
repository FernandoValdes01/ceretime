#!/usr/bin/env bash
# Arranca Caddy y el backend oficial de Convex en el mismo contenedor. Si
# cualquiera de los dos termina, detiene el otro y sale con su código para que
# Kubernetes reinicie el pod completo.
set -euo pipefail

: "${CONVEX_CLOUD_ORIGIN:?Falta CONVEX_CLOUD_ORIGIN (dominio HTTPS de la API, sin barra final).}"
: "${CONVEX_SITE_ORIGIN:?Falta CONVEX_SITE_ORIGIN (dominio HTTPS de las acciones HTTP, sin barra final).}"

# Host del dominio de acciones HTTP, sin esquema, ruta ni puerto: Caddy lo usa
# para enviar ese dominio al puerto 3211.
site_host="${CONVEX_SITE_ORIGIN#*://}"
site_host="${site_host%%/*}"
export CONVEX_SITE_HOST="${site_host%%:*}"

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
proxy_pid=$!

./run_backend.sh "$@" &
backend_pid=$!

stop() {
  kill -TERM "$proxy_pid" "$backend_pid" 2>/dev/null || true
}
trap stop TERM INT

set +e
wait -n "$proxy_pid" "$backend_pid"
status=$?
stop
wait
exit "$status"
