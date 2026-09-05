# **ceretime**

## Comandos mínimos de Arranque desde cero:

- Instala dependencias limpias desde la raíz con `bun install`
- Seguido de los comandos para ejecutar los servicios (utiliza distintas terminales). `bunx convex dev` para el backend (convex), `bun --cwd apps/web run dev` para la ejecución web, o `bun --cwd apps/mobile run start` en el caso de la ejecución app mobile.

## Documentación de variables de entorno

.env.example es la plantilla de configuración sin secretos que se versiona y se sube al repositorio de Git. Su propósito es servir de guía para que cualquier desarrollador sepa exactamente qué variables de entorno necesita la aplicación para funcionar. Al clonar el repositorio, debes tomar este archivo, duplicarlo con el nombre .env.local y completar con los valores locales;

Se debe distinguir las variables según la plataforma:

- En frontend web usa el prefijo `VITE_` (estas variables son visibles para el navegador del usuario final)
- En App móvil usa el prefijo `EXPO_PUBLIC`

**Queda estrictamente prohibido incluir contraseñas, tokens de API o secretos de autenticación (como BETTER_AUTH_SECRET) dentro de los archivos .env.example o en el código cliente.**

**Los secretos del backend se configuran directamente de forma segura en el entorno de Convex, nunca en los archivos de ejemplo del monorepo.**
