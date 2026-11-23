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

/** Contexto de descifrado que espera Better Auth (mismo objeto de `$context`). */
type DecryptContext = Parameters<typeof decryptOAuthToken>[1];

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
 * Puerto de creación y actualización de eventos. El `id` determinista del
 * evento hace que un reintento o un doble clic reciba `409` y se trate como
 * éxito, sin duplicar. La actualización usa el mismo `id` ya guardado.
 */
export function googleCalendarGateway(ctx: ActionCtx) {
  return {
    createEvent: async (input: {
      readonly googleEventId: string;
      readonly title: string;
      readonly startAt: number;
      readonly endAt: number;
      readonly timeZone: string;
    }): Promise<GoogleCalendarCreateResult> => {
      const access = await readGoogleAccess(ctx);
      if (access.status !== "ok") return access;
      if (!access.scopes.includes(CALENDAR_EVENTS_SCOPE)) return { status: "not_connected" };

      try {
        const response = await fetch(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${access.accessToken}`,
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
    },
    updateEvent: async (input: {
      readonly googleEventId: string;
      readonly title: string;
      readonly startAt: number;
      readonly endAt: number;
      readonly timeZone: string;
    }): Promise<GoogleCalendarUpdateResult> => {
      const access = await readGoogleAccess(ctx);
      if (access.status !== "ok") return access;
      if (!access.scopes.includes(CALENDAR_EVENTS_SCOPE)) return { status: "not_connected" };

      try {
        const response = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.googleEventId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${access.accessToken}`,
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
    },
  };
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
      const { auth } = await authComponent.getAuth(createAuth, ctx);
      // `$context` ya es el AuthContext real en ejecución; la conversión solo
      // salva la varianza de los genéricos del adaptador en los tipos de
      // Better Auth, no cambia el objeto que recibe el descifrado.
      const context = (await auth.$context) as unknown as DecryptContext;
      type DecodedToken =
        | { readonly status: "ok"; readonly value: string | null }
        | { readonly status: "unreadable" };
      const decode = async (value: unknown): Promise<DecodedToken> => {
        // Ausente no es lo mismo que ilegible: un campo vacío significa que no
        // hay nada que revocar; un cifrado que no abre significa que no se
        // puede confirmar la revocación.
        if (typeof value !== "string" || value.length === 0) {
          return { status: "ok", value: null };
        }
        try {
          const plain = await decryptOAuthToken(value, context);
          return {
            status: "ok",
            value: typeof plain === "string" && plain.length > 0 ? plain : null,
          };
        } catch {
          return { status: "unreadable" };
        }
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
      try {
        response = await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `token=${encodeURIComponent(token)}`,
          // Sin tope, una Google colgada deja la acción esperando hasta el
          // límite de Convex con el botón solo en "ocupado".
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        return "unavailable";
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
