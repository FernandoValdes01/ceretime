# **ceretime**

## Comandos mínimos de Arranque desde cero:

- Instala dependencias limpias desde la raíz con `bun install`
- En una primera terminal ejecuta `bunx convex dev`para iniciar el desarrollo del backend con Convex. Si es la primera vez que clonas el repositorio y nunca has ejecutado Convex en tu entorno local, al correr el comando por primera vez ocurrirá un asistente interactivo para iniciar sesión:
  1. Login: la terminal te pedirá un nombre del dispositivo, con ENTER puedes utilizar el recomendado, Después deberás permitirle entrar en la pagina web para hacer el login con tu cuenta de Convex con Google o GitHub.
  2. Vinculación: El asistente te guiará para crear un nuevo proyecto en la nube o vincular uno existente (por ejemplo, asignándole el nombre del monorepo: `ceretime`).
  3. Generación de la `CONVEX_URL`: Una vez completado el vínculo, la plataforma de Convex provisiona automáticamente el entorno en la nube y genera las credenciales de conexión necesarias (incluyendo la `CONVEX_URL` y `CONVEX_SITE_URL`), además de crear localmente la carpeta de tipos `convex/_generated/`
- Una vez terminado el proceso de Convex, abre otra terminal y ejecuta uno de los siguientes comandos dependiendo de tu área correspondiente; a) para TI2 (web) o b) para TI4 (mobile):
  a) ejecuta `bun run --cwd apps/web dev` para levantar un servidor local web
  b) ejecuta `bun run --cwd apps/mobile start` para inicializar el servidor para la app movil

## Documentación de variables de entorno

apps/mobile/.env.example (TI4) y apps/web/.env.example (TI2) son archivos que sirven de plantilla de configuración sin secretos que se versiona y se sube al repositorio de Git. Su propósito es servir de guía para que cualquier desarrollador sepa exactamente qué variables de entorno necesita la aplicación para funcionar. Al clonar el repositorio, debes tomar este archivo, duplicarlo con el nombre .env.local y completar con los valores locales;

Se debe distinguir las variables según la plataforma:

- En frontend web usa el prefijo `VITE_` (estas variables son visibles para el navegador del usuario final)
- En App móvil usa el prefijo `EXPO_PUBLIC`

**Queda estrictamente prohibido incluir contraseñas, tokens de API o secretos de autenticación (como BETTER_AUTH_SECRET) dentro de apps/mobile/.env.example, apps/web/.env.example o en el código cliente.**

**Los secretos del backend se configuran directamente de forma segura en el entorno de Convex, nunca en los archivos de ejemplo del monorepo.**

## Issue tracker

Se recomienda conectar tu agente al MCP de Linear, ya están configurados en `opencode.json` y `.codex/config.toml`, cada miembro debe autenticarse una vez por máquina, los tokens quedan en cada máquina y no se versionan.

Opencode:

```sh
opencode mcp auth linear
opencode mcp list
```

Codex:

```sh
codex mcp login linear
codex mcp list
```
