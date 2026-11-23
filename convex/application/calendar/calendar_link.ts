/**
 * Vínculo propio con Google Calendar (TI2-161).
 *
 * Capa de Aplicación: coordina la autorización mínima, la validación del
 * retorno OAuth y los metadatos locales. No conoce Convex ni Google: recibe
 * puertos y decide solo el flujo. Las credenciales viven cifradas en Better
 * Auth y nunca se devuelven; la única prueba de conexión son los alcances
 * OAuth. Rechazar la autorización responde conectado `false`, nunca bloquea
 * la reserva. Cada persona solo vincula o desconecta su propia cuenta: el
 * `userId` sale del perfil de la sesión, nunca de la entrada.
 */

import { CALENDAR_EVENTS_SCOPE } from "../../domain/calendar/calendar_event";
import type { CalendarConnectionMetadata } from "../../domain/calendar/calendar_link";
import { isProfileActive } from "../../domain/authorization/permissions";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import type { AuthorizationReader } from "../authorization/authorize";

/** Lectura del estado OAuth de la sesión, sin credenciales. */
export interface CalendarOAuthLinkReader {
  listGoogleScopes(): Promise<readonly string[] | null>;
  getAccountReference(): Promise<string | null>;
}

/** Metadatos locales del vínculo, sin credenciales ni estado paralelo. */
export interface CalendarLinkMetadataStore {
  readMetadata(userId: string): Promise<CalendarConnectionMetadata | null>;
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

function validNow(now: number): boolean {
  return Number.isFinite(now) && now > 0;
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
 * Valida que el alcance mínimo esté concedido; si la persona rechazó la
 * autorización responde `connected: false` sin error, así reservar sigue
 * disponible. La referencia de cuenta se resuelve en el servidor, nunca llega
 * del cliente. Un instante inválido responde `conflict` con el código común.
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
  const profile = await deps.auth.findProfileByTokenIdentifier(input.tokenIdentifier);
  if (profile === null || !isProfileActive(profile)) return errResult(unauthorizedError());
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
 * Desconecta el vínculo propio conservando trazabilidad.
 *
 * Solo toca la fila de la sesión; nunca acepta un `userId` del cliente. No
 * borra eventos ya creados: la respuesta avisa que pueden quedar sin
 * actualizar. Idempotente: repetirla responde `already_unlinked` o `not_found`
 * sin error, así rechazar o repetir no bloquea la reserva.
 */
export async function disconnectCalendarLink(
  deps: {
    readonly auth: AuthorizationReader;
    readonly store: CalendarLinkMetadataStore;
    readonly now: () => number;
  },
  input: { readonly tokenIdentifier: string | null },
): Promise<ApiResult<CalendarLinkDisconnectResult>> {
  if (input.tokenIdentifier === null) return errResult(unauthorizedError());
  const profile = await deps.auth.findProfileByTokenIdentifier(input.tokenIdentifier);
  if (profile === null || !isProfileActive(profile)) return errResult(unauthorizedError());
  const now = deps.now();
  if (!validNow(now)) return errResult(conflictError());
  const stored = await deps.store.disconnect(profile._id, now);
  if (stored.status === "not_found") {
    return okResult({ disconnected: false, status: "not_found", staleEventsMayRemain: false });
  }
  const metadata = await deps.store.readMetadata(profile._id);
  return okResult({
    disconnected: true,
    status: stored.status,
    ...(metadata?.revokedAt === undefined ? {} : { revokedAt: metadata.revokedAt }),
    staleEventsMayRemain: true,
  });
}
