import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { expireOverdueJustifications as expireOverdueJustificationsUseCase } from "../application/appointments/changes";
import {
  appointmentTransitionRepository,
  pendingJustificationsReader,
} from "../infrastructure/appointments/repository";
import { notificationEventRecorder } from "../infrastructure/notifications/repository";

/**
 * Despacho del cierre automático de justificaciones vencidas (TI2-147).
 *
 * Función interna: no forma parte de la API que consumen Web o Mobile. La
 * ejecuta `crons.ts` periódicamente y continúa por lotes con el cursor del
 * índice mientras queden filas por revisar; termina cuando `isDone` es
 * verdadero. La decisión vive en Aplicación (`changes.ts`): acá solo se arman
 * los adaptadores de Convex.
 */

/** Tope de inasistencias por ejecución, acotado por los límites de la mutation. */
const JUSTIFICATION_SWEEP_LIMIT = 50;

export const expireOverdueJustifications = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    expired: v.number(),
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? JUSTIFICATION_SWEEP_LIMIT;
    const result = await expireOverdueJustificationsUseCase(
      {
        appointments: pendingJustificationsReader(ctx),
        persister: appointmentTransitionRepository(ctx).persister,
        notifications: notificationEventRecorder(ctx),
      },
      { cursor: args.cursor, limit },
    );
    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.operations.appointments.expireOverdueJustifications,
        { cursor: result.cursor, limit },
      );
    }
    return { expired: result.expired, cursor: result.cursor, isDone: result.isDone };
  },
});
