import { APIError, createAuthMiddleware } from "better-auth/api";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { toInstitutionalGoogleUserInfo } from "../../application/session/reject_external_user";
import {
  GOOGLE_PROVIDER_ID_BY_POPULATION,
  HOSTED_DOMAIN_BY_POPULATION,
  type InstitutionalPopulation,
} from "../../domain/auth/institutional_domain";

/**
 * Configuración de Google para Better Auth (TI2-131).
 *
 * Capa de Infraestructura: recibe las credenciales como parámetro en vez de
 * leer `env`, para que `convex/auth.ts` solo las cablee y las pruebas puedan
 * revisar la configuración de cada población sin un deployment.
 */

export interface GoogleOAuthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Alcances de identidad: pedir Calendar, Drive o correo queda prohibido. */
export const GOOGLE_IDENTITY_SCOPES = ["openid", "email", "profile"] as const;

/**
 * Inicio de Google de una población, sobre el mismo OAuth Client.
 *
 * Better Auth 1.6.x solo lee `hd` de la configuración global del proveedor
 * `google` y no admite dos proveedores con ese id, así que cada población usa
 * su propio proveedor `genericOAuth`. `hd` en la URL hace que Google ofrezca
 * solo cuentas de ese dominio, pero es una pista de UX: la garantía es
 * `getUserInfo`, que rechaza (devuelve `null`) la cuenta sin correo verificado,
 * de otro sufijo o con otro claim `hd`. El callback es
 * `{CONVEX_SITE_URL}/api/auth/oauth2/callback/<providerId>` y debe
 * registrarse en Google Cloud Console.
 *
 * Los endpoints de Google son estables y van fijos: con `discoveryUrl`,
 * Better Auth descargaría el documento de discovery en cada inicio y en cada
 * callback. `issuer` mantiene la validación del parámetro `iss` del callback.
 */
export function googleWorkspaceProvider(
  population: InstitutionalPopulation,
  credentials: GoogleOAuthCredentials,
): GenericOAuthConfig {
  return {
    providerId: GOOGLE_PROVIDER_ID_BY_POPULATION[population],
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    issuer: "https://accounts.google.com",
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    scopes: [...GOOGLE_IDENTITY_SCOPES],
    prompt: "select_account",
    pkce: true,
    authorizationUrlParams: { hd: HOSTED_DOMAIN_BY_POPULATION[population] },
    getUserInfo: async (tokens) =>
      toInstitutionalGoogleUserInfo(tokens.idToken, population, credentials.clientId),
  };
}

/**
 * Rutas de Better Auth que suman los `scopes` del cuerpo de la petición a los
 * configurados; con ellos el cliente podría pedir permisos fuera de identidad.
 */
const PATHS_WITH_CLIENT_SCOPES: readonly string[] = [
  "/sign-in/oauth2",
  "/sign-in/social",
  "/oauth2/link",
  "/link-social",
];

/** Verdadero si la petición intenta agregar alcances desde el cliente. */
export function requestsClientScopes(path: string, body: unknown): boolean {
  if (!PATHS_WITH_CLIENT_SCOPES.includes(path)) return false;
  if (typeof body !== "object" || body === null || !("scopes" in body)) return false;
  return body.scopes !== undefined;
}

/** Hook global que rechaza los `scopes` enviados por el cliente. */
export const rejectClientScopes = createAuthMiddleware(async (ctx) => {
  if (requestsClientScopes(ctx.path, ctx.body)) {
    throw new APIError("BAD_REQUEST");
  }
});
