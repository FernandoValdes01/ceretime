import { v } from "convex/values";
import {
  listBookableProfessionals as listBookableProfessionalsUseCase,
  listOwnAvailability as listOwnAvailabilityUseCase,
  publishAvailabilityBlock,
  publishAvailabilityException,
  removeAvailabilityException,
  searchAvailabilitySlots,
  setAvailabilityBlockActive,
  updateAvailabilityBlock,
} from "../application/availability/availability";
import { mutation, query } from "../_generated/server";
import {
  AGENDA_TIME_ZONE,
  AVAILABILITY_CONTRACT_VERSION,
} from "../domain/availability/availability";
import {
  accompanimentNeedsAtDateReader,
  accompanimentNeedsReader,
  bookableProfessionalSource,
} from "../infrastructure/accompaniments/repository";
import {
  futureAppointmentsReader,
  slotOccupancyReader,
} from "../infrastructure/appointments/repository";
import { availabilityReader, availabilityWriter } from "../infrastructure/availability/repository";
import { notificationEventRecorder } from "../infrastructure/notifications/repository";
import { compatibilitySpaceSource } from "../infrastructure/spaces/repository";
import {
  availabilityExceptionKindUnion,
  modalityUnion,
  noCompatibleSlotReasonUnion,
  officialChannelValidator,
  spaceFieldsShape,
} from "../infrastructure/validators";
import { unwrapApiResult as unwrap } from "./session";
import { privacyAwareAuthorizationReader } from "./privacyAuthorization";

/**
 * Borde de Presentación: bloques y excepciones de disponibilidad (TI2-111).
 *
 * Adaptador delgado bajo `api.presentation.availability`: valida la forma
 * del contrato v1 de TI2-87, resuelve la identidad en el servidor con
 * `ctx.auth.getUserIdentity()` y delega en los casos de uso de TI2-97,
 * compuestos con los adaptadores de TI2-86 y TI2-95. No toca `ctx.db` ni
 * decide reglas: el dueño de cada bloque o excepción sale del actor
 * autorizado o de la fila guardada, nunca del cliente.
 *
 * Los identificadores viajan como texto plano, igual que en el contrato:
 * uno ajeno, inexistente o de otra tabla recibe la misma denegación. Los
 * errores se lanzan con `throwPublicApiError` (TI2-88): solo `code` y
 * `message`. La búsqueda sin cupo compatible y libre no es un error: responde
 * el resultado `no_compatible_slot` (TI2-144). Opera con datos ficticios.
 */

const windowFields = {
  startMinute: v.number(),
  endMinute: v.number(),
  slotMinutes: v.number(),
  modality: modalityUnion,
  spaceId: v.optional(v.string()),
};

const blockFields = { ...windowFields, weekday: v.number() };

const version = v.literal(AVAILABILITY_CONTRACT_VERSION);

/** Publica un bloque semanal propio. Solo un Profesional con cuenta vigente. */
export const publishBlock = mutation({
  args: { ...blockFields, version },
  returns: v.object({ blockId: v.string() }),
  handler: async (ctx, { version: _version, ...block }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrap(
      await publishAvailabilityBlock(
        privacyAwareAuthorizationReader(ctx),
        availabilityWriter(ctx),
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          block,
        },
      ),
    );
  },
});

/** Reemplaza la ventana de un bloque propio sin cambiar a su dueño. */
export const updateBlock = mutation({
  args: { blockId: v.string(), ...blockFields, version },
  returns: v.null(),
  handler: async (ctx, { blockId, version: _version, ...block }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrap(
      await updateAvailabilityBlock(
        privacyAwareAuthorizationReader(ctx),
        { ...availabilityReader(ctx), ...availabilityWriter(ctx) },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, blockId, block },
        {
          future: futureAppointmentsReader(ctx),
          needs: accompanimentNeedsAtDateReader(ctx),
          compatibility: compatibilitySpaceSource(ctx),
          notifications: notificationEventRecorder(ctx),
        },
      ),
    );
  },
});

/** Retira o reactiva un bloque propio sin borrarlo. */
export const setBlockActive = mutation({
  args: { blockId: v.string(), isActive: v.boolean(), version },
  returns: v.null(),
  handler: async (ctx, { blockId, isActive }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrap(
      await setAvailabilityBlockActive(
        privacyAwareAuthorizationReader(ctx),
        { ...availabilityReader(ctx), ...availabilityWriter(ctx) },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, blockId, isActive },
        {
          future: futureAppointmentsReader(ctx),
          needs: accompanimentNeedsAtDateReader(ctx),
          compatibility: compatibilitySpaceSource(ctx),
          notifications: notificationEventRecorder(ctx),
        },
      ),
    );
  },
});

/**
 * Publica una excepción propia: cancela el día o un bloque, o agrega una
 * ventana. No recibe motivo, porque el MER no lo guarda.
 */
export const publishException = mutation({
  args: {
    date: v.string(),
    kind: availabilityExceptionKindUnion,
    blockId: v.optional(v.string()),
    windows: v.optional(v.array(v.object(windowFields))),
    version,
  },
  returns: v.object({ exceptionId: v.string() }),
  handler: async (ctx, { version: _version, ...exception }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrap(
      await publishAvailabilityException(
        privacyAwareAuthorizationReader(ctx),
        { ...availabilityReader(ctx), ...availabilityWriter(ctx) },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          exception,
        },
        {
          future: futureAppointmentsReader(ctx),
          needs: accompanimentNeedsAtDateReader(ctx),
          compatibility: compatibilitySpaceSource(ctx),
          notifications: notificationEventRecorder(ctx),
        },
      ),
    );
  },
});

/** Retira una excepción propia. */
export const removeException = mutation({
  args: { exceptionId: v.string(), version },
  returns: v.null(),
  handler: async (ctx, { exceptionId }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrap(
      await removeAvailabilityException(
        privacyAwareAuthorizationReader(ctx),
        { ...availabilityReader(ctx), ...availabilityWriter(ctx) },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, exceptionId },
        {
          future: futureAppointmentsReader(ctx),
          needs: accompanimentNeedsAtDateReader(ctx),
          compatibility: compatibilitySpaceSource(ctx),
          notifications: notificationEventRecorder(ctx),
        },
      ),
    );
  },
});

const slotValidator = v.object({
  id: v.string(),
  professionalId: v.string(),
  date: v.string(),
  startAt: v.number(),
  endAt: v.number(),
  modality: modalityUnion,
  spaceId: v.optional(v.string()),
  space: v.optional(v.object(spaceFieldsShape)),
  version,
});

const searchResultValidator = v.union(
  v.object({
    status: v.literal("available"),
    items: v.array(slotValidator),
    hasMore: v.boolean(),
    nextCursor: v.union(v.string(), v.null()),
    version,
  }),
  v.object({
    status: v.literal("no_compatible_slot"),
    coordination: v.object({
      reason: noCompatibleSlotReasonUnion,
      explanation: v.string(),
      referenceCode: v.string(),
      channels: v.array(officialChannelValidator),
    }),
    version,
  }),
);

/**
 * Cupos compatibles y libres de un profesional para un acompañamiento
 * activo, paginados (TI2-97). Solo el Estudiante dueño o el Profesional
 * asignado pueden buscar; el rango y la página están acotados. Las fechas se
 * leen en la zona de la agenda (`AGENDA_TIME_ZONE`), que fija el servidor: el
 * cliente no la envía.
 *
 * Sin horario compatible responde `status: "no_compatible_slot"` con el
 * motivo, el código de referencia y los canales oficiales (TI2-144); con
 * cupos, `status: "available"` y la página, donde cada cupo presencial trae
 * la ubicación y el acceso de su sala.
 */
export const searchSlots = query({
  args: {
    accompanimentId: v.string(),
    professionalId: v.string(),
    from: v.string(),
    to: v.string(),
    limit: v.number(),
    cursor: v.optional(v.string()),
    version,
  },
  returns: searchResultValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = unwrap(
      await searchAvailabilitySlots(
        {
          auth: privacyAwareAuthorizationReader(ctx),
          availability: availabilityReader(ctx),
          needs: accompanimentNeedsReader(ctx),
          compatibility: compatibilitySpaceSource(ctx),
          occupancy: slotOccupancyReader(ctx),
        },
        { ...args, timeZone: AGENDA_TIME_ZONE, tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
    // Las listas del dominio son de solo lectura; el validador espera arreglos.
    if (result.status === "available") return { ...result, items: [...result.items] };
    const { coordination } = result;
    return {
      ...result,
      coordination: { ...coordination, channels: [...coordination.channels] },
    };
  },
});

/**
 * Profesionales reservables de un acompañamiento activo (TI2-123). Solo el
 * Estudiante dueño o el Profesional asignado; es la entrada de `searchSlots`
 * cuando todavía no hay atenciones. Solo entrega identificadores.
 */
export const listBookableProfessionals = query({
  args: { accompanimentId: v.string(), version },
  returns: v.object({ professionalIds: v.array(v.string()), version }),
  handler: async (ctx, { accompanimentId }) => {
    const identity = await ctx.auth.getUserIdentity();
    const result = unwrap(
      await listBookableProfessionalsUseCase(
        {
          auth: privacyAwareAuthorizationReader(ctx),
          professionals: bookableProfessionalSource(ctx),
        },
        { accompanimentId, tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
    return { ...result, professionalIds: [...result.professionalIds] };
  },
});

const ownBlockValidator = v.object({
  id: v.string(),
  professionalId: v.string(),
  weekday: v.number(),
  ...windowFields,
  version,
});

const ownExceptionValidator = v.object({
  id: v.string(),
  professionalId: v.string(),
  date: v.string(),
  kind: availabilityExceptionKindUnion,
  blockId: v.optional(v.string()),
  windows: v.optional(v.array(v.object(windowFields))),
  version,
});

/**
 * Bloques vigentes y excepciones propias en un rango civil inclusivo de
 * hasta 92 días, para que el editor los muestre y edite. Solo un Profesional
 * vigente, y siempre los suyos: no hay argumento para pedir los de otro.
 */
export const listOwnAvailability = query({
  args: { from: v.string(), to: v.string(), version },
  returns: v.object({
    blocks: v.array(ownBlockValidator),
    exceptions: v.array(ownExceptionValidator),
    version,
  }),
  handler: async (ctx, { from, to }) => {
    const identity = await ctx.auth.getUserIdentity();
    const own = unwrap(
      await listOwnAvailabilityUseCase(
        privacyAwareAuthorizationReader(ctx),
        availabilityReader(ctx),
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          from,
          to,
        },
      ),
    );
    // Las listas del dominio son de solo lectura; el validador espera arreglos.
    return {
      blocks: [...own.blocks],
      exceptions: own.exceptions.map(({ windows, ...exception }) =>
        windows === undefined ? exception : { ...exception, windows: [...windows] },
      ),
      version: AVAILABILITY_CONTRACT_VERSION,
    };
  },
});
