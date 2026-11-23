import { v } from "convex/values";
import {
  confirmCalendarLink as confirmCalendarLinkUseCase,
  disconnectCalendarLink as disconnectCalendarLinkUseCase,
  getCalendarLinkStatus as getCalendarLinkStatusUseCase,
} from "../application/calendar/calendar_link";
import { mutation, query } from "../_generated/server";
import { authorizationReader } from "../infrastructure/accompaniments/repository";
import { googleCalendarConnectionReader } from "../infrastructure/calendar/google_calendar";
import { calendarLinkReader, calendarLinkStore } from "../infrastructure/calendar/repository";
import { unwrapApiResult } from "./session";

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
 * `unauthorized` sin sesión, sin perfil o sin vigencia; `conflict` ante un
 * instante inválido. Rechazar la autorización responde `connected: false`,
 * nunca bloquea la reserva. Desconectar avisa que los eventos anteriores
 * pueden quedar sin actualizar.
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
 * Valida que el alcance mínimo esté concedido; si se rechazó, responde
 * `connected: false` sin error. La referencia de cuenta se resuelve en el
 * servidor.
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
 * Solo toca la fila de la sesión. No borra eventos ya creados: la respuesta
 * indica que pueden quedar sin actualizar.
 */
export const disconnectCalendarLink = mutation({
  args: {},
  returns: calendarLinkDisconnectValidator,
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await disconnectCalendarLinkUseCase(
        {
          auth: authorizationReader(ctx),
          store: calendarLinkStore(ctx),
          now: () => Date.now(),
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
  },
});
