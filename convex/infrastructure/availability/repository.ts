import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  AVAILABILITY_CONTRACT_VERSION,
  MAX_EXPANSION_DAYS,
  WEEKDAY_MAX,
  WEEKDAY_MIN,
  isValidCivilDate,
  type AvailabilityBlock,
  type AvailabilityException,
} from "../../domain/availability/availability";
import { conflictError, errResult, okResult, type ApiResult } from "../../domain/errors/api_error";

/**
 * Repositorio de disponibilidad (TI2-95).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` para bloques
 * recurrentes y excepciones. Adapta las filas de TI2-83 a los contratos de
 * TI2-81/TI2-87 y cumple por forma el puerto `AvailabilityReader` de
 * Aplicación sin importarlo. No decide autorización (TI2-86, en Aplicación)
 * ni expande cupos (TI2-81).
 *
 * Opera con datos ficticios.
 */

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

type BlockRecord = AvailabilityBlock & { readonly isActive: boolean };

type ExceptionRecord = AvailabilityException & {
  readonly id: string;
  readonly professionalId: string;
  readonly reason?: string;
};

/**
 * Tope de bloques vigentes por profesional. Superarlo falla en vez de
 * truncar: una lista cortada publicaría menos disponibilidad sin aviso.
 */
export const MAX_ACTIVE_BLOCKS = 100;

/**
 * Tope de excepciones en un rango de hasta `MAX_EXPANSION_DAYS` días.
 * Truncar aquí sería peor que con bloques: perder una cancelación ofrecería
 * cupos que el profesional ya retiró.
 */
export const MAX_EXCEPTIONS_IN_RANGE = 300;

const DAY_MS = 86_400_000;

/**
 * El esquema guarda `date` como las 00:00 UTC del día. La fecha es una
 * etiqueta civil y no un instante, así que se convierte en UTC y no depende
 * de la zona horaria del profesional.
 */
function civilDateToEpochMs(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}

function epochMsToCivilDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function toBlock(doc: Doc<"availabilityBlocks">): BlockRecord {
  return {
    id: doc._id,
    professionalId: doc.professionalId,
    weekday: doc.weekday,
    startMinute: doc.startMinute,
    endMinute: doc.endMinute,
    slotMinutes: doc.slotMinutes,
    modality: doc.modality,
    ...(doc.spaceId === undefined ? {} : { spaceId: doc.spaceId }),
    isActive: doc.isActive,
    version: AVAILABILITY_CONTRACT_VERSION,
  };
}

/**
 * Una fila guarda una sola ventana; el contrato la entrega en `windows`. La
 * cancelación nunca lleva ventanas. Las lecturas entregan la fila tal como
 * está guardada: la integridad la exigen las escrituras de este repositorio
 * y la expansión de TI2-81 rechaza lo que llegue incompleto, sin repetir aquí
 * sus reglas.
 */
function toException(doc: Doc<"availabilityExceptions">): ExceptionRecord {
  const base = {
    id: doc._id,
    professionalId: doc.professionalId,
    date: epochMsToCivilDate(doc.date),
    kind: doc.kind,
    ...(doc.reason === undefined ? {} : { reason: doc.reason }),
    version: AVAILABILITY_CONTRACT_VERSION,
  };
  if (doc.kind === "cancelled") {
    return { ...base, ...(doc.blockId === undefined ? {} : { blockId: doc.blockId }) };
  }
  if (
    doc.startMinute === undefined ||
    doc.endMinute === undefined ||
    doc.slotMinutes === undefined ||
    doc.modality === undefined
  ) {
    return base;
  }
  return {
    ...base,
    windows: [
      {
        startMinute: doc.startMinute,
        endMinute: doc.endMinute,
        slotMinutes: doc.slotMinutes,
        modality: doc.modality,
        ...(doc.spaceId === undefined ? {} : { spaceId: doc.spaceId }),
      },
    ],
  };
}

/**
 * Bloques vigentes del profesional, un día de semana a la vez sobre
 * `by_professionalId_and_weekday_and_isActive`: los retirados no se leen ni
 * consumen el tope.
 */
export async function listActiveBlocks(
  ctx: DbReader,
  professionalId: Id<"users">,
): Promise<ApiResult<readonly BlockRecord[]>> {
  const rows: Doc<"availabilityBlocks">[] = [];
  for (let weekday = WEEKDAY_MIN; weekday <= WEEKDAY_MAX; weekday += 1) {
    const page = await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_professionalId_and_weekday_and_isActive", (q) =>
        q.eq("professionalId", professionalId).eq("weekday", weekday).eq("isActive", true),
      )
      .take(MAX_ACTIVE_BLOCKS - rows.length + 1);
    rows.push(...page);
    if (rows.length > MAX_ACTIVE_BLOCKS) {
      return errResult(conflictError());
    }
  }
  return okResult(rows.map(toBlock));
}

/**
 * Rango civil inclusivo en milisegundos, con las reglas de la expansión de
 * TI2-81: fechas válidas, no invertido y hasta `MAX_EXPANSION_DAYS` días.
 */
function civilRangeBounds(from: string, to: string): { fromMs: number; toMs: number } | null {
  if (!isValidCivilDate(from) || !isValidCivilDate(to) || from > to) {
    return null;
  }
  const fromMs = civilDateToEpochMs(from);
  const toMs = civilDateToEpochMs(to);
  return Math.round((toMs - fromMs) / DAY_MS) + 1 > MAX_EXPANSION_DAYS ? null : { fromMs, toMs };
}

/** Excepciones del profesional en el rango, sobre `by_professionalId_and_date`. */
export async function listExceptions(
  ctx: DbReader,
  range: { readonly professionalId: Id<"users">; readonly from: string; readonly to: string },
): Promise<ApiResult<readonly ExceptionRecord[]>> {
  const bounds = civilRangeBounds(range.from, range.to);
  if (bounds === null) {
    return errResult(conflictError());
  }
  const { fromMs, toMs } = bounds;
  const rows = await ctx.db
    .query("availabilityExceptions")
    .withIndex("by_professionalId_and_date", (q) =>
      q.eq("professionalId", range.professionalId).gte("date", fromMs).lte("date", toMs),
    )
    .take(MAX_EXCEPTIONS_IN_RANGE + 1);
  if (rows.length > MAX_EXCEPTIONS_IN_RANGE) {
    return errResult(conflictError());
  }
  return okResult(rows.map(toException));
}

/**
 * Lecturas de disponibilidad para Aplicación. Los identificadores llegan como
 * texto: uno que no pertenece a la tabla responde igual que uno inexistente.
 */
export function availabilityReader(ctx: DbReader) {
  return {
    getBlock: async (blockId: string) => {
      const id = ctx.db.normalizeId("availabilityBlocks", blockId);
      const doc = id === null ? null : await ctx.db.get(id);
      return doc === null ? null : toBlock(doc);
    },
    listActiveBlocks: async (
      professionalId: string,
    ): Promise<ApiResult<readonly BlockRecord[]>> => {
      const id = ctx.db.normalizeId("users", professionalId);
      return id === null ? okResult([]) : await listActiveBlocks(ctx, id);
    },
    getException: async (exceptionId: string) => {
      const id = ctx.db.normalizeId("availabilityExceptions", exceptionId);
      const doc = id === null ? null : await ctx.db.get(id);
      return doc === null ? null : toException(doc);
    },
    listExceptions: async (range: {
      readonly professionalId: string;
      readonly from: string;
      readonly to: string;
    }): Promise<ApiResult<readonly ExceptionRecord[]>> => {
      const id = ctx.db.normalizeId("users", range.professionalId);
      if (civilRangeBounds(range.from, range.to) === null) {
        return errResult(conflictError());
      }
      return id === null
        ? okResult([])
        : await listExceptions(ctx, { professionalId: id, from: range.from, to: range.to });
    },
  };
}
