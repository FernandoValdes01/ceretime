import { v } from "convex/values";
import {
  confirmCalendarLink as confirmCalendarLinkUseCase,
  getCalendarLinkStatus as getCalendarLinkStatusUseCase,
  revokeCalendarOAuthAccess as revokeCalendarOAuthAccessUseCase,
} from "../application/calendar/calendar_link";
import type { CalendarLinkDisconnectResult } from "../application/calendar/calendar_link";
import { unauthorizedError } from "../domain/errors/api_error";
import { action, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import { authorizationReader } from "../infrastructure/accompaniments/repository";
import {
  googleCalendarConnectionReader,
  googleCalendarOAuthAccess,
} from "../infrastructure/calendar/google_calendar";
import { calendarLinkReader, calendarLinkStore } from "../infrastructure/calendar/repository";
import { calendarSyncScheduler } from "../infrastructure/calendar/sync_scheduler";
import { linkerFutureAppointmentsReader } from "../infrastructure/appointments/repository";
import { throwPublicApiError, unwrapApiResult } from "./session";

/**
 * Borde de Presentación: vínculo propio con Google Calendar (TI2-161).
 *
 * Adaptadores delgados bajo `api.presentation.calendar`: validan la forma,
 * resuelven la identidad en el servidor y delegan en Aplicación. Nunca aceptan
 * un `userId` del cliente ni devuelven tokens, referencias de cuenta, correos
 * o alcances. La conexión se deriva solo de los alcances OAuth; los metadatos
 * locales aportan fechas y el aviso de eventos previos.
 *
 * Los errores usan el contrato común (`ConvexError({code, message})`):
 * `unauthorized` sin sesión, sin perfil, sin vigencia o sin rol de vínculo;
 * `conflict` ante un instante inválido o si la revocación externa no se puede
 * completar. Rechazar la autorización responde `connected: false`, nunca
 * bloquea la reserva. Desconectar revoca primero en Google y solo después
 * marca lo local; si Google no responde, no se marca nada.
 */

const calendarLinkStatusValidator = v.object({
  connected: v.boolean(),
  linkedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  staleEventsMayRemain: v.boolean(),
});

const calendarLinkConfirmValidator = v.union(
  v.object({
    connected: v.literal(true),
    linkedAt: v.number(),
    status: v.union(v.literal("linked"), v.literal("already_linked")),
  }),
  v.object({ connected: v.literal(false), status: v.literal("not_connected") }),
);

const calendarLinkDisconnectValidator = v.object({
  disconnected: v.boolean(),
  status: v.union(v.literal("unlinked"), v.literal("already_unlinked"), v.literal("not_found")),
  revokedAt: v.optional(v.number()),
  staleEventsMayRemain: v.boolean(),
});

/**
 * Estado del vínculo propio: alcance mínimo más fechas locales.
 *
 * Solo confirma `connected` con `calendar.events`. No devuelve credenciales.
 */
export const getCalendarLinkStatus = query({
  args: {},
  returns: calendarLinkStatusValidator,
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await getCalendarLinkStatusUseCase(
        {
          auth: authorizationReader(ctx),
          oauth: googleCalendarConnectionReader(ctx),
          store: calendarLinkReader(ctx),
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
  },
});

/**
 * Confirma el retorno OAuth y registra el vínculo propio.
 *
 * Solo Estudiante y Profesional (RF-27, `calendar:link`). Valida que el
 * alcance mínimo esté concedido; si se rechazó, responde `connected: false`
 * sin error. La referencia de cuenta se resuelve en el servidor.
 */
export const confirmCalendarLink = mutation({
  args: {},
  returns: calendarLinkConfirmValidator,
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await confirmCalendarLinkUseCase(
        {
          auth: authorizationReader(ctx),
          oauth: googleCalendarConnectionReader(ctx),
          store: calendarLinkStore(ctx),
          futureAppointments: linkerFutureAppointmentsReader(ctx),
          calendarSync: calendarSyncScheduler(ctx),
          now: () => Date.now(),
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
  },
});

/**
 * Desconecta el vínculo propio con aviso de eventos previos.
 *
 * Es una acción porque revocar exige red (`fetch` a Google) y la acción no
 * tiene base de datos: primero verifica el rol (Estudiante o Profesional),
 * revoca el permiso en Google y borra la cuenta OAuth, y solo después marca
 * la trazabilidad local con la mutación interna. Si Google no responde,
 * responde `conflict` sin marcar nada. No borra eventos ya creados: la
 * respuesta indica que pueden quedar sin actualizar.
 */
export const disconnectCalendarLink = action({
  args: {},
  returns: calendarLinkDisconnectValidator,
  handler: async (ctx): Promise<CalendarLinkDisconnectResult> => {
    const identity = await ctx.auth.getUserIdentity();
    const tokenIdentifier = identity?.tokenIdentifier ?? null;
    if (tokenIdentifier === null) throwPublicApiError(unauthorizedError());
    const allowed = await ctx.runQuery(internal.operations.calendar.checkCalendarLinkAccess, {
      tokenIdentifier,
    });
    if (!allowed) throwPublicApiError(unauthorizedError());
    const revocation = await revokeCalendarOAuthAccessUseCase({
      access: googleCalendarOAuthAccess(ctx),
    });
    if (revocation.status === "error") throwPublicApiError(revocation.error);
    const marked = await ctx.runMutation(internal.operations.calendar.markCalendarDisconnected, {
      tokenIdentifier,
      revoked: revocation.data.status,
    });
    return unwrapApiResult(marked);
  },
});
