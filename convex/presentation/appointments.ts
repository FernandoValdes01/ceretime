import { v } from "convex/values";
import { bookAppointment as bookAppointmentUseCase } from "../application/appointments/booking";
import { mutation } from "../_generated/server";
import { APPOINTMENT_CONTRACT_VERSION } from "../domain/appointments/appointment";
import {
  accompanimentNeedsReader,
  authorizationReader,
} from "../infrastructure/accompaniments/repository";
import { appointmentOccupier } from "../infrastructure/appointments/repository";
import { availabilityReader } from "../infrastructure/availability/repository";
import { compatibilitySpaceSource } from "../infrastructure/spaces/repository";
import { modalityUnion } from "../infrastructure/validators";
import { unwrapApiResult } from "./session";

/**
 * Borde de Presentación: reserva de una atención (TI2-111).
 *
 * Adaptador delgado bajo `api.presentation.appointments`: valida la forma
 * del contrato v1 de TI2-87, resuelve la identidad en el servidor y delega en
 * el caso de uso de TI2-98, compuesto con los adaptadores de TI2-86, TI2-95 y
 * TI2-96. No toca `ctx.db` ni decide reglas: el estudiante de la atención es
 * el de la sesión, y el horario, la modalidad y la sala se vuelven a derivar
 * de la disponibilidad vigente dentro de la misma transacción.
 *
 * Los errores se lanzan con `throwPublicApiError` (TI2-88): `unauthorized`
 * sin permiso sobre el acompañamiento, `no_availability` cuando el cupo ya no
 * existe o no es compatible, y `conflict` ante una entrada inválida o un
 * cruce. TI2-112 extiende este archivo con la agenda y el detalle. Opera con
 * datos ficticios.
 */

/** Reserva el cupo elegido para un acompañamiento activo del Estudiante. */
export const bookAppointment = mutation({
  args: {
    accompanimentId: v.string(),
    professionalId: v.string(),
    modality: modalityUnion,
    spaceId: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    timeZone: v.string(),
    version: v.literal(APPOINTMENT_CONTRACT_VERSION),
  },
  returns: v.object({ appointmentId: v.string() }),
  handler: async (ctx, { version: _version, ...slot }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await bookAppointmentUseCase(
        {
          auth: authorizationReader(ctx),
          availability: availabilityReader(ctx),
          needs: accompanimentNeedsReader(ctx),
          compatibility: compatibilitySpaceSource(ctx),
          occupier: appointmentOccupier(ctx),
        },
        { ...slot, tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
  },
});
