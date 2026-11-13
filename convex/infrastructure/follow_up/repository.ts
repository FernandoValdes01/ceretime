import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { AppointmentStatus } from "../../domain/appointments/appointment";
import {
  FOLLOW_UP_ENTRIES_MAX,
  isFollowUpRetry,
  validateFollowUpRecord,
  type FollowUpRecord,
  type FollowUpRecordInput,
  type FollowUpRejectionCause,
} from "../../domain/follow_up/follow_up";
import { insertInternalNote } from "../accompaniments/repository";

/**
 * Repositorio del registro de seguimiento (TI2-118).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` para
 * `followUpRecords`, `followUpAgreements` y `followUpTasks`. Persiste la forma
 * de TI2-106 después de validarla con `validateFollowUpRecord` contra el
 * estado vigente de la atención, así no se guardan diagnósticos ni registros
 * de atenciones que aún no ocurrieron. Acuerdos y tareas son filas propias
 * del registro, no arrays del documento.
 *
 * El primer guardado confirma el registro (TI2-146): un reintento idéntico no
 * escribe y otro contenido se rechaza. No hay funciones de edición ni de
 * borrado.
 *
 * La nota interna se guarda solo en `followUpNotes` mediante el repositorio de
 * acompañamientos; el registro conserva la referencia y sus lecturas no la
 * resuelven, para que ninguna proyección copie el texto por accidente. El
 * texto sale solo por `readInternalNote` del adaptador de lectura, que
 * Aplicación pide únicamente para la vista `professional`, y por la
 * comparación de un reintento, que no lo devuelve. No decide autorización ni
 * minimización (TI2-127).
 *
 * Opera con datos ficticios.
 */

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

/**
 * Entrada del guardado: la forma de TI2-106 sin el estado de la atención,
 * que el repositorio lee de `appointments` en vez de confiar en quien llama.
 */
export type FollowUpRecordSaveInput = Omit<FollowUpRecordInput, "appointmentStatus"> & {
  readonly authorId: string;
};

/**
 * Resultado del guardado. `invalid` trae las causas de TI2-106;
 * `invalid_reference` cubre atención, acompañamiento o autor inexistentes, de
 * otra tabla o que no corresponden entre sí; `already_confirmed`, un registro
 * ya confirmado que llega con otro contenido (TI2-146). Ninguno de los tres
 * escribe.
 */
export type FollowUpRecordSaveResult =
  | {
      readonly status: "saved";
      readonly recordId: Id<"followUpRecords">;
      readonly created: boolean;
    }
  | { readonly status: "invalid"; readonly causes: readonly FollowUpRejectionCause[] }
  | { readonly status: "invalid_reference" }
  | { readonly status: "already_confirmed" };

/** Registro de la atención, o `null` si aún no tiene seguimiento. */
async function findRecordRow(
  ctx: DbReader,
  appointmentId: Id<"appointments">,
): Promise<Doc<"followUpRecords"> | null> {
  return await ctx.db
    .query("followUpRecords")
    .withIndex("by_appointmentId", (q) => q.eq("appointmentId", appointmentId))
    .unique();
}

/** Acuerdos del registro en el orden en que se guardaron. */
async function takeAgreementRows(ctx: DbReader, recordId: Id<"followUpRecords">) {
  return await ctx.db
    .query("followUpAgreements")
    .withIndex("by_recordId", (q) => q.eq("recordId", recordId))
    .take(FOLLOW_UP_ENTRIES_MAX);
}

/** Tareas del registro en el orden en que se guardaron. */
async function takeTaskRows(ctx: DbReader, recordId: Id<"followUpRecords">) {
  return await ctx.db
    .query("followUpTasks")
    .withIndex("by_recordId", (q) => q.eq("recordId", recordId))
    .take(FOLLOW_UP_ENTRIES_MAX);
}

/** Guarda acuerdos y tareas del registro recién confirmado, en su orden. */
async function insertEntries(
  ctx: MutationCtx,
  recordId: Id<"followUpRecords">,
  record: FollowUpRecord,
): Promise<void> {
  for (const agreement of record.agreements) {
    await ctx.db.insert("followUpAgreements", {
      recordId,
      entryId: agreement.id,
      description: agreement.description,
    });
  }
  for (const task of record.tasks) {
    await ctx.db.insert("followUpTasks", {
      recordId,
      entryId: task.id,
      description: task.description,
      responsible: task.responsible,
      status: task.status,
    });
  }
}

/** Registro guardado sin la nota: acuerdos y tareas en el orden en que se guardaron. */
async function toRecordWithoutNote(
  ctx: DbReader,
  row: Doc<"followUpRecords">,
  accompanimentId: Id<"accompaniments">,
): Promise<Omit<FollowUpRecord, "internalNote">> {
  const agreements = await takeAgreementRows(ctx, row._id);
  const tasks = await takeTaskRows(ctx, row._id);
  return {
    appointmentId: row.appointmentId,
    accompanimentId,
    agreements: agreements.map((agreement) => ({
      id: agreement.entryId,
      description: agreement.description,
    })),
    tasks: tasks.map((task) => ({
      id: task.entryId,
      description: task.description,
      responsible: task.responsible,
      status: task.status,
    })),
    nextSteps: row.nextSteps,
    ...(row.suggestedNextAppointmentDate === undefined
      ? {}
      : { suggestedNextAppointmentDate: row.suggestedNextAppointmentDate }),
    version: row.version,
  };
}

/**
 * Registro confirmado con su nota, solo para compararlo con un reintento.
 *
 * Resuelve el texto de `followUpNotes` dentro de la mutation y no sale del
 * repositorio: ninguna lectura pública lo recibe por esta vía.
 */
async function readConfirmedRecord(
  ctx: MutationCtx,
  row: Doc<"followUpRecords">,
  accompanimentId: Id<"accompaniments">,
): Promise<FollowUpRecord> {
  const record = await toRecordWithoutNote(ctx, row, accompanimentId);
  const note = row.internalNoteId === undefined ? null : await ctx.db.get(row.internalNoteId);
  return note === null ? record : { ...record, internalNote: note.body };
}

/**
 * Guarda y confirma el registro de seguimiento de una atención (TI2-146).
 *
 * La atención debe existir, el acompañamiento indicado debe ser el suyo y el
 * autor debe existir; el estado vigente de la atención decide si el
 * seguimiento procede. Hay como máximo un registro por atención y el primer
 * guardado lo confirma: un reintento idéntico devuelve el mismo registro sin
 * escribir, y cualquier otro contenido responde `already_confirmed`. Esta es
 * la única vía de escritura del registro, así que no hay forma de editarlo,
 * reemplazarlo ni eliminarlo. Dos guardados simultáneos leen el mismo índice:
 * Convex reintenta el que pierde y ese reintento ya encuentra el registro.
 */
export async function saveFollowUpRecord(
  ctx: MutationCtx,
  input: FollowUpRecordSaveInput,
): Promise<FollowUpRecordSaveResult> {
  const appointmentId = ctx.db.normalizeId("appointments", input.appointmentId.trim());
  const appointment = appointmentId === null ? null : await ctx.db.get(appointmentId);
  if (appointment === null) return { status: "invalid_reference" };

  const validation = validateFollowUpRecord({ ...input, appointmentStatus: appointment.status });
  if (validation.status === "invalid") return validation;
  const { record } = validation;

  const authorId = ctx.db.normalizeId("users", input.authorId);
  if (
    record.accompanimentId !== appointment.accompanimentId ||
    authorId === null ||
    (await ctx.db.get(authorId)) === null
  ) {
    return { status: "invalid_reference" };
  }

  const existing = await findRecordRow(ctx, appointment._id);
  if (existing !== null) {
    const confirmed = await readConfirmedRecord(ctx, existing, appointment.accompanimentId);
    return isFollowUpRetry(confirmed, record)
      ? { status: "saved", recordId: existing._id, created: false }
      : { status: "already_confirmed" };
  }

  const internalNoteId =
    record.internalNote === undefined
      ? undefined
      : await insertInternalNote(ctx, {
          accompanimentId: appointment.accompanimentId,
          authorId,
          body: record.internalNote,
        });
  const recordId = await ctx.db.insert("followUpRecords", {
    appointmentId: appointment._id,
    authorId,
    nextSteps: record.nextSteps,
    ...(record.suggestedNextAppointmentDate === undefined
      ? {}
      : { suggestedNextAppointmentDate: record.suggestedNextAppointmentDate }),
    ...(internalNoteId === undefined ? {} : { internalNoteId }),
    version: record.version,
    // El registro no se vuelve a escribir: `updatedAt` queda como su confirmación.
    updatedAt: Date.now(),
  });
  await insertEntries(ctx, recordId, record);
  return { status: "saved", recordId, created: true };
}

/**
 * Registro leído sin la nota interna. `internalNoteId` permite vincularla
 * con la lectura autorizada de `followUpNotes`, que es la única vía al texto.
 */
export interface StoredFollowUpRecord {
  readonly id: Id<"followUpRecords">;
  readonly record: Omit<FollowUpRecord, "internalNote">;
  readonly appointmentStatus: AppointmentStatus;
  readonly internalNoteId?: Id<"followUpNotes">;
}

/** Registro leído con el estado vigente de su atención y la referencia a la nota. */
async function toStoredRecord(
  ctx: DbReader,
  row: Doc<"followUpRecords">,
  appointment: Doc<"appointments">,
): Promise<StoredFollowUpRecord> {
  return {
    id: row._id,
    record: await toRecordWithoutNote(ctx, row, appointment.accompanimentId),
    appointmentStatus: appointment.status,
    ...(row.internalNoteId === undefined ? {} : { internalNoteId: row.internalNoteId }),
  };
}

/**
 * Registro de seguimiento de la atención, o `null` si no hay atención o aún
 * no tiene seguimiento. El estado y el acompañamiento se leen de la atención
 * vigente; `toSharedFollowUpProjection` lo recibe tal cual.
 */
export async function findFollowUpRecordByAppointment(
  ctx: DbReader,
  appointmentId: string,
): Promise<StoredFollowUpRecord | null> {
  const id = ctx.db.normalizeId("appointments", appointmentId);
  const appointment = id === null ? null : await ctx.db.get(id);
  if (appointment === null) return null;
  const row = await findRecordRow(ctx, appointment._id);
  return row === null ? null : await toStoredRecord(ctx, row, appointment);
}

/**
 * Registros de las atenciones de un acompañamiento, de la más reciente a la
 * más antigua. Pagina atenciones, no registros: una página puede traer menos
 * registros que `limit`, y un acompañamiento sin forma devuelve una página
 * vacía. Solo recorre el índice del acompañamiento, así que no mezcla
 * historiales.
 */
async function paginateFollowUpRecordsByAccompaniment(
  ctx: DbReader,
  accompanimentId: string,
  page: { readonly limit: number; readonly cursor: string | null },
): Promise<{
  readonly items: readonly StoredFollowUpRecord[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}> {
  const id = ctx.db.normalizeId("accompaniments", accompanimentId);
  if (id === null) return { items: [], hasMore: false, nextCursor: null };
  const appointments = await ctx.db
    .query("appointments")
    .withIndex("by_accompanimentId_and_startsAt", (q) => q.eq("accompanimentId", id))
    .order("desc")
    .paginate({ numItems: page.limit, cursor: page.cursor });

  const items: StoredFollowUpRecord[] = [];
  for (const appointment of appointments.page) {
    const row = await findRecordRow(ctx, appointment._id);
    if (row !== null) items.push(await toStoredRecord(ctx, row, appointment));
  }
  return {
    items,
    hasMore: !appointments.isDone,
    nextCursor: appointments.isDone ? null : appointments.continueCursor,
  };
}

/**
 * Adaptador del guardado (TI2-146) con la forma que espera Aplicación, sin
 * importar sus tipos para que Infraestructura no dependa de Aplicación.
 */
export function followUpRecorder(ctx: MutationCtx) {
  return {
    save: (input: FollowUpRecordSaveInput) => saveFollowUpRecord(ctx, input),
  };
}

/**
 * Adaptador de lectura del seguimiento. La nota se entrega solo si su fila
 * pertenece al acompañamiento del registro: una referencia cruzada no filtra
 * el texto de otro acompañamiento.
 */
export function followUpRecordReader(ctx: DbReader) {
  return {
    findByAppointment: (appointmentId: string) =>
      findFollowUpRecordByAppointment(ctx, appointmentId),
    listByAccompaniment: (
      accompanimentId: string,
      page: { readonly limit: number; readonly cursor: string | null },
    ) => paginateFollowUpRecordsByAccompaniment(ctx, accompanimentId, page),
    readInternalNote: async (noteId: string, accompanimentId: string) => {
      const id = ctx.db.normalizeId("followUpNotes", noteId);
      const note = id === null ? null : await ctx.db.get(id);
      return note === null || note.accompanimentId !== accompanimentId ? null : note.body;
    },
  };
}
