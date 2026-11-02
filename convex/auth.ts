import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { genericOAuth, type GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { env } from "./_generated/server";
import {
  rejectExternalSession,
  rejectExternalUser,
  toInstitutionalGoogleUserInfo,
} from "./application/session/reject_external_user";
import authConfig from "./auth.config";
import {
  GOOGLE_PROVIDER_ID_BY_POPULATION,
  HOSTED_DOMAIN_BY_POPULATION,
  type InstitutionalPopulation,
} from "./domain/auth/institutional_domain";

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

/**
 * Inicio de Google de una población (TI2-131), sobre el mismo OAuth Client.
 *
 * Better Auth 1.6.x solo lee `hd` de la configuración global del proveedor
 * `google` y no admite dos proveedores con ese id, así que cada población usa
 * su propio proveedor `genericOAuth`. `hd` en la URL hace que Google ofrezca
 * solo cuentas de ese dominio, pero es una pista de UX: la garantía es
 * `getUserInfo`, que rechaza (devuelve `null`) la cuenta sin correo verificado,
 * de otro sufijo o con otro claim `hd`. El callback es
 * `{CONVEX_SITE_URL}/api/auth/oauth2/callback/<providerId>` y debe
 * registrarse en Google Cloud Console.
 */
function googleWorkspaceProvider(population: InstitutionalPopulation): GenericOAuthConfig {
  return {
    providerId: GOOGLE_PROVIDER_ID_BY_POPULATION[population],
    discoveryUrl: "https://accounts.google.com/.well-known/openid-configuration",
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    // Solo identidad: pedir Calendar, Drive o correo queda prohibido.
    scopes: ["openid", "email", "profile"],
    prompt: "select_account",
    pkce: true,
    authorizationUrlParams: { hd: HOSTED_DOMAIN_BY_POPULATION[population] },
    getUserInfo: async (tokens) => toInstitutionalGoogleUserInfo(tokens.idToken, population),
  };
}

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    // Base de `/api/auth/*`: el Site URL de Convex. El callback OAuth de
    // Google es `{CONVEX_SITE_URL}/api/auth/callback/google` y debe
    // registrarse exacto en Google Cloud Console.
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
          before: async (session, context) => {
            const user =
              context === null
                ? null
                : await context.context.internalAdapter.findUserById(session.userId);
            return rejectExternalSession(user);
          },
        },
      },
    },
    // Las cuentas creadas con el proveedor `google` se vinculan por correo al
    // volver a ingresar por `google-alu` o `google-uct`, y conservan su perfil.
    account: {
      accountLinking: {
        trustedProviders: Object.values(GOOGLE_PROVIDER_ID_BY_POPULATION),
      },
    },
    socialProviders: {
      // Proveedor heredado de TI2-3, mientras se verifican los callbacks de
      // `google-alu` y `google-uct` en Google Cloud Console; la Web ya no lo
      // usa y se retira cuando ambos funcionen. `hd: "*"` rechaza tokens sin
      // dominio de Workspace (cuentas personales) aunque se invoque a mano;
      // el sufijo lo siguen exigiendo los `databaseHooks`.
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: "select_account",
        hd: "*",
      },
    },
    plugins: [
      genericOAuth({
        config: [googleWorkspaceProvider("estudiante"), googleWorkspaceProvider("personal")],
      }),
      // Requerido para SPA (Vite): permite cookies entre el origen web y el
      // Site URL de Convex.
      crossDomain({ siteUrl: env.SITE_URL }),
      // Compatibilidad Convex: emite el JWT que verifica `ctx.auth`.
      convex({ authConfig }),
    ],
  });
};
