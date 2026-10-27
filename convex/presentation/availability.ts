import { v } from "convex/values";
import {
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
  accompanimentNeedsReader,
  authorizationReader,
} from "../infrastructure/accompaniments/repository";
import { slotOccupancyReader } from "../infrastructure/appointments/repository";
import { availabilityReader, availabilityWriter } from "../infrastructure/availability/repository";
import { compatibilitySpaceSource } from "../infrastructure/spaces/repository";
import { availabilityExceptionKindUnion, modalityUnion } from "../infrastructure/validators";
import { unwrapApiResult as unwrap } from "./session";

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
 * `message`. La búsqueda sin cupo compatible y libre responde
 * `no_availability`. Opera con datos ficticios.
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
      await publishAvailabilityBlock(authorizationReader(ctx), availabilityWriter(ctx), {
        tokenIdentifier: identity?.tokenIdentifier ?? null,
        block,
      }),
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
        authorizationReader(ctx),
        { ...availabilityReader(ctx), ...availabilityWriter(ctx) },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, blockId, block },
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
        authorizationReader(ctx),
        { ...availabilityReader(ctx), ...availabilityWriter(ctx) },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, blockId, isActive },
      ),
    );
  },
});

/**
 * Publica una excepción propia: cancela el día o un bloque, o agrega una
 * ventana. El motivo es opcional y solo lo guarda el repositorio.
 */
export const publishException = mutation({
  args: {
    date: v.string(),
    kind: availabilityExceptionKindUnion,
    blockId: v.optional(v.string()),
    windows: v.optional(v.array(v.object(windowFields))),
    reason: v.optional(v.string()),
    version,
  },
  returns: v.object({ exceptionId: v.string() }),
  handler: async (ctx, { version: _version, ...exception }) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrap(
      await publishAvailabilityException(authorizationReader(ctx), availabilityWriter(ctx), {
        tokenIdentifier: identity?.tokenIdentifier ?? null,
        exception,
      }),
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
        authorizationReader(ctx),
        { ...availabilityReader(ctx), ...availabilityWriter(ctx) },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, exceptionId },
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
  version,
});

/**
 * Cupos compatibles y libres de un profesional para un acompañamiento
 * activo, paginados (TI2-97). Solo el Estudiante dueño o el Profesional
 * asignado pueden buscar; el rango y la página están acotados. Las fechas se
 * leen en la zona de la agenda (`AGENDA_TIME_ZONE`), que fija el servidor: el
 * cliente no la envía.
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
  returns: v.object({
    items: v.array(slotValidator),
    hasMore: v.boolean(),
    nextCursor: v.union(v.string(), v.null()),
    version,
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const page = unwrap(
      await searchAvailabilitySlots(
        {
          auth: authorizationReader(ctx),
          availability: availabilityReader(ctx),
          needs: accompanimentNeedsReader(ctx),
          compatibility: compatibilitySpaceSource(ctx),
          occupancy: slotOccupancyReader(ctx),
        },
        { ...args, timeZone: AGENDA_TIME_ZONE, tokenIdentifier: identity?.tokenIdentifier ?? null },
      ),
    );
    // La página del dominio es de solo lectura; el validador espera un arreglo.
    return { ...page, items: [...page.items] };
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
  reason: v.optional(v.string()),
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
      await listOwnAvailabilityUseCase(authorizationReader(ctx), availabilityReader(ctx), {
        tokenIdentifier: identity?.tokenIdentifier ?? null,
        from,
        to,
      }),
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
