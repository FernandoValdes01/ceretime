import type { PaginationOptions } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { toStoredAccessNeeds } from "../../domain/requests/request";
import type { RequestStatusChange } from "../../domain/requests/transitions";

/**
 * Repositorio de solicitudes (TI2-9).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` en el flujo de
 * solicitudes. No decide autorización ni resuelve identidad; solo
 * persiste/recupera con los índices declarados en `convex/schema.ts`.
 *
 * Opera con datos ficticios.
 */

/** Contexto con lectura de base de datos (consultas y mutaciones). */
type DbReader = QueryCtx | MutationCtx;

/**
 * Campos de la solicitud completa que se pueden fijar al recibirla (TI2-135).
 * Todos son opcionales: sin ellos la fila queda como las anteriores. La razón
 * de cierre y la derivación de salida no están porque se escriben al cerrar o
 * derivar, no al recibir. La clave de idempotencia tampoco está: solo la
 * escribe `insertReceivedRequestOnce`, que comprueba el duplicado.
 */
export type ReceivedRequestExtras = Pick<
  Doc<"requests">,
  | "needSummary"
  | "expectedOutcome"
  | "accessNeedSelections"
  | "otherAccessNeed"
  | "modalityPreference"
  | "generalAvailability"
  | "preferredAccessibleInformationChannel"
  | "provenance"
  | "incomingReferral"
>;

/**
 * Necesidades de acceso del envío: el texto unido suelto, o la lista
 * estructurada de la que el repositorio deriva ese texto con
 * `toStoredAccessNeeds`. Nunca las dos, para que no puedan contradecirse.
 */
type ReceivedRequestNeeds =
  | {
      readonly accessNeeds: string;
      readonly accessNeedSelections?: undefined;
      readonly otherAccessNeed?: undefined;
    }
  | {
      readonly accessNeedSelections: NonNullable<Doc<"requests">["accessNeedSelections"]>;
      readonly accessNeeds?: undefined;
      readonly otherAccessNeed?: string;
    };

export type ReceivedRequestInput = Omit<
  ReceivedRequestExtras,
  "accessNeedSelections" | "otherAccessNeed"
> &
  ReceivedRequestNeeds & {
    readonly studentId: Id<"users">;
  };

/**
 * Inserta una solicitud recibida del estudiante. No acepta la clave de
 * idempotencia: para guardarla hay que usar `insertReceivedRequestOnce`.
 */
export async function insertReceivedRequest(ctx: MutationCtx, input: ReceivedRequestInput) {
  return await insertRequestRow(ctx, input);
}

/** Fila de `requests` con el texto unido ya resuelto desde una sola fuente. */
async function insertRequestRow(
  ctx: MutationCtx,
  input: ReceivedRequestInput,
  idempotencyKey?: string,
) {
  // La fila se arma campo por campo, sin `...input`: un spread puede traer
  // `idempotencyKey` sin que TypeScript lo revise y la clave se colaría por la
  // vía que no comprueba duplicados. Solo se guarda el parámetro explícito.
  const {
    studentId,
    needSummary,
    expectedOutcome,
    accessNeedSelections,
    otherAccessNeed,
    modalityPreference,
    generalAvailability,
    preferredAccessibleInformationChannel,
    provenance,
    incomingReferral,
  } = input;
  const resolvedAccessNeeds =
    input.accessNeedSelections === undefined
      ? input.accessNeeds
      : storedAccessNeeds(input.accessNeedSelections, input.otherAccessNeed);
  return await ctx.db.insert("requests", {
    studentId,
    status: "received",
    accessNeeds: resolvedAccessNeeds,
    createdAt: Date.now(),
    ...(needSummary === undefined ? {} : { needSummary }),
    ...(expectedOutcome === undefined ? {} : { expectedOutcome }),
    ...(accessNeedSelections === undefined ? {} : { accessNeedSelections }),
    ...(otherAccessNeed === undefined ? {} : { otherAccessNeed }),
    ...(modalityPreference === undefined ? {} : { modalityPreference }),
    ...(generalAvailability === undefined ? {} : { generalAvailability }),
    ...(preferredAccessibleInformationChannel === undefined
      ? {}
      : { preferredAccessibleInformationChannel }),
    ...(provenance === undefined ? {} : { provenance }),
    ...(incomingReferral === undefined ? {} : { incomingReferral }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  });
}

/** Texto unido de las condiciones de acceso, o error de dominio si no hay texto. */
function storedAccessNeeds(
  selections: NonNullable<Doc<"requests">["accessNeedSelections"]>,
  otherAccessNeed?: string,
): string {
  const result = toStoredAccessNeeds(selections, otherAccessNeed);
  if (result.status === "error") {
    throw new Error(result.error.message);
  }
  return result.data.accessNeeds;
}

/** Solicitud del estudiante con esa clave de idempotencia, si existe. */
export async function findRequestByIdempotencyKey(
  ctx: DbReader,
  studentId: Id<"users">,
  idempotencyKey: string,
): Promise<Doc<"requests"> | null> {
  const rows = await ctx.db
    .query("requests")
    .withIndex("by_student_and_idempotencyKey", (q) =>
      q.eq("studentId", studentId).eq("idempotencyKey", idempotencyKey),
    )
    .take(1);
  return rows[0] ?? null;
}

/**
 * Inserta la solicitud recibida salvo que el estudiante ya tenga una con la
 * misma clave de idempotencia (TI2-135): en ese caso devuelve la existente sin
 * escribir. La búsqueda y la inserción ocurren en la misma mutation, así que
 * dos envíos concurrentes con la misma clave no dejan dos filas: Convex
 * reintenta al que pierde el conflicto y este ya encuentra la primera.
 */
export async function insertReceivedRequestOnce(
  ctx: MutationCtx,
  input: ReceivedRequestInput & { readonly idempotencyKey: string },
): Promise<{ readonly requestId: Id<"requests">; readonly created: boolean }> {
  const { idempotencyKey, ...received } = input;
  const existing = await findRequestByIdempotencyKey(ctx, input.studentId, idempotencyKey);
  if (existing !== null) return { requestId: existing._id, created: false };
  return { requestId: await insertRequestRow(ctx, received, idempotencyKey), created: true };
}

/** Solicitud por id, o `null` si no existe. */
export async function getRequestById(
  ctx: DbReader,
  requestId: Id<"requests">,
): Promise<Doc<"requests"> | null> {
  return await ctx.db.get(requestId);
}

/**
 * Actualiza el estado de una solicitud con el destino que decidió la política.
 * Al cerrar sin acompañamiento (TI2-141), la razón comprensible va en la misma
 * escritura; el rastro histórico va aparte, en `logRequestTransition`, dentro
 * de la misma mutation.
 */
export async function setRequestStatus(
  ctx: MutationCtx,
  requestId: Id<"requests">,
  change: RequestStatusChange,
): Promise<void> {
  await ctx.db.patch(
    requestId,
    change.status === "closed_without_accompaniment"
      ? { status: change.status, closureReason: change.closureReason }
      : { status: change.status },
  );
}

/** Registra el cambio de estado con motivo, actor y fecha. */
export async function logRequestTransition(
  ctx: MutationCtx,
  input: {
    readonly requestId: Id<"requests">;
    readonly from: Doc<"requests">["status"];
    readonly to: Doc<"requests">["status"];
    readonly actorId: Id<"users">;
    readonly reason?: string;
    readonly occurredAt: number;
  },
): Promise<void> {
  await ctx.db.insert("requestTransitions", {
    requestId: input.requestId,
    from: input.from,
    to: input.to,
    actorId: input.actorId,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    occurredAt: input.occurredAt,
  });
}

/**
 * Lecturas y escrituras de una solicitud para los puertos de Aplicación
 * (TI2-141). Cumple `RequestReader`, `RequestStatusWriter` y
 * `RequestTransitionRecorder` por forma, sin importarlos; Presentación lo crea
 * con el `ctx` de la mutation, así todo queda en la misma transacción.
 */
export function requestStore(ctx: MutationCtx) {
  return {
    getRequest: (requestId: Id<"requests">) => getRequestById(ctx, requestId),
    setRequestStatus: (requestId: Id<"requests">, change: RequestStatusChange) =>
      setRequestStatus(ctx, requestId, change),
    logRequestTransition: (entry: Parameters<typeof logRequestTransition>[1]) =>
      logRequestTransition(ctx, entry),
  };
}

/** Tope de cambios recientes que se leen para armar el detalle. */
const RECENT_TRANSITIONS_LIMIT = 50;

/** Cambios de estado más recientes de la solicitud, del último al primero. */
export async function listRecentRequestTransitions(
  ctx: DbReader,
  requestId: Id<"requests">,
): Promise<Doc<"requestTransitions">[]> {
  return await ctx.db
    .query("requestTransitions")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .order("desc")
    .take(RECENT_TRANSITIONS_LIMIT);
}

/** Solicitudes propias del estudiante, paginadas. */
export async function listOwnedRequests(
  ctx: DbReader,
  studentId: Id<"users">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("requests")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .paginate(paginationOpts);
}

/** Solicitudes en un estado dado, paginadas. */
export async function listRequestsByStatus(
  ctx: DbReader,
  status: Doc<"requests">["status"],
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("requests")
    .withIndex("by_status", (q) => q.eq("status", status))
    .paginate(paginationOpts);
}

/** Tomas activas del usuario, paginadas por solicitud para duplicadas adyacentes. */
export async function listActiveTakes(
  ctx: DbReader,
  userId: Id<"users">,
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("requestAssignments")
    .withIndex("by_user_and_status_and_request", (q) =>
      q.eq("userId", userId).eq("status", "active"),
    )
    .order("asc")
    .paginate(paginationOpts);
}

/** Toma activa exacta de la solicitud por el usuario, si existe. */
export async function findActiveTake(
  ctx: DbReader,
  requestId: Id<"requests">,
  userId: Id<"users">,
): Promise<Doc<"requestAssignments"> | null> {
  const rows = await ctx.db
    .query("requestAssignments")
    .withIndex("by_request_and_user_and_status", (q) =>
      q.eq("requestId", requestId).eq("userId", userId).eq("status", "active"),
    )
    .take(1);
  return rows[0] ?? null;
}

/** Crea la toma activa de la solicitud por el usuario. */
export async function insertActiveTake(
  ctx: MutationCtx,
  input: {
    readonly requestId: Id<"requests">;
    readonly userId: Id<"users">;
    readonly grantedBy: Id<"users">;
  },
) {
  return await ctx.db.insert("requestAssignments", {
    requestId: input.requestId,
    userId: input.userId,
    grantedBy: input.grantedBy,
    grantedAt: Date.now(),
    status: "active",
  });
}

/** Marca la solicitud como tomada por el usuario. */
export async function markRequestTaken(
  ctx: MutationCtx,
  requestId: Id<"requests">,
  userId: Id<"users">,
): Promise<void> {
  await ctx.db.patch(requestId, { takenBy: userId });
}
