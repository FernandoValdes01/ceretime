import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { env } from "./_generated/server";
import {
  rejectExternalSession,
  rejectExternalUser,
} from "./application/session/reject_external_user";
import authConfig from "./auth.config";
import { GOOGLE_PROVIDER_ID_BY_POPULATION } from "./domain/auth/institutional_domain";
import {
  googleWorkspaceProvider,
  rejectClientScopes,
} from "./infrastructure/auth/google_providers";

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
  const googleCredentials = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
  return betterAuth({
    // Base de `/api/auth/*`: el Site URL de Convex. Los callbacks OAuth de
    // Google son `{CONVEX_SITE_URL}/api/auth/oauth2/callback/google-alu` y
    // `.../google-uct`, y deben registrarse exactos en Google Cloud Console.
    baseURL: env.CONVEX_SITE_URL,
    trustedOrigins: resolveTrustedOrigins(env.SITE_URL),
    // Página de error controlada (TI2-14): los callbacks inválidos que no
    // conservan estado de flujo regresan a la SPA con el marcador
    // `?auth=error` en vez de la página predeterminada de Better Auth. El
    // proveedor agrega `&error=...`, que la Web traduce a un mensaje genérico.
    onAPIError: { errorURL: `${env.SITE_URL}/?auth=error` },
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
      // TI2-131: un usuario existente con correo no institucional tampoco
      // obtiene sesión nueva, sea cual sea el proveedor que la pida.
      session: {
        create: {
          before: (session, context) =>
            rejectExternalSession(
              session.userId,
              context === null
                ? null
                : (userId) => context.context.internalAdapter.findUserById(userId),
            ),
        },
      },
    },
    // Las cuentas creadas con el proveedor `google` de TI2-3 (ya retirado) se
    // vinculan por correo al volver a ingresar por `google-alu` o
    // `google-uct`, y conservan su perfil.
    account: {
      accountLinking: {
        trustedProviders: Object.values(GOOGLE_PROVIDER_ID_BY_POPULATION),
      },
    },
    // El cliente no puede ampliar los alcances de Google (solo identidad).
    hooks: { before: rejectClientScopes },
    plugins: [
      genericOAuth({
        config: [
          googleWorkspaceProvider("estudiante", googleCredentials),
          googleWorkspaceProvider("personal", googleCredentials),
        ],
      }),
      // Requerido para SPA (Vite): permite cookies entre el origen web y el
      // Site URL de Convex.
      crossDomain({ siteUrl: env.SITE_URL }),
      // Compatibilidad Convex: emite el JWT que verifica `ctx.auth`.
      convex({ authConfig }),
    ],
  });
};
