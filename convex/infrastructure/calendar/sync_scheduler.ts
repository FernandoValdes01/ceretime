import { internal } from "../../_generated/api";
import type { MutationCtx } from "../../_generated/server";
import type { CalendarLinkSyncScheduler } from "../../application/calendar/calendar_link";
import type { CalendarSyncScheduler } from "../../application/calendar/sync";
import { markCalendarSyncPending } from "./repository";

/**
 * Programa la sincronización automática tras confirmar el cambio (TI2-162).
 *
 * Capa de Infraestructura: cumple el puerto de Aplicación sin importar
 * decisiones. Marca `pending` sin contar un intento y programa el despacho en
 * otra función, así un fallo de Google no deshace la reserva ni el cambio. Si
 * el cambio se rechaza, Convex descarta también lo programado. Nunca lanza por
 * una referencia inválida: la reserva recién creada siempre existe.
 */
export function calendarSyncScheduler(ctx: MutationCtx): CalendarSyncScheduler {
  return {
    scheduleSync: async (appointmentId: string): Promise<void> => {
      const normalized = ctx.db.normalizeId("appointments", appointmentId);
      if (normalized === null) return;
      await markCalendarSyncPending(ctx, normalized, Date.now());
      await ctx.scheduler.runAfter(0, internal.operations.calendar.syncAppointmentCalendar, {
        appointmentId,
      });
    },
  };
}

/**
 * Programa el recorrido por páginas de las atenciones futuras vigentes al
 * confirmar el vínculo (TI2-162).
 *
 * La confirmación solo agenda el primer tramo para seguir liviana; la
 * operación interna pagina por estudiante, responsable y adicional hasta
 * agotar sin truncar.
 */
export function calendarLinkSyncScheduler(ctx: MutationCtx): CalendarLinkSyncScheduler {
  return {
    scheduleFutureSync: async (userId: string, now: number): Promise<void> => {
      if (ctx.db.normalizeId("users", userId) === null || !Number.isFinite(now)) return;
      await ctx.scheduler.runAfter(0, internal.operations.calendar.scheduleLinkedUserSyncs, {
        userId,
        now,
        phase: "student",
        cursor: null,
      });
    },
  };
}
