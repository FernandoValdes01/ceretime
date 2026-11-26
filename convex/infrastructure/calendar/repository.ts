import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  calendarSyncStateOf,
  isCalendarSyncErrorCode,
  type CalendarConnectionMetadata,
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
 * El vínculo no tiene un estado propio: «conectado» se deriva únicamente de
 * los alcances OAuth que Better Auth conserva para la cuenta de Google
 * (`getCalendarConnection`). Esta tabla guarda solo los metadatos que Better
 * Auth no tiene (`accountReference`, `linkedAt` y `revokedAt`) para la
 * sincronización de TI2-161. Una fila no afirma que la cuenta siga conectada:
 * si los alcances se revocan, la lectura pública responde desconectado aunque
 * la fila conserve sus metadatos.
 *
 * El estado de sincronización es uno por atención (`pending`, `synced` o
 * `error`) con sus intentos; no se crea una tabla paralela de estado. La
 * sincronización real es TI2-162 y la pantalla, TI2-172.
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
 * Metadatos locales del vínculo, sin la referencia de cuenta ni credenciales.
 * Devuelve `null` cuando la persona nunca vinculó Calendar. No expresa si la
 * cuenta sigue conectada: eso lo deciden los alcances de Better Auth.
 */
export async function readCalendarConnectionMetadata(
  ctx: DbReader,
  userId: Id<"users">,
): Promise<CalendarConnectionMetadata | null> {
  const row = await findCalendarConnection(ctx, userId);
  if (row === null) return null;
  return {
    linkedAt: row.linkedAt,
    ...(row.revokedAt === undefined ? {} : { revokedAt: row.revokedAt }),
  };
}

/** Resultado de registrar los metadatos del vínculo. */
export type CalendarConnectResult =
  | {
      readonly status: "linked" | "already_linked";
      readonly connectionId: Id<"calendarConnections">;
    }
  | { readonly status: "invalid_reference" };

/**
 * Registra o actualiza los metadatos locales del vínculo.
 *
 * No concede el acceso OAuth: los alcances los administra Better Auth y son la
 * única fuente de «conectado». `accountReference` es la referencia opaca a la
 * cuenta cifrada; el token nunca se copia acá. Una fila vigente conserva su
 * `linkedAt` original y solo actualiza `updatedAt`; una reconexión tras una
 * desconexión estrena fecha de vínculo y limpia `revokedAt`.
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
    const alreadyLinked = existing.revokedAt === undefined;
    await ctx.db.patch(existing._id, {
      accountReference: reference,
      linkedAt: alreadyLinked ? existing.linkedAt : linkedAt,
      revokedAt: undefined,
      updatedAt: linkedAt,
    });
    return {
      status: alreadyLinked ? "already_linked" : "linked",
      connectionId: existing._id,
    };
  }

  const connectionId = await ctx.db.insert("calendarConnections", {
    userId,
    accountReference: reference,
    linkedAt,
    updatedAt: linkedAt,
  });
  return { status: "linked", connectionId };
}

/** Resultado de desconectar los metadatos locales del vínculo. */
export type CalendarDisconnectResult =
  | {
      readonly status: "unlinked" | "already_unlinked";
      readonly connectionId: Id<"calendarConnections">;
    }
  | { readonly status: "not_found" };

/**
 * Desconecta los metadatos locales conservando la referencia y las fechas como
 * trazabilidad. No revoca los alcances OAuth: esa es responsabilidad de Better
 * Auth, única fuente de «conectado». No borra eventos ya creados: TI2-161 avisa
 * que pueden quedar sin actualizar. Un vínculo ya desconectado no cambia su
 * instante original.
 */
export async function disconnectCalendar(
  ctx: MutationCtx,
  userId: Id<"users">,
  revokedAt: number,
): Promise<CalendarDisconnectResult> {
  assertInstant(revokedAt, "La desconexión de Calendar requiere un instante epoch válido.");
  const existing = await findCalendarConnection(ctx, userId);
  if (existing === null) return { status: "not_found" };
  if (existing.revokedAt !== undefined) {
    return { status: "already_unlinked", connectionId: existing._id };
  }
  await ctx.db.patch(existing._id, { revokedAt, updatedAt: revokedAt });
  return { status: "unlinked", connectionId: existing._id };
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
 * Guarda `scheduledAt` para que el reintento no programe otro despacho
 * mientras este sigue en curso.
 */
export async function markCalendarSyncPending(
  ctx: MutationCtx,
  appointmentId: Id<"appointments">,
  scheduledAt: number,
): Promise<CalendarSyncRecordResult> {
  assertInstant(scheduledAt, "La programación de Calendar requiere un instante epoch válido.");
  const normalized = ctx.db.normalizeId("appointments", appointmentId);
  if (normalized === null) return { status: "invalid_reference" };
  const appointment = await ctx.db.get(normalized);
  if (appointment === null) return { status: "invalid_reference" };
  await ctx.db.patch(normalized, {
    calendarSyncStatus: "pending",
    calendarSyncErrorCode: undefined,
    calendarSyncScheduledAt: scheduledAt,
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

/**
 * Lector de metadatos del vínculo propio con Google Calendar (TI2-161).
 *
 * Capa de Infraestructura: adapta la lectura de metadatos al puerto de
 * Aplicación con identificadores de texto. Normaliza el `userId` de la sesión
 * y solo devuelve fechas; la referencia opaca y las credenciales quedan en el
 * servidor.
 */
export function calendarLinkReader(ctx: QueryCtx | MutationCtx) {
  return {
    readMetadata: async (userId: string): Promise<CalendarConnectionMetadata | null> => {
      const normalized = ctx.db.normalizeId("users", userId);
      if (normalized === null) return null;
      return await readCalendarConnectionMetadata(ctx, normalized);
    },
  };
}

/**
 * Almacén del vínculo propio con Google Calendar (TI2-161).
 *
 * Solo lo usan mutaciones: registra la confirmación del retorno OAuth y la
 * desconexión con el `userId` de la sesión. Nunca acepta la referencia desde
 * el cliente: la resuelve el lector OAuth. Reutiliza el lector para
 * `readMetadata` en vez de duplicar la normalización.
 */
export function calendarLinkStore(ctx: MutationCtx) {
  const reader = calendarLinkReader(ctx);
  return {
    readMetadata: reader.readMetadata,
    connect: async (userId: string, accountReference: string, now: number) => {
      const normalized = ctx.db.normalizeId("users", userId);
      if (normalized === null) return { status: "invalid_reference" as const };
      return await connectCalendar(ctx, normalized, accountReference, now);
    },
    disconnect: async (userId: string, now: number) => {
      const normalized = ctx.db.normalizeId("users", userId);
      if (normalized === null) return { status: "not_found" as const };
      return await disconnectCalendar(ctx, normalized, now);
    },
  };
}
