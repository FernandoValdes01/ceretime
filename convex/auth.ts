import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

/**
 * Infraestructura de autenticación (TI2-3).
 *
 * Better Auth corre como rutas HTTP dentro del deployment Convex y persiste
 * sus tablas (user, session, account, verification) en el componente
 * `betterAuth`. Este archivo no contiene reglas de negocio ni autorización
 * por rol: solo proveedor Google Workspace, callback y sesión.
 */

export const authComponent = createClient<DataModel>(components.betterAuth);

function resolveSiteUrl(): string {
  const siteUrl = process.env.SITE_URL;
  if (typeof siteUrl === "string" && siteUrl.length > 0) return siteUrl;
  // Solo para que `convex dev` sincronice sin secretos locales; el despliegue
  // real siempre define SITE_URL (origen Vite/Vercel).
  return "http://localhost:5173";
}

function resolveTrustedOrigins(siteUrl: string): string[] {
  const origins = new Set<string>([siteUrl]);
  const convexSiteUrl = process.env.CONVEX_SITE_URL;
  if (typeof convexSiteUrl === "string" && convexSiteUrl.length > 0) {
    origins.add(convexSiteUrl);
  }
  const extra = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  if (typeof extra === "string" && extra.length > 0) {
    for (const origin of extra.split(",")) {
      const trimmed = origin.trim();
      if (trimmed.length > 0) origins.add(trimmed);
    }
  }
  return [...origins];
}

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const siteUrl = resolveSiteUrl();
  return betterAuth({
    // Base de `/api/auth/*`: el Site URL de Convex. El callback OAuth de
    // Google es `{CONVEX_SITE_URL}/api/auth/callback/google` y debe
    // registrarse exacto en Google Cloud Console.
    baseURL: process.env.CONVEX_SITE_URL,
    trustedOrigins: resolveTrustedOrigins(siteUrl),
    database: authComponent.adapter(ctx),
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        // Solo identidad (openid, email, profile). Pedir Calendar, Drive o
        // correo queda prohibido en Sprint 1.
        prompt: "select_account",
        // Sin `hd` global: Better Auth acepta un solo dominio y el proyecto
        // necesita dos poblaciones (`alu.uct.cl` y `uct.cl`). Cada inicio
        // envía su `hd` como sugerencia UX (`additionalParams`) y el servidor
        // valida el sufijo del correo antes de considerar la sesión útil.
      },
    },
    plugins: [
      // Requerido para SPA (Vite): permite cookies entre el origen web y el
      // Site URL de Convex.
      crossDomain({ siteUrl }),
      // Compatibilidad Convex: emite el JWT que verifica `ctx.auth`.
      convex({ authConfig }),
    ],
  });
};
