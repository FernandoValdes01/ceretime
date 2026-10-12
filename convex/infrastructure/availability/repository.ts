import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  AVAILABILITY_CONTRACT_VERSION,
  MAX_EXPANSION_DAYS,
  WEEKDAY_MAX,
  WEEKDAY_MIN,
  expandAvailabilitySlots,
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
 * TI2-81/TI2-87 y cumple por forma los puertos `AvailabilityReader` y
 * `AvailabilityWriter` de Aplicación sin importarlos. No decide autorización
 * (TI2-86, en Aplicación) ni expande cupos (TI2-81).
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

type BlockInput = Omit<AvailabilityBlock, "id" | "version">;
type BlockWindowInput = Omit<AvailabilityBlock, "id" | "professionalId" | "version">;
type ExceptionInput = Omit<ExceptionRecord, "id" | "version">;

/** Día cualquiera para validar un bloque: su validez no depende de la fecha. */
const BLOCK_VALIDATION_DATE = "2026-01-05";

/**
 * Verdadero cuando la expansión de TI2-81 acepta lo que se va a guardar. La
 * misma regla que después produce los cupos decide qué se escribe, sin copiar
 * sus validaciones: lo guardado nunca hace fallar la expansión.
 */
function expansionAccepts(input: {
  readonly professionalId: string;
  readonly blocks: readonly AvailabilityBlock[];
  readonly exceptions: readonly AvailabilityException[];
  readonly date: string;
}): boolean {
  try {
    expandAvailabilitySlots({
      professionalId: input.professionalId,
      blocks: input.blocks,
      exceptions: input.exceptions,
      from: input.date,
      to: input.date,
      timeZone: "UTC",
    });
    return true;
  } catch {
    return false;
  }
}

function blockAccepted(block: BlockInput): boolean {
  return expansionAccepts({
    professionalId: block.professionalId,
    blocks: [{ ...block, id: "candidato", version: AVAILABILITY_CONTRACT_VERSION }],
    exceptions: [],
    date: BLOCK_VALIDATION_DATE,
  });
}

/**
 * Sala de un bloque o ventana: sin `spaceId` no hay sala (en línea); con
 * `spaceId` debe existir y seguir vigente. `null` cuando la referencia no
 * sirve. Que la modalidad exija o prohíba sala lo decide la expansión.
 */
async function activeSpaceRef(
  ctx: DbReader,
  spaceId: string | undefined,
): Promise<{ readonly spaceId?: Id<"spaces"> } | null> {
  if (spaceId === undefined) {
    return {};
  }
  const id = ctx.db.normalizeId("spaces", spaceId);
  const space = id === null ? null : await ctx.db.get(id);
  return space !== null && space.isActive ? { spaceId: space._id } : null;
}

async function getUserRef(ctx: DbReader, userId: string): Promise<Id<"users"> | null> {
  const id = ctx.db.normalizeId("users", userId);
  const user = id === null ? null : await ctx.db.get(id);
  return user === null ? null : user._id;
}

async function getBlockDoc(
  ctx: DbReader,
  blockId: string,
): Promise<Doc<"availabilityBlocks"> | null> {
  const id = ctx.db.normalizeId("availabilityBlocks", blockId);
  return id === null ? null : await ctx.db.get(id);
}

/**
 * Verdadero cuando cabe un bloque vigente más. Las escrituras respetan el
 * tope de `listActiveBlocks`: si lo superaran, la disponibilidad del
 * profesional dejaría de poder leerse.
 */
async function roomForActiveBlock(ctx: DbReader, professionalId: Id<"users">): Promise<boolean> {
  const active = await listActiveBlocks(ctx, professionalId);
  return active.status === "ok" && active.data.length < MAX_ACTIVE_BLOCKS;
}

async function insertBlock(
  ctx: MutationCtx,
  block: BlockInput,
): Promise<ApiResult<{ readonly blockId: string }>> {
  const professionalId = await getUserRef(ctx, block.professionalId);
  const space = await activeSpaceRef(ctx, block.spaceId);
  if (
    professionalId === null ||
    space === null ||
    !blockAccepted(block) ||
    !(await roomForActiveBlock(ctx, professionalId))
  ) {
    return errResult(conflictError());
  }
  const blockId = await ctx.db.insert("availabilityBlocks", {
    professionalId,
    weekday: block.weekday,
    startMinute: block.startMinute,
    endMinute: block.endMinute,
    slotMinutes: block.slotMinutes,
    modality: block.modality,
    ...space,
    isActive: true,
  });
  return okResult({ blockId });
}

/** Reemplaza la ventana del bloque; el dueño guardado no cambia. */
async function updateBlock(
  ctx: MutationCtx,
  blockId: string,
  block: BlockWindowInput,
): Promise<ApiResult<null>> {
  const current = await getBlockDoc(ctx, blockId);
  const space = await activeSpaceRef(ctx, block.spaceId);
  if (
    current === null ||
    space === null ||
    !blockAccepted({ ...block, professionalId: current.professionalId })
  ) {
    return errResult(conflictError());
  }
  // `spaceId: undefined` borra la sala al pasar a en línea.
  await ctx.db.patch(current._id, {
    weekday: block.weekday,
    startMinute: block.startMinute,
    endMinute: block.endMinute,
    slotMinutes: block.slotMinutes,
    modality: block.modality,
    spaceId: space.spaceId,
  });
  return okResult(null);
}

/**
 * Retira o reactiva un bloque. Reactivar un retirado exige que su sala siga
 * vigente y que quepa bajo el tope de bloques vigentes.
 */
async function setBlockActive(
  ctx: MutationCtx,
  blockId: string,
  isActive: boolean,
): Promise<ApiResult<null>> {
  const current = await getBlockDoc(ctx, blockId);
  if (current === null) {
    return errResult(conflictError());
  }
  if (
    isActive &&
    !current.isActive &&
    ((await activeSpaceRef(ctx, current.spaceId)) === null ||
      !(await roomForActiveBlock(ctx, current.professionalId)))
  ) {
    return errResult(conflictError());
  }
  await ctx.db.patch(current._id, { isActive });
  return okResult(null);
}

/**
 * Guarda una excepción en una fila, con a lo más una ventana. La cancelación
 * de un bloque exige que el bloque sea del mismo profesional, y la expansión
 * de TI2-81 valida la excepción junto con las ya guardadas ese día, lo que
 * también rechaza la repetida.
 *
 * Respeta el tope de `listExceptions`: toda lectura de hasta
 * `MAX_EXPANSION_DAYS` días que incluya la fecha cae dentro de los días que
 * la rodean a cada lado, así que si allí cabe una más, ninguna lectura
 * futura la supera.
 */
async function insertException(
  ctx: MutationCtx,
  exception: ExceptionInput,
): Promise<ApiResult<{ readonly exceptionId: string }>> {
  const professionalId = await getUserRef(ctx, exception.professionalId);
  const windows = exception.windows ?? [];
  if (professionalId === null || !isValidCivilDate(exception.date) || windows.length > 1) {
    return errResult(conflictError());
  }
  const window = windows[0];
  const block =
    exception.blockId === undefined ? undefined : await getBlockDoc(ctx, exception.blockId);
  const space = await activeSpaceRef(ctx, window?.spaceId);
  if (block === null || (block && block.professionalId !== professionalId) || space === null) {
    return errResult(conflictError());
  }
  const date = civilDateToEpochMs(exception.date);
  const reach = (MAX_EXPANSION_DAYS - 1) * DAY_MS;
  const nearby = await ctx.db
    .query("availabilityExceptions")
    .withIndex("by_professionalId_and_date", (q) =>
      q
        .eq("professionalId", professionalId)
        .gte("date", date - reach)
        .lte("date", date + reach),
    )
    .take(MAX_EXCEPTIONS_IN_RANGE);
  const sameDay = nearby.filter((row) => row.date === date);
  const candidate: AvailabilityException = {
    date: exception.date,
    kind: exception.kind,
    ...(block ? { blockId: block._id } : {}),
    ...(window ? { windows: [window] } : {}),
    version: AVAILABILITY_CONTRACT_VERSION,
  };
  if (
    nearby.length >= MAX_EXCEPTIONS_IN_RANGE ||
    !expansionAccepts({
      professionalId: exception.professionalId,
      blocks: [],
      exceptions: [...sameDay.map(toException), candidate],
      date: exception.date,
    })
  ) {
    return errResult(conflictError());
  }
  const exceptionId = await ctx.db.insert("availabilityExceptions", {
    professionalId,
    date,
    kind: exception.kind,
    ...(block ? { blockId: block._id } : {}),
    ...(window
      ? {
          startMinute: window.startMinute,
          endMinute: window.endMinute,
          slotMinutes: window.slotMinutes,
          modality: window.modality,
        }
      : {}),
    ...space,
    ...(exception.reason === undefined ? {} : { reason: exception.reason }),
  });
  return okResult({ exceptionId });
}

async function removeException(ctx: MutationCtx, exceptionId: string): Promise<ApiResult<null>> {
  const id = ctx.db.normalizeId("availabilityExceptions", exceptionId);
  const current = id === null ? null : await ctx.db.get(id);
  if (current === null) {
    return errResult(conflictError());
  }
  await ctx.db.delete(current._id);
  return okResult(null);
}

/**
 * Escrituras de disponibilidad para Aplicación. Validan integridad, no
 * autorización: el caso de uso llama antes a TI2-86. Ante cualquier
 * referencia inválida o regla incumplida responden `conflict` sin escribir.
 */
export function availabilityWriter(ctx: MutationCtx) {
  return {
    insertBlock: (block: BlockInput) => insertBlock(ctx, block),
    updateBlock: (blockId: string, block: BlockWindowInput) => updateBlock(ctx, blockId, block),
    setBlockActive: (blockId: string, isActive: boolean) => setBlockActive(ctx, blockId, isActive),
    insertException: (exception: ExceptionInput) => insertException(ctx, exception),
    removeException: (exceptionId: string) => removeException(ctx, exceptionId),
  };
}
