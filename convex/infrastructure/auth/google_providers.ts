import { APIError, createAuthMiddleware } from "better-auth/api";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { toInstitutionalGoogleUserInfo } from "../../application/session/reject_external_user";
import { CALENDAR_EVENTS_SCOPE } from "../../domain/calendar/calendar_event";
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

function isBodyRecord(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null;
}

/**
 * Verdadero si la petición intenta agregar alcances fuera del contrato.
 *
 * TI2-122: la única excepción es vincular Calendar con `google` pidiendo
 * exactamente `calendar.events`. El inicio institucional y la vinculación
 * genérica siguen sin aceptar `scopes` del cliente.
 */
export function requestsClientScopes(path: string, body: unknown): boolean {
  if (!PATHS_WITH_CLIENT_SCOPES.includes(path)) return false;
  if (!isBodyRecord(body) || !("scopes" in body) || body.scopes === undefined) return false;
  if (path === "/link-social") {
    return !(
      body.provider === "google" &&
      Array.isArray(body.scopes) &&
      body.scopes.length === 1 &&
      body.scopes[0] === CALENDAR_EVENTS_SCOPE
    );
  }
  return true;
}

/**
 * Verdadero si se intenta iniciar sesión con `google`, que quedó limitado a
 * vincular Calendar (TI2-122). El inicio debe pasar por `google-alu` o
 * `google-uct`, donde `getUserInfo` valida el ID token (TI2-131).
 */
export function requestsGoogleSignIn(path: string, body: unknown): boolean {
  return path === "/sign-in/social" && isBodyRecord(body) && body.provider === "google";
}

/**
 * Hook global de Google: bloquea el inicio por `google` y los alcances que el
 * cliente no puede ampliar.
 */
export const guardGoogleOAuth = createAuthMiddleware(async (ctx) => {
  if (requestsGoogleSignIn(ctx.path, ctx.body)) {
    throw new APIError("BAD_REQUEST");
  }
  if (requestsClientScopes(ctx.path, ctx.body)) {
    throw new APIError("BAD_REQUEST");
  }
});
