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
import { googleWorkspaceProvider, guardGoogleOAuth } from "./infrastructure/auth/google_providers";

/**
 * Infraestructura de autenticación (TI2-3).
 *
 * Better Auth corre como rutas HTTP dentro del deployment Convex y persiste
 * sus tablas (user, session, account, verification) en el componente
 * `betterAuth`. Este archivo no contiene autorización por rol: solo cablea
 * los proveedores institucionales `google-alu`/`google-uct` (TI2-131), el
 * proveedor `google` limitado a vincular Calendar (TI2-122), la sesión y el
 * rechazo de dominios no institucionales.
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
    // `.../google-uct` para el inicio institucional, y
    // `{CONVEX_SITE_URL}/api/auth/callback/google` para vincular Calendar
    // (TI2-122). Los tres deben registrarse exactos en Google Cloud Console.
    baseURL: env.CONVEX_SITE_URL,
    trustedOrigins: resolveTrustedOrigins(env.SITE_URL),
    // Página de error controlada (TI2-14): los callbacks inválidos que no
    // conservan estado de flujo regresan a la SPA con el marcador
    // `?auth=error` en vez de la página predeterminada de Better Auth. El
    // proveedor agrega `&error=...`, que la Web traduce a un mensaje genérico.
    onAPIError: { errorURL: `${env.SITE_URL}/?auth=error` },
    database: authComponent.adapter(ctx),
    // Los tokens OAuth (incluido el refresh token de Google Calendar) se
    // cifran en reposo en el componente de autenticación (TI2-122). Better
    // Auth descifra los tokens heredados en texto plano sin romper sesiones.
    //
    // Las cuentas creadas con el proveedor `google` de TI2-3 se vinculan por
    // correo al volver a ingresar por `google-alu` o `google-uct`, y
    // conservan su perfil (TI2-131). `google` queda solo para Calendar.
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        trustedProviders: Object.values(GOOGLE_PROVIDER_ID_BY_POPULATION),
      },
    },
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
    // TI2-122: `google` existe solo para vincular Google Calendar. El inicio
    // de sesión usa `google-alu`/`google-uct`; el hook global rechaza
    // `/sign-in/social` con `provider: "google"`, así que este proveedor no
    // puede crear usuarios ni sesiones por su cuenta.
    //
    // `offline` + `consent` garantizan refresh token para que la creación del
    // evento siga funcionando cuando el access token expire. El alcance de
    // Calendar se concede solo en la vinculación explícita (`linkSocial` con
    // `calendar.events`).
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        accessType: "offline",
        prompt: "select_account consent",
      },
    },
    // El inicio por `google` queda bloqueado (solo vincula Calendar) y el
    // cliente solo puede pedir `calendar.events` en esa vinculación.
    hooks: { before: guardGoogleOAuth },
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
