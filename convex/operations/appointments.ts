import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { calculateJustificationDeadline } from "../domain/appointments/appointment";
import { AGENDA_TIME_ZONE } from "../domain/availability/availability";
import { CHILE_HOLIDAYS } from "../domain/calendar/chile_holidays";

/**
 * Expira las justificaciones de inasistencia cuyo plazo de cinco días hábiles
 * ya venció (TI2-147).
 *
 * Función interna: no forma parte de la API que consumen Web o Mobile. La
 * ejecuta `crons.ts` periódicamente. Para cada atención en estado `no_show`
 * sin justificación entregada, calcula el plazo con feriados de Chile y la
 * zona de Temuco; si el instante actual ya pasó el vencimiento, la pasa
 * a `no_show_unjustified` con el mismo patrón que la revisión manual por
 * vencimiento (TI2-119), sin inventar una revisión ni una sanción.
 *
 * Idempotente: una atención ya `no_show_unjustified` no aparece en la
 * consulta por `status = "no_show"`, así que una segunda ejecución no la
 * toca. Las atenciones justificadas o ya resueltas quedan fuera del barrido.
 */
export const expireOverdueJustifications = internalMutation({
  args: {},
  returns: v.object({ expired: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("appointments")
      .withIndex("by_status_and_startsAt", (q) => q.eq("status", "no_show"))
      .collect();

    let count = 0;
    for (const appointment of expired) {
      if (appointment.justificationSubmittedAt !== undefined) continue;
      const deadline = calculateJustificationDeadline({
        missedAt: appointment.startsAt,
        timeZone: AGENDA_TIME_ZONE,
        holidays: CHILE_HOLIDAYS,
      });
      if (now < deadline.deadlineAt) continue;
      await ctx.db.patch(appointment._id, {
        status: "no_show_unjustified",
      });
      count += 1;
    }
    return { expired: count };
  },
});
