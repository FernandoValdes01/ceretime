/**
 * Adaptador de Google Calendar (TI2-122).
 *
 * Capa de Infraestructura: único lugar que habla con el proveedor y con los
 * tokens OAuth de Better Auth. No decide autorización ni reglas del evento:
 * recibe la forma ya construida por Aplicación/Dominio y traduce el resultado
 * a estados públicos sin respuestas, encabezados ni credenciales.
 *
 * El alcance se limita a crear eventos (`calendar.events`); nunca se listan ni
 * se leen calendarios. Los tokens viven en el componente de autenticación y
 * solo se usan en el servidor: no se registran, no se devuelven al cliente y
 * no se incluyen en el `.ics`.
 */

import type { ActionCtx, MutationCtx, QueryCtx } from "../../_generated/server";
import { components } from "../../_generated/api";
import { authComponent, createAuth } from "../../auth";
import { CALENDAR_EVENTS_SCOPE } from "../../domain/calendar/calendar_event";
import { decryptOAuthToken } from "better-auth/oauth2";

/** Cliente OAuth de Google para renovar tokens en segundo plano (TI2-162). */
export interface CalendarOAuthClientConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Variables de entorno que configuran el cliente OAuth; todas opcionales. */
export interface CalendarOAuthClientEnv {
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
}

/**
 * Configuración del cliente OAuth, o `null` si falta alguna credencial. Sin
 * cliente no se puede renovar en segundo plano: el despacho registra
 * `unavailable` y reintenta después, sin pedir volver a vincular.
 */
export function calendarOAuthClientConfigFromEnv(
  env: CalendarOAuthClientEnv,
): CalendarOAuthClientConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  if (clientId === "" || clientSecret === "") return null;
  return { clientId, clientSecret };
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

type RefreshedAccessToken =
  | { readonly status: "ok"; readonly accessToken: string }
  | { readonly status: "not_connected" }
  | { readonly status: "unavailable" };

/** Canjea el refresh token por uno de acceso, sin exponer la respuesta. */
async function fetchAccessTokenWithRefresh(
  refreshToken: string,
  config: CalendarOAuthClientConfig | null,
  fetchImpl: typeof fetch = fetch,
): Promise<RefreshedAccessToken> {
  if (config === null) return { status: "unavailable" };
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch {
    return { status: "unavailable" };
  }
  if (response.status === 400 || response.status === 401) {
    return { status: "not_connected" };
  }
  if (!response.ok) return { status: "unavailable" };
  try {
    const payload: unknown = await response.json();
    const accessToken =
      typeof payload === "object" && payload !== null
        ? (payload as { readonly access_token?: unknown }).access_token
        : undefined;
    if (typeof accessToken === "string" && accessToken.length > 0) {
      return { status: "ok", accessToken };
    }
  } catch {
    // Sin cuerpo legible no hay token.
  }
  return { status: "unavailable" };
}

/** Contexto de descifrado que espera Better Auth (mismo objeto de `$context`). */
type DecryptContext = Parameters<typeof decryptOAuthToken>[1];

/** Tope de la revocación en Google: sin él, una Google colgada deja la acción esperando hasta el límite de Convex. */
const REVOKE_TIMEOUT_MS = 10_000;

/**
 * Señal de tope para la revocación, o ausente si el runtime no la soporta.
 *
 * El runtime de Convex no garantiza `AbortSignal` (su documentación no lo
 * lista): si no existe ni `AbortController`, se revoca sin tope y la acción
 * sigue acotada por el límite de Convex.
 */
function revokeTimeoutSignal(): {
  readonly signal: AbortSignal | undefined;
  readonly done: () => void;
} {
  try {
    if (typeof AbortSignal !== "undefined") {
      const withTimeout = AbortSignal as unknown as {
        readonly timeout?: (ms: number) => AbortSignal;
      };
      if (typeof withTimeout.timeout === "function") {
        return { signal: withTimeout.timeout(REVOKE_TIMEOUT_MS), done: () => undefined };
      }
    }
    if (typeof AbortController !== "undefined" && typeof setTimeout === "function") {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REVOKE_TIMEOUT_MS);
      const done = () => {
        if (typeof clearTimeout === "function") clearTimeout(timer);
      };
      return { signal: controller.signal, done };
    }
  } catch {
    // Sin temporizador: el fetch decide.
  }
  return { signal: undefined, done: () => undefined };
}

/** Resultado del adaptador, estructuralmente igual al puerto de Aplicación. */
export type GoogleCalendarCreateResult =
  | { readonly status: "created"; readonly eventId: string }
  | { readonly status: "already_exists"; readonly eventId: string }
  | { readonly status: "not_connected" }
  | { readonly status: "unavailable" };

/** Resultado de actualizar el evento existente de una atención. */
export type GoogleCalendarUpdateResult =
  | { readonly status: "updated"; readonly eventId: string }
  | { readonly status: "not_connected" }
  | { readonly status: "unavailable" };

/** Resultado de eliminar el evento de una atención cancelada. */
export type GoogleCalendarDeleteResult =
  | { readonly status: "deleted"; readonly eventId: string }
  | { readonly status: "not_found"; readonly eventId: string }
  | { readonly status: "not_connected" }
  | { readonly status: "unavailable" };

type GoogleAccess =
  | { readonly status: "ok"; readonly accessToken: string; readonly scopes: readonly string[] }
  | { readonly status: "not_connected" };

/**
 * Token vigente de la cuenta Google de la sesión. Better Auth lo renueva si
 * está por expirar; un token revocado, ausente o sin refresh token se traduce
 * a `not_connected` para que la interfaz ofrezca volver a conectar. Nunca se
 * expone el error del proveedor.
 */
async function readGoogleAccess(ctx: ActionCtx): Promise<GoogleAccess> {
  try {
    const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
    const token = await auth.api.getAccessToken({
      body: { providerId: "google" },
      headers,
    });
    return {
      status: "ok",
      accessToken: token.accessToken,
      scopes: token.scopes ?? [],
    };
  } catch {
    return { status: "not_connected" };
  }
}

function readEventId(payload: unknown, fallback: string): string {
  if (typeof payload !== "object" || payload === null) return fallback;
  const id = (payload as { readonly id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : fallback;
}

/**
 * Descifra un token OAuth guardado por Better Auth.
 *
 * Ausente no es lo mismo que ilegible: un campo vacío significa que no hay
 * nada que revocar o renovar; un cifrado que no abre significa que no se
 * puede confirmar el estado y el llamante no debe afirmar nada.
 */
async function decodeTokenValue(
  value: unknown,
  context: DecryptContext,
): Promise<string | null | "unreadable"> {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const plain = await decryptOAuthToken(value, context);
    return typeof plain === "string" && plain.length > 0 ? plain : null;
  } catch {
    return "unreadable";
  }
}

/** Forma de un evento para crear o actualizar, sin credenciales. */
export interface CalendarEventWrite {
  readonly googleEventId: string;
  readonly title: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly timeZone: string;
}

/**
 * Llamadas HTTP a Google Calendar con un `accessToken` ya resuelto.
 *
 * Punto único de traducción del proveedor: las puertas de sesión y de segundo
 * plano las comparten, así un cambio en el descifrado o en una respuesta se
 * hace una sola vez. El `id` determinista del evento hace que un reintento o
 * un doble clic reciba `409` y se trate como éxito, sin duplicar.
 */
export async function postCalendarEvent(
  accessToken: string,
  input: CalendarEventWrite,
): Promise<GoogleCalendarCreateResult> {
  try {
    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: input.googleEventId,
          summary: input.title,
          start: {
            dateTime: new Date(input.startAt).toISOString(),
            timeZone: input.timeZone,
          },
          end: {
            dateTime: new Date(input.endAt).toISOString(),
            timeZone: input.timeZone,
          },
        }),
      },
    );
    if (response.status === 409) {
      return { status: "already_exists", eventId: input.googleEventId };
    }
    if (response.status === 401) return { status: "not_connected" };
    if (!response.ok) return { status: "unavailable" };
    const payload: unknown = await response.json();
    return { status: "created", eventId: readEventId(payload, input.googleEventId) };
  } catch {
    return { status: "unavailable" };
  }
}

/** Actualiza el evento existente con el mismo `id` ya guardado. */
export async function patchCalendarEvent(
  accessToken: string,
  input: CalendarEventWrite,
): Promise<GoogleCalendarUpdateResult> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.googleEventId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: input.title,
          start: {
            dateTime: new Date(input.startAt).toISOString(),
            timeZone: input.timeZone,
          },
          end: {
            dateTime: new Date(input.endAt).toISOString(),
            timeZone: input.timeZone,
          },
        }),
      },
    );
    if (response.status === 401) return { status: "not_connected" };
    if (!response.ok) return { status: "unavailable" };
    const payload: unknown = await response.json();
    return { status: "updated", eventId: readEventId(payload, input.googleEventId) };
  } catch {
    return { status: "unavailable" };
  }
}

/** Elimina el evento de una atención cancelada; ausente cuenta como éxito. */
export async function deleteCalendarEvent(
  accessToken: string,
  input: {
    readonly googleEventId: string;
  },
): Promise<GoogleCalendarDeleteResult> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.googleEventId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    if (response.status === 401) return { status: "not_connected" };
    if (response.status === 404 || response.status === 410) {
      return { status: "not_found", eventId: input.googleEventId };
    }
    if (!response.ok) return { status: "unavailable" };
    return { status: "deleted", eventId: input.googleEventId };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Puerta de creación y actualización de eventos con la sesión (TI2-122).
 *
 * Solo resuelve el token de la sesión y delega en las llamadas compartidas.
 * La eliminación vive solo en la sincronización en segundo plano (TI2-162).
 */
export function googleCalendarGateway(ctx: ActionCtx) {
  return {
    createEvent: async (input: CalendarEventWrite): Promise<GoogleCalendarCreateResult> => {
      const access = await readGoogleAccess(ctx);
      if (access.status !== "ok") return access;
      if (!access.scopes.includes(CALENDAR_EVENTS_SCOPE)) return { status: "not_connected" };
      return await postCalendarEvent(access.accessToken, input);
    },
    updateEvent: async (input: CalendarEventWrite): Promise<GoogleCalendarUpdateResult> => {
      const access = await readGoogleAccess(ctx);
      if (access.status !== "ok") return access;
      if (!access.scopes.includes(CALENDAR_EVENTS_SCOPE)) return { status: "not_connected" };
      return await patchCalendarEvent(access.accessToken, input);
    },
  };
}

/** Tokens descifrados de la cuenta Google de un usuario, solo en el servidor. */
export type GoogleAccountTokensForSubject =
  | {
      readonly status: "found";
      readonly scopes: readonly string[];
      readonly accessToken: string | null;
      readonly refreshToken: string | null;
    }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

/**
 * Lee los tokens de la cuenta Google de un usuario por su `subject` de Better
 * Auth, sin sesión (TI2-162).
 *
 * El `subject` sale de la fila `users` leída en el servidor
 * (`tokenIdentifier`), nunca del cliente. Los tokens viajan cifrados en reposo
 * y se descifran solo acá; nunca se devuelven al cliente.
 */
export async function readGoogleTokensForSubject(
  ctx: ActionCtx,
  subject: string,
): Promise<GoogleAccountTokensForSubject> {
  try {
    const account = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account",
      where: [
        { field: "userId", value: subject },
        { field: "providerId", value: "google" },
      ],
    })) as {
      readonly accessToken?: unknown;
      readonly refreshToken?: unknown;
      readonly scope?: unknown;
    } | null;
    if (account === null) return { status: "missing" };
    let context: DecryptContext;
    try {
      context = (await createAuth(ctx).$context) as unknown as DecryptContext;
    } catch {
      return { status: "unavailable" };
    }
    const accessToken = await decodeTokenValue(account.accessToken, context);
    const refreshToken = await decodeTokenValue(account.refreshToken, context);
    if (accessToken === "unreadable" || refreshToken === "unreadable") {
      return { status: "unavailable" };
    }
    const scope = account.scope;
    const scopes =
      typeof scope === "string" && scope.length > 0
        ? scope
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part !== "")
        : [];
    return {
      status: "found",
      scopes,
      accessToken,
      refreshToken,
    };
  } catch {
    return { status: "unavailable" };
  }
}

/** Resuelve un `accessToken` vigente para el calendario en segundo plano. */
export async function resolveBackgroundCalendarAccess(
  ctx: ActionCtx,
  subject: string,
  client: CalendarOAuthClientConfig | null,
  everLinked: boolean,
): Promise<
  | { readonly status: "ok"; readonly accessToken: string }
  | { readonly status: "not_connected" }
  | { readonly status: "never_linked" }
  | { readonly status: "unavailable" }
> {
  const stored = await readGoogleTokensForSubject(ctx, subject);
  if (stored.status === "missing") {
    // Sin cuenta y sin vínculo previo no hay nada que pedir: la persona nunca
    // vinculó. Con vínculo previo que ya no está, pide volver a vincular.
    return everLinked ? { status: "not_connected" } : { status: "never_linked" };
  }
  if (stored.status !== "found") return { status: "unavailable" };
  if (!stored.scopes.includes(CALENDAR_EVENTS_SCOPE)) return { status: "not_connected" };
  if (stored.refreshToken !== null) {
    const refreshed = await fetchAccessTokenWithRefresh(stored.refreshToken, client);
    if (refreshed.status === "ok") return refreshed;
    return refreshed;
  }
  if (stored.accessToken !== null) {
    return { status: "ok", accessToken: stored.accessToken };
  }
  return { status: "not_connected" };
}

/**
 * Acceso OAuth de Calendar para la revocación (TI2-161).
 *
 * Todo ocurre en el servidor y nada sale al cliente: lee la fila de la cuenta
 * `google` de la sesión, descifra los tokens con Better Auth (en reposo viajan
 * cifrados), revoca el permiso en Google y recién después elimina la fila.
 * Solo toca la cuenta de la sesión y únicamente el proveedor `google`: el
 * inicio institucional (`google-alu`/`google-uct`) y la sesión quedan
 * intactos, y `google` nunca sirve para iniciar sesión (el guard lo bloquea),
 * así que borrar su fila no puede dejar a nadie sin acceso.
 *
 * Si la revocación no se puede completar, responde `unavailable` y el
 * llamante no debe marcar nada local: afirmar desconexión con el permiso aún
 * vigente en Google dejaría crear eventos tras "desconectar".
 */
export function googleCalendarOAuthAccess(ctx: ActionCtx) {
  async function readTokens(): Promise<
    | {
        readonly status: "found";
        readonly tokens: {
          readonly accessToken: string | null;
          readonly refreshToken: string | null;
        };
      }
    | { readonly status: "missing" }
    | { readonly status: "unavailable" }
  > {
    try {
      const identity = await ctx.auth.getUserIdentity();
      if (identity === null) return { status: "missing" };
      const account = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "account",
        where: [
          { field: "userId", value: identity.subject },
          { field: "providerId", value: "google" },
        ],
      })) as {
        readonly accessToken?: unknown;
        readonly refreshToken?: unknown;
      } | null;
      if (account === null) return { status: "missing" };
      // Solo se necesita el contexto para descifrar: se pide directo a la app
      // en vez de `getAuth`, que resuelve la sesión por `_id` y exige una
      // sesión con cookie (ausente al invocar por CLI). El descifrado no
      // depende de ella.
      let context: DecryptContext;
      try {
        context = (await createAuth(ctx).$context) as unknown as DecryptContext;
      } catch {
        return { status: "unavailable" };
      }
      type DecodedToken =
        | { readonly status: "ok"; readonly value: string | null }
        | { readonly status: "unreadable" };
      const decode = async (value: unknown): Promise<DecodedToken> => {
        // Ausente no es lo mismo que ilegible: un campo vacío significa que no
        // hay nada que revocar; un cifrado que no abre significa que no se
        // puede confirmar la revocación.
        const decoded = await decodeTokenValue(value, context);
        return decoded === "unreadable"
          ? { status: "unreadable" as const }
          : { status: "ok" as const, value: decoded };
      };
      const accessToken = await decode(account.accessToken);
      const refreshToken = await decode(account.refreshToken);
      if (accessToken.status === "unreadable" || refreshToken.status === "unreadable") {
        return { status: "unavailable" };
      }
      return {
        status: "found",
        tokens: { accessToken: accessToken.value, refreshToken: refreshToken.value },
      };
    } catch {
      return { status: "unavailable" };
    }
  }
  return {
    readTokens,
    revokeToken: async (token: string): Promise<"revoked" | "already_invalid" | "unavailable"> => {
      let response: Response;
      const timeout = revokeTimeoutSignal();
      try {
        response = await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `token=${encodeURIComponent(token)}`,
          ...(timeout.signal === undefined ? {} : { signal: timeout.signal }),
        });
      } catch {
        return "unavailable";
      } finally {
        timeout.done();
      }
      if (response.ok) return "revoked";
      if (response.status === 400) {
        try {
          const body: unknown = await response.json();
          if (
            typeof body === "object" &&
            body !== null &&
            (body as { readonly error?: unknown }).error === "invalid_token"
          ) {
            return "already_invalid";
          }
        } catch {
          // Sin cuerpo legible no se puede confirmar la revocación.
        }
      }
      return "unavailable";
    },
    deleteAccount: async (): Promise<"deleted" | "not_found" | "unavailable"> => {
      const identity = await ctx.auth.getUserIdentity();
      if (identity === null) return "not_found";
      try {
        const deleted = await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
          input: {
            model: "account",
            where: [
              { field: "userId", value: identity.subject },
              { field: "providerId", value: "google" },
            ],
          },
        });
        return deleted === undefined || deleted === null ? "not_found" : "deleted";
      } catch {
        return "unavailable";
      }
    },
  };
}
/**
 * Lectura de alcances OAuth para el estado de conexión.
 *
 * Es la única fuente de «conectado»: la tabla `calendarConnections` solo
 * guarda metadatos locales y no participa de esta lectura. Consulta el
 * documento de cuenta del componente sin abrir sesión ni renovar tokens: un
 * query público no debe escribir. Devuelve solo el arreglo de alcances y la
 * referencia opaca de la cuenta; el identificador de cuenta y los tokens
 * quedan en el servidor y nunca se devuelven al cliente.
 */
export function googleCalendarConnectionReader(ctx: QueryCtx | MutationCtx) {
  async function readAccount(): Promise<{
    readonly scope?: string | null;
    readonly accountId?: unknown;
  } | null> {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return null;
    return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account",
      where: [
        { field: "userId", value: identity.subject },
        { field: "providerId", value: "google" },
      ],
    })) as { readonly scope?: string | null; readonly accountId?: unknown } | null;
  }
  return {
    listGoogleScopes: async (): Promise<readonly string[] | null> => {
      const account = await readAccount();
      if (account === null) return null;
      const scope = account.scope;
      return scope === undefined || scope === null || scope.length === 0 ? [] : scope.split(",");
    },
    getAccountReference: async (): Promise<string | null> => {
      const account = await readAccount();
      if (account === null) return null;
      const reference = account.accountId;
      return typeof reference === "string" && reference.length > 0 ? reference : null;
    },
  };
}
