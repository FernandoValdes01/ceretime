# Convex (backend)

El backend vive en `convex/` y se desarrolla con `bunx convex dev` desde la raíz del repo, que sincroniza las funciones y regenera los tipos en `convex/_generated/`.

## Primera vez: login y vinculación

Si es la primera vez que clonas el repositorio y nunca has ejecutado Convex en tu entorno local, al correr el comando por primera vez aparece un asistente interactivo para iniciar sesión:

1. Login: la terminal te pedirá un nombre del dispositivo, con ENTER puedes utilizar el recomendado, después deberás permitirle entrar en la página web para hacer el login con tu cuenta de Convex con Google o GitHub.
2. Vinculación: el asistente te ofrecerá crear un proyecto nuevo o vincular uno existente: elige vincular el proyecto compartido del equipo. No crees un proyecto propio: todos los miembros trabajan contra el mismo proyecto y cada uno obtiene su entorno de desarrollo personal dentro de él. Si no lo ves en la lista, pide acceso al equipo antes de continuar.
3. Generación de la `CONVEX_URL`: una vez completado el vínculo, la plataforma de Convex provisiona automáticamente el entorno en la nube y genera las credenciales de conexión necesarias (incluyendo la `CONVEX_URL` y `CONVEX_SITE_URL`), además de crear localmente la carpeta de tipos `convex/_generated/`.

## Variables de entorno

El comando genera solo el `.env.local` de la raíz (`CONVEX_DEPLOYMENT`, `CONVEX_URL`, `CONVEX_SITE_URL`); la plantilla versionada es `.env.example`. Los secretos del backend se configuran en el entorno de Convex, nunca en archivos del repositorio.
