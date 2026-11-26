import { defineApp, type ComponentDefinition } from "convex/server";
import { v } from "convex/values";
import betterAuth from "@convex-dev/better-auth/convex.config";

// Variables del backend con tipos declarados (convención del proyecto): se leen con
// `env` desde `./_generated/server`, nunca con `process.env`. Los valores se
// configuran solo con `convex env set`; los secretos jamás van al repo.
const app = defineApp({
  env: {
    SITE_URL: v.string(),
    BETTER_AUTH_SECRET: v.string(),
    GOOGLE_CLIENT_ID: v.string(),
    GOOGLE_CLIENT_SECRET: v.string(),
    BETTER_AUTH_TRUSTED_ORIGINS: v.optional(v.string()),
    // Interruptor de semillas de desarrollo (TI2-11): solo el operador lo
    // activa por entorno con `convex env set`; el cliente nunca puede
    // controlarlo. En producción permanece ausente y `createTestUser` rechaza.
    TEST_SEEDS_ENABLED: v.optional(v.string()),
    // Remitente de los avisos por correo (TI2-159): cuenta institucional
    // autorizada con OAuth solo para `gmail.send` con el mismo cliente
    // `GOOGLE_CLIENT_ID`. El token de actualización es secreto y lo renueva el
    // responsable del remitente. Sin ellos, el aviso queda pendiente con
    // `not_configured` y se reintenta.
    GMAIL_SENDER_ADDRESS: v.optional(v.string()),
    GMAIL_SENDER_REFRESH_TOKEN: v.optional(v.string()),
    // Destinos de prueba habilitados, separados por comas. Si existe, ningún
    // correo sale a una dirección fuera de la lista.
    EMAIL_ALLOWED_RECIPIENTS: v.optional(v.string()),
    // Claves VAPID para Web Push opcional (TI2-160). La clave pública se
    // entrega al navegador al activar la suscripción; la privada nunca sale
    // del servidor. Sin ellas, el envío push registra `not_configured`.
    VAPID_PUBLIC_KEY: v.optional(v.string()),
    VAPID_PRIVATE_KEY: v.optional(v.string()),
    VAPID_SUBJECT: v.optional(v.string()),
  },
});
// Cast acotado a este borde: Bun aísla `convex` por workspace y el `tsc`
// local ve dos copias idénticas (v1.45.0) como tipos distintos. En ejecución
// es el mismo objeto de definición; `convex dev` y el despliegue no se ven
// afectados.
app.use(betterAuth as ComponentDefinition);

export default app;
