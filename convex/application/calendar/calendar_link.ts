/**
 * Vínculo propio con Google Calendar (TI2-161).
 *
 * Capa de Aplicación: coordina la autorización mínima, la validación del
 * retorno OAuth, la revocación en Google y los metadatos locales. No conoce
 * Convex ni Google: recibe puertos y decide solo el flujo. Las credenciales
 * viven cifradas en Better Auth y nunca se devuelven; la única prueba de
 * conexión son los alcances OAuth. Rechazar la autorización responde conectado
 * `false`, nunca bloquea la reserva. Cada persona solo vincula o desconecta su
 * propia cuenta: el `userId` sale del perfil de la sesión, nunca de la entrada.
 * Solo Estudiante y Profesional vinculan y desconectan (RF-27, matriz de
 * Calendar): Practicante y Administrador reciben `unauthorized`.
 */

import { CALENDAR_EVENTS_SCOPE } from "../../domain/calendar/calendar_event";
import {
  canManageCalendarLink,
  type CalendarConnectionMetadata,
} from "../../domain/calendar/calendar_link";
import { isProfileActive } from "../../domain/authorization/permissions";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import type { AuthorizationReader } from "../authorization/authorize";
import type { CalendarConnectionReader } from "./calendar";

/** Lectura del estado OAuth de la sesión, sin credenciales. */
export interface CalendarOAuthLinkReader extends CalendarConnectionReader {
  getAccountReference(): Promise<string | null>;
}

/** Tokens de la cuenta OAuth de la sesión, en texto plano solo en el servidor. */
export interface CalendarOAuthTokens {
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
}

/**
 * Acceso OAuth de la sesión para revocar en Google (TI2-161).
 *
 * Puerto propio de la revocación: leer los tokens, pedirle a Google que
 * invalide el permiso y recién después borrar la fila. No devuelve tokens al
 * cliente ni los recibe como argumento.
 */
export interface CalendarOAuthAccess {
  readTokens(): Promise<
    | { readonly status: "found"; readonly tokens: CalendarOAuthTokens }
    | { readonly status: "missing" }
    | { readonly status: "unavailable" }
  >;
  revokeToken(token: string): Promise<"revoked" | "already_invalid" | "unavailable">;
  deleteAccount(): Promise<"deleted" | "not_found" | "unavailable">;
}

/** Lectura de metadatos locales del vínculo, sin credenciales. */
export interface CalendarLinkMetadataReader {
  readMetadata(userId: string): Promise<CalendarConnectionMetadata | null>;
}

/** Metadatos locales del vínculo, sin credenciales ni estado paralelo. */
export interface CalendarLinkMetadataStore extends CalendarLinkMetadataReader {
  connect(
    userId: string,
    accountReference: string,
    now: number,
  ): Promise<{ readonly status: "linked" | "already_linked" | "invalid_reference" }>;
  disconnect(
    userId: string,
    now: number,
  ): Promise<{ readonly status: "unlinked" | "already_unlinked" | "not_found" }>;
}

/** Estado publicado del vínculo propio. */
export interface CalendarLinkStatus {
  readonly connected: boolean;
  readonly linkedAt?: number;
  readonly revokedAt?: number;
  /** Verdadero tras una desconexión local: los eventos previos pueden quedar sin actualizar. */
  readonly staleEventsMayRemain: boolean;
}

/** Resultado de confirmar el retorno OAuth. */
export type CalendarLinkConfirmResult =
  | {
      readonly connected: true;
      readonly linkedAt: number;
      readonly status: "linked" | "already_linked";
    }
  | { readonly connected: false; readonly status: "not_connected" };

/** Resultado de desconectar el vínculo propio, con aviso de eventos previos. */
export type CalendarLinkDisconnectResult = {
  readonly disconnected: boolean;
  readonly status: "unlinked" | "already_unlinked" | "not_found";
  readonly revokedAt?: number;
  /** Siempre verdadero al desconectar: avisa que los eventos previos pueden quedar sin actualizar. */
  readonly staleEventsMayRemain: boolean;
};

/** Resultado de revocar el permiso en Google, antes de tocar nada local. */
export type CalendarOAuthRevokeResult =
  | { readonly status: "revoked" }
  | { readonly status: "not_found" };

function validNow(now: number): boolean {
  return Number.isFinite(now) && now > 0;
}

/**
 * Perfil titular del vínculo: sesión con perfil vigente y rol de vínculo.
 *
 * Estudiante o Profesional (RF-27, `calendar:link` y `calendar:disconnect`):
 * Practicante y Administrador quedan fuera. Devuelve `null` sin revelar cuál
 * faltó.
 */
async function linkerProfile(
  deps: { readonly auth: AuthorizationReader },
  tokenIdentifier: string | null,
): Promise<{ readonly _id: string } | null> {
  if (tokenIdentifier === null) return null;
  const profile = await deps.auth.findProfileByTokenIdentifier(tokenIdentifier);
  if (profile === null || !isProfileActive(profile)) return null;
  if (!canManageCalendarLink(profile.role)) return null;
  return profile;
}

/**
 * Verdadero cuando la sesión puede vincular o desconectar su cuenta.
 *
 * La acción de desconexión lo consulta antes de revocar en Google, para no
 * tocar un acceso ajeno al rol aunque exista una fila heredada.
 */
export async function checkCalendarLinkAccess(
  deps: { readonly auth: AuthorizationReader },
  input: { readonly tokenIdentifier: string | null },
): Promise<boolean> {
  return (await linkerProfile(deps, input.tokenIdentifier)) !== null;
}

/**
 * Estado del vínculo propio: alcances OAuth más metadatos locales.
 *
 * Solo confirma `connected` con el alcance mínimo de eventos. No devuelve
 * tokens, referencias ni correos. Sin sesión o sin perfil vigente responde
 * `unauthorized` con el código común.
 */
export async function getCalendarLinkStatus(
  deps: {
    readonly auth: AuthorizationReader;
    readonly oauth: Pick<CalendarOAuthLinkReader, "listGoogleScopes">;
    readonly store: Pick<CalendarLinkMetadataStore, "readMetadata">;
  },
  input: { readonly tokenIdentifier: string | null },
): Promise<ApiResult<CalendarLinkStatus>> {
  if (input.tokenIdentifier === null) return errResult(unauthorizedError());
  const profile = await deps.auth.findProfileByTokenIdentifier(input.tokenIdentifier);
  if (profile === null || !isProfileActive(profile)) return errResult(unauthorizedError());
  const scopes = await deps.oauth.listGoogleScopes();
  const connected = scopes !== null && scopes.includes(CALENDAR_EVENTS_SCOPE);
  const metadata = await deps.store.readMetadata(profile._id);
  const revokedAt = metadata?.revokedAt;
  return okResult({
    connected,
    ...(metadata?.linkedAt === undefined ? {} : { linkedAt: metadata.linkedAt }),
    ...(revokedAt === undefined ? {} : { revokedAt }),
    staleEventsMayRemain: revokedAt !== undefined,
  });
}

/**
 * Confirma el retorno OAuth y registra los metadatos del vínculo propio.
 *
 * Solo Estudiante y Profesional (RF-27, `calendar:link`): otros roles reciben
 * `unauthorized`. Valida que el alcance mínimo esté concedido; si la persona
 * rechazó la autorización responde `connected: false` sin error, así reservar
 * sigue disponible. La referencia de cuenta se resuelve en el servidor, nunca
 * llega del cliente. Un instante inválido responde `conflict` con el código
 * común.
 */
export async function confirmCalendarLink(
  deps: {
    readonly auth: AuthorizationReader;
    readonly oauth: CalendarOAuthLinkReader;
    readonly store: CalendarLinkMetadataStore;
    readonly now: () => number;
  },
  input: { readonly tokenIdentifier: string | null },
): Promise<ApiResult<CalendarLinkConfirmResult>> {
  if (input.tokenIdentifier === null) return errResult(unauthorizedError());
  const profile = await linkerProfile(deps, input.tokenIdentifier);
  if (profile === null) {
    return errResult(unauthorizedError());
  }
  const now = deps.now();
  if (!validNow(now)) return errResult(conflictError());
  const scopes = await deps.oauth.listGoogleScopes();
  if (scopes === null || !scopes.includes(CALENDAR_EVENTS_SCOPE)) {
    return okResult({ connected: false as const, status: "not_connected" as const });
  }
  const reference = await deps.oauth.getAccountReference();
  if (reference === null || reference.trim() === "") {
    return okResult({ connected: false as const, status: "not_connected" as const });
  }
  const stored = await deps.store.connect(profile._id, reference, now);
  if (stored.status === "invalid_reference") return errResult(unauthorizedError());
  const metadata = await deps.store.readMetadata(profile._id);
  const linkedAt = metadata?.linkedAt ?? now;
  return okResult({ connected: true as const, linkedAt, status: stored.status });
}

/**
 * Revoca el permiso en Google sin tocar nada local (TI2-161).
 *
 * Lee los tokens de la sesión, revoca en Google el refresh token (que invalida
 * el permiso completo; sin refresh revoca el access token) y recién después
 * borra la fila de la cuenta. Un token ya inválido cuenta como revocado. Si la
 * revocación no se puede completar responde `conflict`: el llamante no debe
 * marcar nada local. Sin cuenta vinculada responde `not_found`.
 */
export async function revokeCalendarOAuthAccess(deps: {
  readonly access: CalendarOAuthAccess;
}): Promise<ApiResult<CalendarOAuthRevokeResult>> {
  const read = await deps.access.readTokens();
  if (read.status === "unavailable") return errResult(conflictError());
  if (read.status === "missing") return okResult({ status: "not_found" });
  const token = read.tokens.refreshToken ?? read.tokens.accessToken;
  if (token === null) {
    const deleted = await deps.access.deleteAccount();
    if (deleted === "unavailable") return errResult(conflictError());
    return okResult({ status: "revoked" });
  }
  const revoked = await deps.access.revokeToken(token);
  if (revoked === "unavailable") return errResult(conflictError());
  const deleted = await deps.access.deleteAccount();
  if (deleted === "unavailable") return errResult(conflictError());
  return okResult({ status: "revoked" });
}

/**
 * Marca la desconexión local tras revocar en Google.
 *
 * Solo Estudiante y Profesional (RF-27, `calendar:disconnect`): otros roles
 * reciben `unauthorized`. Solo toca la fila de la sesión; nunca acepta un
 * `userId` del cliente. No borra eventos ya creados: la respuesta avisa que
 * pueden quedar sin actualizar. Idempotente: repetirla responde
 * `already_unlinked` o `not_found` sin error, así rechazar o repetir no
 * bloquea la reserva.
 */
export async function markCalendarDisconnected(
  deps: {
    readonly auth: AuthorizationReader;
    readonly store: CalendarLinkMetadataStore;
    readonly now: () => number;
  },
  input: { readonly tokenIdentifier: string | null; readonly revoked: "revoked" | "not_found" },
): Promise<ApiResult<CalendarLinkDisconnectResult>> {
  if (input.tokenIdentifier === null) return errResult(unauthorizedError());
  const profile = await linkerProfile(deps, input.tokenIdentifier);
  if (profile === null) {
    return errResult(unauthorizedError());
  }
  const now = deps.now();
  if (!validNow(now)) return errResult(conflictError());
  const stored = await deps.store.disconnect(profile._id, now);
  if (stored.status === "not_found" && input.revoked === "not_found") {
    return okResult({ disconnected: false, status: "not_found", staleEventsMayRemain: false });
  }
  const metadata = await deps.store.readMetadata(profile._id);
  return okResult({
    disconnected: true,
    status: stored.status === "not_found" ? "unlinked" : stored.status,
    ...(metadata?.revokedAt === undefined ? {} : { revokedAt: metadata.revokedAt }),
    staleEventsMayRemain: true,
  });
}
