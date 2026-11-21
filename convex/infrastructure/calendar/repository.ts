import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  calendarSyncStateOf,
  isCalendarSyncErrorCode,
  type CalendarConnectionState,
  type CalendarSyncErrorCode,
  type CalendarSyncState,
} from "../../domain/calendar/calendar_link";

/**
 * Repositorio de vínculos con Google Calendar y sincronización por atención
 * (TI2-145).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` para
 * `calendarConnections` y para los campos `calendarSync*` de `appointments`.
 * No habla con Google ni renueva tokens: las credenciales viven cifradas en el
 * componente de Better Auth y acá solo se guarda una referencia opaca a esa
 * cuenta. Ninguna lectura de este repositorio devuelve tokens.
 *
 * El vínculo es uno por usuario (`connected` o `revoked`). El estado de
 * sincronización es uno por atención (`pending`, `synced` o `error`) con sus
 * intentos; no se crea una tabla paralela de estado. La sincronización real es
 * TI2-162 y la pantalla, TI2-172.
 *
 * Opera con datos ficticios.
 */

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

function assertInstant(value: number, message: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(message);
}

/** Fila completa del vínculo, para la infraestructura que debe desconectar. */
export async function findCalendarConnection(
  ctx: DbReader,
  userId: Id<"users">,
): Promise<Doc<"calendarConnections"> | null> {
  return await ctx.db
    .query("calendarConnections")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/**
 * Estado visible del vínculo, sin la referencia de cuenta ni credenciales.
 * Devuelve `null` cuando la persona nunca vinculó Calendar.
 */
export async function readCalendarConnection(
  ctx: DbReader,
  userId: Id<"users">,
): Promise<CalendarConnectionState | null> {
  const row = await findCalendarConnection(ctx, userId);
  if (row === null) return null;
  return {
    status: row.status,
    linkedAt: row.linkedAt,
    ...(row.revokedAt === undefined ? {} : { revokedAt: row.revokedAt }),
  };
}

/** Resultado de vincular o reconectar la cuenta. */
export type CalendarConnectResult =
  | {
      readonly status: "connected" | "already_connected";
      readonly connectionId: Id<"calendarConnections">;
    }
  | { readonly status: "invalid_reference" };

/**
 * Vincula la cuenta de Calendar del usuario o reactiva su vínculo revocado.
 *
 * `accountReference` es la referencia opaca a la cuenta cifrada de Better
 * Auth; el token nunca se copia acá. Una cuenta ya vinculada conserva su
 * `linkedAt` original y solo actualiza `updatedAt`; una reconexión estrena
 * fecha de vínculo y limpia la revocación.
 */
export async function connectCalendar(
  ctx: MutationCtx,
  userId: Id<"users">,
  accountReference: string,
  linkedAt: number,
): Promise<CalendarConnectResult> {
  if (!Number.isFinite(linkedAt) || linkedAt <= 0) {
    throw new Error("El vínculo de Calendar requiere un instante epoch válido.");
  }
  const reference = accountReference.trim();
  if (reference === "") {
    throw new Error("El vínculo de Calendar requiere una referencia de cuenta.");
  }
  if ((await ctx.db.get(userId)) === null) return { status: "invalid_reference" };

  const existing = await findCalendarConnection(ctx, userId);
  if (existing !== null) {
    const alreadyConnected = existing.status === "connected";
    await ctx.db.patch(existing._id, {
      status: "connected",
      accountReference: reference,
      linkedAt: alreadyConnected ? existing.linkedAt : linkedAt,
      revokedAt: undefined,
      updatedAt: linkedAt,
    });
    return {
      status: alreadyConnected ? "already_connected" : "connected",
      connectionId: existing._id,
    };
  }

  const connectionId = await ctx.db.insert("calendarConnections", {
    userId,
    status: "connected",
    accountReference: reference,
    linkedAt,
    updatedAt: linkedAt,
  });
  return { status: "connected", connectionId };
}

/** Resultado de desconectar el vínculo. */
export type CalendarDisconnectResult =
  | {
      readonly status: "revoked" | "already_revoked";
      readonly connectionId: Id<"calendarConnections">;
    }
  | { readonly status: "not_found" };

/**
 * Desconecta Calendar conservando la referencia y la fecha como trazabilidad.
 * No borra eventos ya creados: TI2-161 avisa que pueden quedar sin
 * actualizar. Un vínculo ya revocado no cambia su instante original.
 */
export async function disconnectCalendar(
  ctx: MutationCtx,
  userId: Id<"users">,
  revokedAt: number,
): Promise<CalendarDisconnectResult> {
  assertInstant(revokedAt, "La desconexión de Calendar requiere un instante epoch válido.");
  const existing = await findCalendarConnection(ctx, userId);
  if (existing === null) return { status: "not_found" };
  if (existing.status === "revoked") {
    return { status: "already_revoked", connectionId: existing._id };
  }
  await ctx.db.patch(existing._id, {
    status: "revoked",
    revokedAt,
    updatedAt: revokedAt,
  });
  return { status: "revoked", connectionId: existing._id };
}

/** Resultado de marcar el estado de sincronización de una atención. */
export type CalendarSyncRecordResult =
  | { readonly status: "recorded"; readonly attempts: number }
  | { readonly status: "invalid_reference" };

/**
 * Marca la atención como pendiente de sincronizar sin contar un intento.
 *
 * La usa la operación que confirma una reserva o un cambio (TI2-162) antes de
 * llamar a Google; conserva los intentos acumulados y limpia el error previo.
 */
export async function markCalendarSyncPending(
  ctx: MutationCtx,
  appointmentId: Id<"appointments">,
): Promise<CalendarSyncRecordResult> {
  const normalized = ctx.db.normalizeId("appointments", appointmentId);
  if (normalized === null) return { status: "invalid_reference" };
  const appointment = await ctx.db.get(normalized);
  if (appointment === null) return { status: "invalid_reference" };
  await ctx.db.patch(normalized, {
    calendarSyncStatus: "pending",
    calendarSyncErrorCode: undefined,
  });
  return { status: "recorded", attempts: appointment.calendarSyncAttempts ?? 0 };
}

/** Resultado de un intento de sincronización, exitoso o fallido. */
export type CalendarSyncAttemptInput =
  | { readonly status: "synced"; readonly attemptedAt: number }
  | {
      readonly status: "error";
      readonly attemptedAt: number;
      readonly errorCode: CalendarSyncErrorCode;
    };

/**
 * Registra un intento real de sincronización y su resultado.
 *
 * Incrementa `calendarSyncAttempts`, guarda el instante y deja el código
 * genérico cuando falla. Un acierto limpia el error anterior. Un error de
 * Google no cambia el estado de la atención: la reserva sigue vigente.
 */
export async function recordCalendarSyncAttempt(
  ctx: MutationCtx,
  appointmentId: Id<"appointments">,
  input: CalendarSyncAttemptInput,
): Promise<CalendarSyncRecordResult> {
  if (input.status !== "synced" && input.status !== "error") {
    throw new Error("El resultado de sincronización es desconocido.");
  }
  assertInstant(
    input.attemptedAt,
    "La sincronización de Calendar requiere un instante epoch válido.",
  );
  if (input.status === "error" && !isCalendarSyncErrorCode(input.errorCode)) {
    throw new Error("El fallo de sincronización requiere un código de error conocido.");
  }

  const normalized = ctx.db.normalizeId("appointments", appointmentId);
  if (normalized === null) return { status: "invalid_reference" };
  const appointment = await ctx.db.get(normalized);
  if (appointment === null) return { status: "invalid_reference" };
  const attempts = (appointment.calendarSyncAttempts ?? 0) + 1;
  await ctx.db.patch(normalized, {
    calendarSyncStatus: input.status,
    calendarSyncAttempts: attempts,
    calendarSyncLastAttemptAt: input.attemptedAt,
    ...(input.status === "error"
      ? { calendarSyncErrorCode: input.errorCode }
      : { calendarSyncErrorCode: undefined }),
  });
  return { status: "recorded", attempts };
}

/** Estado de sincronización de la atención, o `null` en filas anteriores a TI2-145. */
export async function readCalendarSyncState(
  ctx: DbReader,
  appointmentId: Id<"appointments">,
): Promise<CalendarSyncState | null> {
  const normalized = ctx.db.normalizeId("appointments", appointmentId);
  if (normalized === null) return null;
  const appointment = await ctx.db.get(normalized);
  if (appointment === null) return null;
  return calendarSyncStateOf(appointment);
}
