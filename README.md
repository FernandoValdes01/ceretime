# **ceretime**

## Comandos mínimos de Arranque desde cero:

- Instala dependencias limpias desde la raíz con `bun install`
- Seguido de los siguientes comandos para ejecutar los servicios, a) SOLO para la ejecución web (TI2), y b) SOLO para la ejecución mobile (TI4) (utiliza distintas terminales);
  ejecuta `bunx convex dev` en la primera terminal para iniciar el desarrollo del backend con Convex.
  a) en la segunda terminal ejecuta `bun run --cwd apps/web dev` para levantar un servidor local web
  b) en la segunda terminal ejecuta `bun run --cwd apps/mobile start` para inicializar el servidor para la app movil

## Documentación de variables de entorno

apps/mobile/.env.example (TI4) y apps/web/.env.example (TI2) son archivos que sirven de plantilla de configuración sin secretos que se versiona y se sube al repositorio de Git. Su propósito es servir de guía para que cualquier desarrollador sepa exactamente qué variables de entorno necesita la aplicación para funcionar. Al clonar el repositorio, debes tomar este archivo, duplicarlo con el nombre .env.local y completar con los valores locales;

Se debe distinguir las variables según la plataforma:

- En frontend web usa el prefijo `VITE_` (estas variables son visibles para el navegador del usuario final)
- En App móvil usa el prefijo `EXPO_PUBLIC`

**Queda estrictamente prohibido incluir contraseñas, tokens de API o secretos de autenticación (como BETTER_AUTH_SECRET) dentro de apps/mobile/.env.example, apps/web/.env.example o en el código cliente.**

**Los secretos del backend se configuran directamente de forma segura en el entorno de Convex, nunca en los archivos de ejemplo del monorepo.**
