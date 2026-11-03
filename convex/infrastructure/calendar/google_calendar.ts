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

import type { ActionCtx, QueryCtx } from "../../_generated/server";
import { components } from "../../_generated/api";
import { authComponent, createAuth } from "../../auth";
import { CALENDAR_EVENTS_SCOPE } from "../../domain/calendar/calendar_event";

/** Resultado del adaptador, estructuralmente igual al puerto de Aplicación. */
export type GoogleCalendarCreateResult =
  | { readonly status: "created"; readonly eventId: string }
  | { readonly status: "already_exists"; readonly eventId: string }
  | { readonly status: "not_connected" }
  | { readonly status: "unavailable" };

type GoogleAccess =
  | { readonly status: "ok"; readonly accessToken: string; readonly scopes: readonly string[] }
  | { readonly status: "not_connected" };

/**
 * Token vigente de la cuenta Google de la sesión. Better Auth lo renueva si
 * está por expirar; un token revocado, ausente o sin refresh token se traduce
 * a `not_connected` para que la interfaz ofrezca volver a conectar. Nunca se expone
 * el error del proveedor.
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
 * Puerto de creación de eventos. El `id` determinista del evento hace que un
 * reintento o un doble clic reciba `409` y se trate como éxito, sin duplicar.
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
  };
}

/**
 * Lectura de alcances OAuth para el estado de conexión.
 *
 * Consulta el documento de cuenta del componente sin abrir sesión ni renovar
 * tokens: un query público no debe escribir. Devuelve solo el arreglo de
 * alcances; el identificador de cuenta y los tokens quedan en el servidor.
 */
export function googleCalendarConnectionReader(ctx: QueryCtx) {
  return {
    listGoogleScopes: async (): Promise<readonly string[] | null> => {
      const identity = await ctx.auth.getUserIdentity();
      if (identity === null) return null;
      const account = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "account",
        where: [
          { field: "userId", value: identity.subject },
          { field: "providerId", value: "google" },
        ],
      })) as { readonly scope?: string | null } | null;
      if (account === null) return null;
      const scope = account.scope;
      return scope === undefined || scope === null || scope.length === 0 ? [] : scope.split(",");
    },
  };
}
