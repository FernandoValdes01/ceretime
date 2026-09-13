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
  },
});
// Cast acotado a este borde: Bun aísla `convex` por workspace y el `tsc`
// local ve dos copias idénticas (v1.45.0) como tipos distintos. En ejecución
// es el mismo objeto de definición; `convex dev` y el despliegue no se ven
// afectados.
app.use(betterAuth as ComponentDefinition);

export default app;
