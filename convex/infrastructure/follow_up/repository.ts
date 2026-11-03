import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { AppointmentStatus } from "../../domain/appointments/appointment";
import {
  FOLLOW_UP_ENTRIES_MAX,
  validateFollowUpRecord,
  type FollowUpRecord,
  type FollowUpRecordInput,
  type FollowUpRejectionCause,
} from "../../domain/follow_up/follow_up";
import { insertInternalNote, updateInternalNote } from "../accompaniments/repository";

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
 * La nota interna se guarda solo en `followUpNotes` mediante el repositorio de
 * acompañamientos; el registro conserva la referencia y la lectura de este
 * repositorio nunca la resuelve, para que ninguna proyección copie el texto.
 * No decide autorización ni minimización (TI2-127).
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
 * otra tabla o que no corresponden entre sí. Ninguno de los dos escribe.
 */
export type FollowUpRecordSaveResult =
  | {
      readonly status: "saved";
      readonly recordId: Id<"followUpRecords">;
      readonly created: boolean;
    }
  | { readonly status: "invalid"; readonly causes: readonly FollowUpRejectionCause[] }
  | { readonly status: "invalid_reference" };

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

/** Reemplaza acuerdos y tareas del registro por los del registro validado. */
async function replaceEntries(
  ctx: MutationCtx,
  recordId: Id<"followUpRecords">,
  record: FollowUpRecord,
): Promise<void> {
  for (const row of await takeAgreementRows(ctx, recordId)) await ctx.db.delete(row._id);
  for (const row of await takeTaskRows(ctx, recordId)) await ctx.db.delete(row._id);
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

/**
 * Guarda la nota interna en `followUpNotes` y devuelve su referencia.
 *
 * Reescribe la nota ya vinculada al registro en vez de crear otra, así un
 * reintento no duplica notas. Sin nota en la entrada, el registro deja de
 * apuntar a ella, pero la nota sigue en `followUpNotes` como parte del
 * historial del acompañamiento.
 */
async function saveInternalNote(
  ctx: MutationCtx,
  input: {
    readonly current: Id<"followUpNotes"> | undefined;
    readonly accompanimentId: Id<"accompaniments">;
    readonly authorId: Id<"users">;
    readonly body: string | undefined;
  },
): Promise<Id<"followUpNotes"> | undefined> {
  if (input.body === undefined) return undefined;
  if (input.current !== undefined && (await ctx.db.get(input.current)) !== null) {
    await updateInternalNote(ctx, input.current, { authorId: input.authorId, body: input.body });
    return input.current;
  }
  return await insertInternalNote(ctx, {
    accompanimentId: input.accompanimentId,
    authorId: input.authorId,
    body: input.body,
  });
}

/**
 * Crea o reemplaza el registro de seguimiento de una atención.
 *
 * La atención debe existir, el acompañamiento indicado debe ser el suyo y el
 * autor debe existir; el estado vigente de la atención decide si el
 * seguimiento procede. Como máximo hay un registro por atención: guardar de
 * nuevo reemplaza próximos pasos, acuerdos y tareas en la misma transacción.
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
  const internalNoteId = await saveInternalNote(ctx, {
    current: existing?.internalNoteId,
    accompanimentId: appointment.accompanimentId,
    authorId,
    body: record.internalNote,
  });
  const fields = {
    authorId,
    nextSteps: record.nextSteps,
    suggestedNextAppointmentDate: record.suggestedNextAppointmentDate,
    internalNoteId,
    version: record.version,
    updatedAt: Date.now(),
  };

  if (existing === null) {
    const recordId = await ctx.db.insert("followUpRecords", {
      appointmentId: appointment._id,
      authorId,
      nextSteps: fields.nextSteps,
      ...(fields.suggestedNextAppointmentDate === undefined
        ? {}
        : { suggestedNextAppointmentDate: fields.suggestedNextAppointmentDate }),
      ...(internalNoteId === undefined ? {} : { internalNoteId }),
      version: fields.version,
      updatedAt: fields.updatedAt,
    });
    await replaceEntries(ctx, recordId, record);
    return { status: "saved", recordId, created: true };
  }
  // Los opcionales en `undefined` borran la fecha o la referencia anteriores.
  await ctx.db.patch(existing._id, fields);
  await replaceEntries(ctx, existing._id, record);
  return { status: "saved", recordId: existing._id, created: false };
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
  if (row === null) return null;

  const agreements = await takeAgreementRows(ctx, row._id);
  const tasks = await takeTaskRows(ctx, row._id);
  return {
    id: row._id,
    record: {
      appointmentId: appointment._id,
      accompanimentId: appointment.accompanimentId,
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
    },
    appointmentStatus: appointment.status,
    ...(row.internalNoteId === undefined ? {} : { internalNoteId: row.internalNoteId }),
  };
}
