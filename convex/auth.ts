import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { env } from "./_generated/server";
import { rejectExternalUser } from "./application/session/reject_external_user";
import authConfig from "./auth.config";

/**
 * Infraestructura de autenticación (TI2-3).
 *
 * Better Auth corre como rutas HTTP dentro del deployment Convex y persiste
 * sus tablas (user, session, account, verification) en el componente
 * `betterAuth`. Este archivo no contiene autorización por rol: solo proveedor
 * Google Workspace, callback, sesión y rechazo de dominios no
 * institucionales.
 */

export const authComponent = createClient<DataModel>(components.betterAuth);

function resolveTrustedOrigins(siteUrl: string): string[] {
  const origins = new Set<string>([siteUrl, env.CONVEX_SITE_URL]);
  const extra = env.BETTER_AUTH_TRUSTED_ORIGINS;
  if (typeof extra === "string" && extra.length > 0) {
    for (const origin of extra.split(",")) {
      const trimmed = origin.trim();
      if (trimmed.length > 0) origins.add(trimmed);
    }
  }
  return [...origins];
}

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    // Base de `/api/auth/*`: el Site URL de Convex. El callback OAuth de
    // Google es `{CONVEX_SITE_URL}/api/auth/callback/google` y debe
    // registrarse exacto en Google Cloud Console.
    baseURL: env.CONVEX_SITE_URL,
    trustedOrigins: resolveTrustedOrigins(env.SITE_URL),
    database: authComponent.adapter(ctx),
    // Rechazo real en el backend: una cuenta Google fuera de `@alu.uct.cl` y
    // `@uct.cl` no crea usuario ni sesión (retornar `false` cancela la
    // creación). El cliente solo recibe el error genérico vía
    // `errorCallbackURL`, sin el motivo.
    databaseHooks: {
      user: {
        create: {
          before: (user) => rejectExternalUser(user.email),
        },
      },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        // Solo identidad (openid, email, profile). Pedir Calendar, Drive o
        // correo queda prohibido en Sprint 1.
        prompt: "select_account",
        // Sin `hd`: esta versión de Better Auth (1.6.x) no acepta parámetros
        // por llamada (`additionalParams` no existe en `/sign-in/social` y
        // zod los recorta en silencio) y el proveedor solo admite un dominio
        // global. La garantía es el `databaseHooks` de arriba, no Google.
      },
    },
    plugins: [
      // Requerido para SPA (Vite): permite cookies entre el origen web y el
      // Site URL de Convex.
      crossDomain({ siteUrl: env.SITE_URL }),
      // Compatibilidad Convex: emite el JWT que verifica `ctx.auth`.
      convex({ authConfig }),
    ],
  });
};
