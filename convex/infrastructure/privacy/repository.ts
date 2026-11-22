import type { PaginationOptions } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { isUsableInstant } from "../../domain/calendar/civil_days";
import {
  PRIVACY_CONTROL_REFERENCE_MAX_LENGTH,
  PRIVACY_DATA_CATEGORY_VALUES,
  isPrivacyBlockScope,
  isPrivacyDataCategory,
  isPrivacyResponseDeliveryChannel,
  isPrivacyRetentionDisposition,
  isPrivacyRetentionExceptionActive,
  isPrivacyRetentionExceptionKind,
  isValidPrivacyRetentionDays,
  type PrivacyBlockScope,
  type PrivacyDataCategory,
  type PrivacyResponseDeliveryChannel,
  type PrivacyResponseDeliveryReceipt,
  type PrivacyRetentionDisposition,
  type PrivacyRetentionExceptionKind,
} from "../../domain/privacy/privacy_controls";
import {
  applyPrivacyResponseExtension,
  calculatePrivacyAgencyClaimDeadline,
  calculatePrivacyResponseDeadline,
  type ExtendedPrivacyResponseDeadline,
  type PrivacyExtensionRejectionCause,
  type PrivacyResponseDeadline,
  type PrivacyResponseRule,
} from "../../domain/privacy/privacy_deadlines";
import {
  INITIAL_PRIVACY_REQUEST_STATUS,
  PRIVACY_REQUEST_CONTRACT_VERSION,
  PRIVACY_REQUEST_REASON_MAX_LENGTH,
  isTerminalPrivacyRequestStatus,
  privacyRequestChannelForRole,
  transitionPrivacyRequest,
  type PrivacyRequestChannel,
  type PrivacyRequestContractVersion,
  type PrivacyRequestKind,
  type PrivacyRequestRejectionCause,
  type PrivacyRequestResponse,
  type PrivacyRequestStatus,
  type PrivacyResponseInput,
} from "../../domain/privacy/privacy_request";
import type { Role } from "../../domain/identity/roles";

/**
 * Repositorio de solicitudes de derechos de privacidad, bloqueos temporales y
 * reglas de conservación configurable (TI2-151).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` para
 * `privacyRequests`, `privacyBlocks`, `privacyRetentionRules` y
 * `privacyRetentionExceptions`. No crea otra bitácora de auditoría (se
 * reutiliza TI2-128) ni fija plazos de conservación inventados (ADR-0003).
 *
 * La respuesta fundada y la constancia de envío quedan conservadas de forma
 * inmutable una vez escritas. Los campos de control (`reference`, `reason`,
 * `legalBasisNote`, `liftReason`) admiten solo referencias acotadas y nunca
 * copian contenido sensible.
 *
 * Opera con datos ficticios.
 */

type DbReader = QueryCtx | MutationCtx;

function assertInstant(value: number, message: string): void {
  if (!isUsableInstant(value)) throw new Error(message);
}

function assertBoundedText(value: string, maxLength: number, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(`${label} es obligatorio.`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${label} excede el límite de ${maxLength} caracteres.`);
  }
  return trimmed;
}

function assertOptionalBoundedText(
  value: string | undefined,
  maxLength: number,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (trimmed.length > maxLength) {
    throw new Error(`${label} excede el límite de ${maxLength} caracteres.`);
  }
  return trimmed;
}

/** Prórroga persistida de una solicitud de privacidad. */
export interface StoredPrivacyResponseExtension {
  readonly days: number;
  readonly extendedUntilDate: string;
  readonly extendedUntilAt: number;
  readonly extendedAt: number;
  readonly extendedBy: Id<"users">;
  readonly reason: string;
}

/** Respuesta fundada persistida con `responsibleId` tipado. */
export interface StoredPrivacyRequestResponse extends Omit<
  PrivacyRequestResponse,
  "responsibleId"
> {
  readonly responsibleId: Id<"users">;
}

/** Constancia de envío persistida con `recordedBy` tipado. */
export interface StoredPrivacyResponseDeliveryReceipt extends Omit<
  PrivacyResponseDeliveryReceipt,
  "recordedBy"
> {
  readonly recordedBy: Id<"users">;
}

/** Solicitud de derechos de privacidad persistida. */
export interface StoredPrivacyRequest {
  readonly id: Id<"privacyRequests">;
  readonly kind: PrivacyRequestKind;
  readonly status: PrivacyRequestStatus;
  readonly requesterId: Id<"users">;
  readonly requesterRole: Role;
  readonly channel: PrivacyRequestChannel;
  readonly receivedAt: number;
  readonly version: PrivacyRequestContractVersion;
  readonly responseRule: PrivacyResponseRule;
  readonly receivedDate: string;
  readonly initialDueDate: string;
  readonly initialDueAt: number;
  readonly dueAt: number;
  readonly deadlineTimeZone: string;
  readonly deadlineHolidays: readonly string[];
  readonly responsibleId?: Id<"users">;
  readonly extension?: StoredPrivacyResponseExtension;
  readonly statusReason?: string;
  readonly withdrawnAt?: number;
  readonly response?: StoredPrivacyRequestResponse;
  readonly deliveryReceipt?: StoredPrivacyResponseDeliveryReceipt;
  readonly updatedAt: number;
}

function toStoredPrivacyRequest(row: Doc<"privacyRequests">): StoredPrivacyRequest {
  return {
    id: row._id,
    kind: row.kind,
    status: row.status,
    requesterId: row.requesterId,
    requesterRole: row.requesterRole,
    channel: row.channel,
    receivedAt: row.receivedAt,
    version: row.version,
    responseRule: row.responseRule,
    receivedDate: row.receivedDate,
    initialDueDate: row.initialDueDate,
    initialDueAt: row.initialDueAt,
    dueAt: row.dueAt,
    deadlineTimeZone: row.deadlineTimeZone,
    deadlineHolidays: row.deadlineHolidays,
    ...(row.responsibleId === undefined ? {} : { responsibleId: row.responsibleId }),
    ...(row.extension === undefined ? {} : { extension: row.extension }),
    ...(row.statusReason === undefined ? {} : { statusReason: row.statusReason }),
    ...(row.withdrawnAt === undefined ? {} : { withdrawnAt: row.withdrawnAt }),
    ...(row.response === undefined ? {} : { response: row.response }),
    ...(row.deliveryReceipt === undefined ? {} : { deliveryReceipt: row.deliveryReceipt }),
    updatedAt: row.updatedAt,
  };
}

function toDomainDeadline(
  row: Doc<"privacyRequests">,
): PrivacyResponseDeadline | ExtendedPrivacyResponseDeadline {
  const isBlocking = row.kind === "blocking";
  const base: PrivacyResponseDeadline = {
    kind: row.kind,
    rule: row.responseRule,
    receivedDate: row.receivedDate,
    responseDate: row.initialDueDate,
    responseAt: row.initialDueAt,
    responseDays: isBlocking ? 2 : 30,
    extensionAllowed: !isBlocking,
    extensionCalendarDays: isBlocking ? 0 : 30,
    timeZone: row.deadlineTimeZone,
    holidays: row.deadlineHolidays,
  };
  if (row.extension === undefined) return base;
  return {
    ...base,
    extension: {
      days: row.extension.days,
      extendedUntilDate: row.extension.extendedUntilDate,
      extendedUntilAt: row.extension.extendedUntilAt,
    },
  };
}

/** Entrada para registrar una solicitud de derechos de privacidad. */
export interface CreatePrivacyRequestInput {
  readonly kind: PrivacyRequestKind;
  readonly requesterId: Id<"users">;
  readonly receivedAt: number;
  readonly timeZone: string;
  readonly holidays?: readonly string[];
}

export type CreatePrivacyRequestResult =
  | {
      readonly status: "created";
      readonly requestId: Id<"privacyRequests">;
      readonly request: StoredPrivacyRequest;
    }
  | { readonly status: "invalid_reference" };

/**
 * Registra una solicitud de derechos en estado `received`.
 *
 * El rol vigente y el canal (`student_app` o `institutional_channel`) se
 * derivan desde el perfil del titular en la base de datos y nunca se aceptan
 * desde el cliente. El plazo inicial se calcula con `calculatePrivacyResponseDeadline`.
 */
export async function createPrivacyRequest(
  ctx: MutationCtx,
  input: CreatePrivacyRequestInput,
): Promise<CreatePrivacyRequestResult> {
  const requester = await ctx.db.get(input.requesterId);
  if (requester === null) return { status: "invalid_reference" };

  const deadline = calculatePrivacyResponseDeadline({
    kind: input.kind,
    receivedAt: input.receivedAt,
    timeZone: input.timeZone,
    ...(input.holidays === undefined ? {} : { holidays: input.holidays }),
  });
  const channel = privacyRequestChannelForRole(requester.role);

  const requestId = await ctx.db.insert("privacyRequests", {
    kind: input.kind,
    status: INITIAL_PRIVACY_REQUEST_STATUS,
    requesterId: input.requesterId,
    requesterRole: requester.role,
    channel,
    receivedAt: input.receivedAt,
    version: PRIVACY_REQUEST_CONTRACT_VERSION,
    responseRule: deadline.rule,
    receivedDate: deadline.receivedDate,
    initialDueDate: deadline.responseDate,
    initialDueAt: deadline.responseAt,
    dueAt: deadline.responseAt,
    deadlineTimeZone: deadline.timeZone,
    deadlineHolidays: [...deadline.holidays],
    updatedAt: input.receivedAt,
  });

  const saved = await ctx.db.get(requestId);
  if (saved === null) throw new Error("No se encontró la solicitud recién insertada.");
  return { status: "created", requestId, request: toStoredPrivacyRequest(saved) };
}

/** Lee una solicitud de privacidad por su identificador. */
export async function getPrivacyRequest(
  ctx: DbReader,
  requestId: Id<"privacyRequests">,
): Promise<StoredPrivacyRequest | null> {
  const row = await ctx.db.get(requestId);
  return row === null ? null : toStoredPrivacyRequest(row);
}

/** Página de solicitudes de un titular, de la más reciente a la más antigua. */
export async function paginatePrivacyRequestsByRequester(
  ctx: DbReader,
  requesterId: Id<"users">,
  paginationOpts: PaginationOptions,
) {
  const result = await ctx.db
    .query("privacyRequests")
    .withIndex("by_requesterId_and_receivedAt", (q) => q.eq("requesterId", requesterId))
    .order("desc")
    .paginate(paginationOpts);
  return { ...result, page: result.page.map(toStoredPrivacyRequest) };
}

/** Página de solicitudes en un estado dado, ordenadas por vencimiento efectivo. */
export async function paginatePrivacyRequestsByStatus(
  ctx: DbReader,
  status: PrivacyRequestStatus,
  paginationOpts: PaginationOptions,
) {
  const result = await ctx.db
    .query("privacyRequests")
    .withIndex("by_status_and_dueAt", (q) => q.eq("status", status))
    .order("asc")
    .paginate(paginationOpts);
  return { ...result, page: result.page.map(toStoredPrivacyRequest) };
}

/** Página global de solicitudes ordenadas por plazo efectivo, con cota opcional. */
export async function paginatePrivacyRequestsByDeadline(
  ctx: DbReader,
  paginationOpts: PaginationOptions,
  options?: { readonly dueBefore?: number },
) {
  if (options?.dueBefore !== undefined) {
    assertInstant(options.dueBefore, "La cota de vencimiento requiere un instante epoch válido.");
  }
  const dueBefore = options?.dueBefore;
  const result = await ctx.db
    .query("privacyRequests")
    .withIndex("by_dueAt", (q) => (dueBefore === undefined ? q : q.lt("dueAt", dueBefore)))
    .order("asc")
    .paginate(paginationOpts);
  return { ...result, page: result.page.map(toStoredPrivacyRequest) };
}

/** Entrada para aplicar una transición del procedimiento de privacidad. */
export interface ApplyPrivacyRequestTransitionInput {
  readonly requestId: Id<"privacyRequests">;
  readonly to: PrivacyRequestStatus;
  readonly actorId: Id<"users">;
  readonly occurredAt: number;
  readonly reason?: string;
  readonly response?: Omit<PrivacyResponseInput, "responsibleId"> & {
    readonly responsibleId: Id<"users">;
  };
}

export type ApplyPrivacyRequestTransitionResult =
  | { readonly status: "applied"; readonly request: StoredPrivacyRequest }
  | { readonly status: "not_found" }
  | { readonly status: "invalid_reference" }
  | { readonly status: "rejected"; readonly cause: PrivacyRequestRejectionCause };

/**
 * Aplica una transición validada por `transitionPrivacyRequest` (TI2-136).
 *
 * Al cerrar en `resolved`, conserva la respuesta fundada de forma inmutable
 * (el estado es terminal y el dominio impide volver a abrirlo o reemplazarlo).
 */
export async function applyPrivacyRequestTransition(
  ctx: MutationCtx,
  input: ApplyPrivacyRequestTransitionInput,
): Promise<ApplyPrivacyRequestTransitionResult> {
  const row = await ctx.db.get(input.requestId);
  if (row === null) return { status: "not_found" };
  if ((await ctx.db.get(input.actorId)) === null) return { status: "invalid_reference" };
  if (
    input.response !== undefined &&
    input.response.responsibleId !== input.actorId &&
    (await ctx.db.get(input.response.responsibleId)) === null
  ) {
    return { status: "invalid_reference" };
  }

  const transitionResult = transitionPrivacyRequest({
    kind: row.kind,
    from: row.status,
    to: input.to,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.response === undefined ? {} : { response: input.response }),
  });

  if (transitionResult.status === "rejected") {
    return { status: "rejected", cause: transitionResult.cause };
  }

  const { change } = transitionResult;
  const patch: Partial<Doc<"privacyRequests">> = {
    status: change.to,
    updatedAt: change.occurredAt,
  };

  if (change.from === "received" && change.to === "in_review") {
    patch.responsibleId = input.actorId;
  }
  if (change.reason !== undefined) {
    patch.statusReason = change.reason;
  }
  if (change.to === "withdrawn") {
    patch.withdrawnAt = change.occurredAt;
  }
  if (change.response !== undefined && input.response !== undefined) {
    patch.responsibleId = input.response.responsibleId;
    patch.response = {
      outcome: change.response.outcome,
      reasons: change.response.reasons,
      responsibleId: input.response.responsibleId,
      respondedAt: change.response.respondedAt,
      ...(change.response.temporaryBlockUntil === undefined
        ? {}
        : { temporaryBlockUntil: change.response.temporaryBlockUntil }),
    };
  }

  await ctx.db.patch(row._id, patch);
  const updated = await ctx.db.get(row._id);
  if (updated === null) throw new Error("No se encontró la solicitud actualizada.");
  return { status: "applied", request: toStoredPrivacyRequest(updated) };
}

/** Entrada para registrar la prórroga única de hasta 30 días corridos. */
export interface ExtendPrivacyRequestDeadlineInput {
  readonly requestId: Id<"privacyRequests">;
  readonly days: number;
  readonly extendedBy: Id<"users">;
  readonly extendedAt: number;
  readonly reason: string;
}

export type ExtendPrivacyRequestDeadlineResult =
  | { readonly status: "applied"; readonly request: StoredPrivacyRequest }
  | { readonly status: "not_found" }
  | { readonly status: "invalid_reference" }
  | {
      readonly status: "rejected";
      readonly cause: PrivacyExtensionRejectionCause | "request_closed";
    };

/**
 * Aplica la prórroga única delegando el cálculo en `applyPrivacyResponseExtension`.
 *
 * Actualiza `dueAt` al nuevo vencimiento exclusivo para que los índices por
 * estado y plazo reflejen el plazo vigente sin campos paralelos.
 */
export async function extendPrivacyRequestDeadline(
  ctx: MutationCtx,
  input: ExtendPrivacyRequestDeadlineInput,
): Promise<ExtendPrivacyRequestDeadlineResult> {
  assertInstant(input.extendedAt, "La prórroga requiere un instante epoch válido.");
  const reason = assertBoundedText(
    input.reason,
    PRIVACY_REQUEST_REASON_MAX_LENGTH,
    "El motivo de la prórroga",
  );

  const row = await ctx.db.get(input.requestId);
  if (row === null) return { status: "not_found" };
  if ((await ctx.db.get(input.extendedBy)) === null) return { status: "invalid_reference" };
  if (isTerminalPrivacyRequestStatus(row.status)) {
    return { status: "rejected", cause: "request_closed" };
  }

  const extensionResult = applyPrivacyResponseExtension(toDomainDeadline(row), input.days);
  if (extensionResult.status === "rejected") {
    return { status: "rejected", cause: extensionResult.cause };
  }

  const { extension } = extensionResult.deadline;
  await ctx.db.patch(row._id, {
    extension: {
      days: extension.days,
      extendedUntilDate: extension.extendedUntilDate,
      extendedUntilAt: extension.extendedUntilAt,
      extendedAt: input.extendedAt,
      extendedBy: input.extendedBy,
      reason,
    },
    dueAt: extension.extendedUntilAt,
    updatedAt: input.extendedAt,
  });

  const updated = await ctx.db.get(row._id);
  if (updated === null) throw new Error("No se encontró la solicitud prorrogada.");
  return { status: "applied", request: toStoredPrivacyRequest(updated) };
}

/** Entrada para registrar la constancia inmutable de envío de la respuesta. */
export interface RecordPrivacyResponseDeliveryInput {
  readonly requestId: Id<"privacyRequests">;
  readonly channel: PrivacyResponseDeliveryChannel;
  readonly sentAt: number;
  readonly recordedBy: Id<"users">;
  readonly reference: string;
}

export type RecordPrivacyResponseDeliveryResult =
  | {
      readonly status: "recorded";
      readonly receipt: StoredPrivacyResponseDeliveryReceipt;
    }
  | { readonly status: "not_found" }
  | { readonly status: "invalid_reference" }
  | { readonly status: "not_resolved" }
  | { readonly status: "already_recorded" };

/**
 * Registra la constancia de envío de la respuesta fundada y calcula el plazo
 * de 30 días hábiles para reclamar ante la Agencia desde `sentAt`.
 *
 * Es inmutable: si la solicitud ya tiene constancia registrada devuelve
 * `already_recorded` sin reemplazarla. `reference` admite solo un folio u
 * identificador opaco acotado.
 */
export async function recordPrivacyResponseDelivery(
  ctx: MutationCtx,
  input: RecordPrivacyResponseDeliveryInput,
): Promise<RecordPrivacyResponseDeliveryResult> {
  if (!isPrivacyResponseDeliveryChannel(input.channel)) {
    throw new Error(`Canal de constancia de envío desconocido: ${String(input.channel)}.`);
  }
  assertInstant(input.sentAt, "La constancia de envío requiere un instante epoch válido.");
  const reference = assertBoundedText(
    input.reference,
    PRIVACY_CONTROL_REFERENCE_MAX_LENGTH,
    "La referencia de envío",
  );

  const row = await ctx.db.get(input.requestId);
  if (row === null) return { status: "not_found" };
  if ((await ctx.db.get(input.recordedBy)) === null) return { status: "invalid_reference" };
  if (row.status !== "resolved" || row.response === undefined) {
    return { status: "not_resolved" };
  }
  if (row.deliveryReceipt !== undefined) return { status: "already_recorded" };
  if (input.sentAt < row.response.respondedAt) {
    throw new Error("El envío de la respuesta no puede ser anterior a la emisión de la respuesta.");
  }

  const claimDeadline = calculatePrivacyAgencyClaimDeadline({
    notifiedAt: input.sentAt,
    timeZone: row.deadlineTimeZone,
    holidays: row.deadlineHolidays,
  });

  const receipt: StoredPrivacyResponseDeliveryReceipt = {
    channel: input.channel,
    sentAt: input.sentAt,
    recordedBy: input.recordedBy,
    reference,
    agencyClaimDueDate: claimDeadline.claimDate,
    agencyClaimDueAt: claimDeadline.claimAt,
  };

  await ctx.db.patch(row._id, {
    deliveryReceipt: receipt,
    updatedAt: Math.max(row.updatedAt, input.sentAt),
  });
  return { status: "recorded", receipt };
}

// ---------------------------------------------------------------------------
// Bloqueos temporales (`privacyBlocks`)
// ---------------------------------------------------------------------------

/** Bloqueo temporal persistido con su alcance. */
export interface StoredPrivacyBlock {
  readonly id: Id<"privacyBlocks">;
  readonly subjectId: Id<"users">;
  readonly requestId?: Id<"privacyRequests">;
  readonly scope: PrivacyBlockScope;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly createdBy: Id<"users">;
  readonly createdAt: number;
  readonly reason: string;
  readonly liftedAt?: number;
  readonly liftedBy?: Id<"users">;
  readonly liftReason?: string;
}

function toStoredPrivacyBlock(row: Doc<"privacyBlocks">): StoredPrivacyBlock {
  return {
    id: row._id,
    subjectId: row.subjectId,
    ...(row.requestId === undefined ? {} : { requestId: row.requestId }),
    scope: row.scope,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    reason: row.reason,
    ...(row.liftedAt === undefined ? {} : { liftedAt: row.liftedAt }),
    ...(row.liftedBy === undefined ? {} : { liftedBy: row.liftedBy }),
    ...(row.liftReason === undefined ? {} : { liftReason: row.liftReason }),
  };
}

/** Entrada para registrar un bloqueo temporal con su alcance. */
export interface CreatePrivacyBlockInput {
  readonly subjectId: Id<"users">;
  readonly requestId?: Id<"privacyRequests">;
  readonly scope: PrivacyBlockScope;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly createdBy: Id<"users">;
  readonly createdAt: number;
  readonly reason: string;
}

export type CreatePrivacyBlockResult =
  | {
      readonly status: "created";
      readonly blockId: Id<"privacyBlocks">;
      readonly block: StoredPrivacyBlock;
    }
  | { readonly status: "invalid_reference" }
  | { readonly status: "deadline_mismatch" };

/**
 * Registra un bloqueo temporal de tratamiento sobre un alcance explícito.
 *
 * Si se vincula a una solicitud de bloqueo ya resuelta con
 * `temporaryBlockUntil`, exige que `endsAt` coincida con esa fecha para que
 * la respuesta y el bloqueo operativo no diverjan.
 */
export async function createPrivacyBlock(
  ctx: MutationCtx,
  input: CreatePrivacyBlockInput,
): Promise<CreatePrivacyBlockResult> {
  if (!isPrivacyBlockScope(input.scope)) {
    throw new Error(`Alcance de bloqueo desconocido: ${String(input.scope)}.`);
  }
  assertInstant(input.startsAt, "El inicio del bloqueo requiere un instante epoch válido.");
  assertInstant(input.endsAt, "El término del bloqueo requiere un instante epoch válido.");
  assertInstant(input.createdAt, "La creación del bloqueo requiere un instante epoch válido.");
  if (input.endsAt <= input.startsAt) {
    throw new Error("El término del bloqueo debe ser posterior a su inicio.");
  }
  const reason = assertBoundedText(
    input.reason,
    PRIVACY_CONTROL_REFERENCE_MAX_LENGTH,
    "El motivo de control del bloqueo",
  );

  if (
    (await ctx.db.get(input.subjectId)) === null ||
    (await ctx.db.get(input.createdBy)) === null
  ) {
    return { status: "invalid_reference" };
  }

  if (input.requestId !== undefined) {
    const request = await ctx.db.get(input.requestId);
    if (request === null || request.requesterId !== input.subjectId) {
      return { status: "invalid_reference" };
    }
    if (
      request.kind === "blocking" &&
      request.response?.temporaryBlockUntil !== undefined &&
      input.endsAt !== request.response.temporaryBlockUntil
    ) {
      return { status: "deadline_mismatch" };
    }
  }

  const blockId = await ctx.db.insert("privacyBlocks", {
    subjectId: input.subjectId,
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    scope: input.scope,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    reason,
  });

  const saved = await ctx.db.get(blockId);
  if (saved === null) throw new Error("No se encontró el bloqueo recién insertado.");
  return { status: "created", blockId, block: toStoredPrivacyBlock(saved) };
}

/** Entrada para levantar un bloqueo temporal antes de su vencimiento. */
export interface LiftPrivacyBlockInput {
  readonly blockId: Id<"privacyBlocks">;
  readonly liftedBy: Id<"users">;
  readonly liftedAt: number;
  readonly liftReason: string;
}

export type LiftPrivacyBlockResult =
  | { readonly status: "lifted" | "already_lifted"; readonly blockId: Id<"privacyBlocks"> }
  | { readonly status: "not_found" }
  | { readonly status: "invalid_reference" };

/** Levanta un bloqueo temporal conservando autor, instante y motivo acotado. */
export async function liftPrivacyBlock(
  ctx: MutationCtx,
  input: LiftPrivacyBlockInput,
): Promise<LiftPrivacyBlockResult> {
  assertInstant(input.liftedAt, "El levantamiento del bloqueo requiere un instante epoch válido.");
  const liftReason = assertBoundedText(
    input.liftReason,
    PRIVACY_CONTROL_REFERENCE_MAX_LENGTH,
    "El motivo de levantamiento del bloqueo",
  );

  const block = await ctx.db.get(input.blockId);
  if (block === null) return { status: "not_found" };
  if ((await ctx.db.get(input.liftedBy)) === null) return { status: "invalid_reference" };
  if (block.liftedAt !== undefined) {
    return { status: "already_lifted", blockId: block._id };
  }

  await ctx.db.patch(block._id, {
    liftedAt: input.liftedAt,
    liftedBy: input.liftedBy,
    liftReason,
  });
  return { status: "lifted", blockId: block._id };
}

/**
 * Bloqueos activos de un titular en `now`, resueltos por rango de índice sin
 * `.filter()`.
 */
export async function listActivePrivacyBlocksForSubject(
  ctx: DbReader,
  subjectId: Id<"users">,
  now: number,
  limit = 50,
): Promise<StoredPrivacyBlock[]> {
  assertInstant(now, "La consulta de bloqueos activos requiere un instante epoch válido.");
  const rows = await ctx.db
    .query("privacyBlocks")
    .withIndex("by_subjectId_and_liftedAt_and_endsAt", (q) =>
      q.eq("subjectId", subjectId).eq("liftedAt", undefined).gt("endsAt", now),
    )
    .order("asc")
    .take(limit);
  return rows.map(toStoredPrivacyBlock);
}

/** Bloqueos asociados a una solicitud de privacidad concreta. */
export async function listPrivacyBlocksByRequest(
  ctx: DbReader,
  requestId: Id<"privacyRequests">,
  limit = 20,
): Promise<StoredPrivacyBlock[]> {
  const rows = await ctx.db
    .query("privacyBlocks")
    .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
    .take(limit);
  return rows.map(toStoredPrivacyBlock);
}

/** Página global de bloqueos activos en `now`, ordenados por vencimiento. */
export async function paginateActivePrivacyBlocks(
  ctx: DbReader,
  now: number,
  paginationOpts: PaginationOptions,
) {
  assertInstant(now, "El paginado de bloqueos activos requiere un instante epoch válido.");
  const result = await ctx.db
    .query("privacyBlocks")
    .withIndex("by_liftedAt_and_endsAt", (q) => q.eq("liftedAt", undefined).gt("endsAt", now))
    .order("asc")
    .paginate(paginationOpts);
  return { ...result, page: result.page.map(toStoredPrivacyBlock) };
}

// ---------------------------------------------------------------------------
// Reglas de conservación (`privacyRetentionRules`) y excepciones
// (`privacyRetentionExceptions`)
// ---------------------------------------------------------------------------

/** Regla configurable de conservación por categoría de datos. */
export interface StoredPrivacyRetentionRule {
  readonly id: Id<"privacyRetentionRules">;
  readonly category: PrivacyDataCategory;
  readonly retentionDays?: number;
  readonly disposition: PrivacyRetentionDisposition;
  readonly legalBasisNote?: string;
  readonly updatedBy: Id<"users">;
  readonly updatedAt: number;
}

function toStoredPrivacyRetentionRule(
  row: Doc<"privacyRetentionRules">,
): StoredPrivacyRetentionRule {
  return {
    id: row._id,
    category: row.category,
    ...(row.retentionDays === undefined ? {} : { retentionDays: row.retentionDays }),
    disposition: row.disposition,
    ...(row.legalBasisNote === undefined ? {} : { legalBasisNote: row.legalBasisNote }),
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

/** Entrada para guardar o actualizar la regla de conservación de una categoría. */
export interface UpsertPrivacyRetentionRuleInput {
  readonly category: PrivacyDataCategory;
  readonly retentionDays?: number;
  readonly disposition: PrivacyRetentionDisposition;
  readonly legalBasisNote?: string;
  readonly updatedBy: Id<"users">;
  readonly updatedAt: number;
}

export type UpsertPrivacyRetentionRuleResult =
  | {
      readonly status: "saved";
      readonly ruleId: Id<"privacyRetentionRules">;
      readonly rule: StoredPrivacyRetentionRule;
    }
  | { readonly status: "invalid_reference" };

/**
 * Crea o actualiza la única regla de conservación de una categoría (ADR-0003).
 *
 * No inventa plazos: `retentionDays` puede omitirse mientras la UCT no apruebe
 * una duración concreta.
 */
export async function upsertPrivacyRetentionRule(
  ctx: MutationCtx,
  input: UpsertPrivacyRetentionRuleInput,
): Promise<UpsertPrivacyRetentionRuleResult> {
  if (!isPrivacyDataCategory(input.category)) {
    throw new Error(`Categoría de conservación desconocida: ${String(input.category)}.`);
  }
  if (!isPrivacyRetentionDisposition(input.disposition)) {
    throw new Error(`Disposición de conservación desconocida: ${String(input.disposition)}.`);
  }
  if (input.retentionDays !== undefined && !isValidPrivacyRetentionDays(input.retentionDays)) {
    throw new Error("El plazo de conservación debe ser un entero positivo de días.");
  }
  assertInstant(input.updatedAt, "La regla de conservación requiere un instante epoch válido.");
  const legalBasisNote = assertOptionalBoundedText(
    input.legalBasisNote,
    PRIVACY_CONTROL_REFERENCE_MAX_LENGTH,
    "La referencia normativa de conservación",
  );

  if ((await ctx.db.get(input.updatedBy)) === null) {
    return { status: "invalid_reference" };
  }

  const existing = await ctx.db
    .query("privacyRetentionRules")
    .withIndex("by_category", (q) => q.eq("category", input.category))
    .unique();

  let ruleId: Id<"privacyRetentionRules">;
  if (existing !== null) {
    await ctx.db.patch(existing._id, {
      retentionDays: input.retentionDays,
      disposition: input.disposition,
      legalBasisNote,
      updatedBy: input.updatedBy,
      updatedAt: input.updatedAt,
    });
    ruleId = existing._id;
  } else {
    ruleId = await ctx.db.insert("privacyRetentionRules", {
      category: input.category,
      ...(input.retentionDays === undefined ? {} : { retentionDays: input.retentionDays }),
      disposition: input.disposition,
      ...(legalBasisNote === undefined ? {} : { legalBasisNote }),
      updatedBy: input.updatedBy,
      updatedAt: input.updatedAt,
    });
  }

  const saved = await ctx.db.get(ruleId);
  if (saved === null) throw new Error("No se encontró la regla de conservación guardada.");
  return { status: "saved", ruleId, rule: toStoredPrivacyRetentionRule(saved) };
}

/** Lee la regla de conservación de una categoría, o `null` si no existe. */
export async function readPrivacyRetentionRule(
  ctx: DbReader,
  category: PrivacyDataCategory,
): Promise<StoredPrivacyRetentionRule | null> {
  const row = await ctx.db
    .query("privacyRetentionRules")
    .withIndex("by_category", (q) => q.eq("category", category))
    .unique();
  return row === null ? null : toStoredPrivacyRetentionRule(row);
}

/** Lista las reglas de conservación registradas (acotadas al número de categorías). */
export async function listPrivacyRetentionRules(
  ctx: DbReader,
): Promise<StoredPrivacyRetentionRule[]> {
  const rows = await ctx.db
    .query("privacyRetentionRules")
    .take(PRIVACY_DATA_CATEGORY_VALUES.length);
  return rows.map(toStoredPrivacyRetentionRule);
}

/** Excepción persistida que suspende la eliminación o anonimización. */
export interface StoredPrivacyRetentionException {
  readonly id: Id<"privacyRetentionExceptions">;
  readonly kind: PrivacyRetentionExceptionKind;
  readonly category: PrivacyDataCategory;
  readonly subjectId?: Id<"users">;
  readonly privacyRequestId?: Id<"privacyRequests">;
  readonly reference: string;
  readonly startsAt: number;
  readonly expiresAt?: number;
  readonly liftedAt?: number;
  readonly liftedBy?: Id<"users">;
  readonly liftReason?: string;
  readonly createdBy: Id<"users">;
  readonly createdAt: number;
}

function toStoredPrivacyRetentionException(
  row: Doc<"privacyRetentionExceptions">,
): StoredPrivacyRetentionException {
  return {
    id: row._id,
    kind: row.kind,
    category: row.category,
    ...(row.subjectId === undefined ? {} : { subjectId: row.subjectId }),
    ...(row.privacyRequestId === undefined ? {} : { privacyRequestId: row.privacyRequestId }),
    reference: row.reference,
    startsAt: row.startsAt,
    ...(row.expiresAt === undefined ? {} : { expiresAt: row.expiresAt }),
    ...(row.liftedAt === undefined ? {} : { liftedAt: row.liftedAt }),
    ...(row.liftedBy === undefined ? {} : { liftedBy: row.liftedBy }),
    ...(row.liftReason === undefined ? {} : { liftReason: row.liftReason }),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

/** Entrada para registrar una excepción de conservación. */
export interface CreatePrivacyRetentionExceptionInput {
  readonly kind: PrivacyRetentionExceptionKind;
  readonly category: PrivacyDataCategory;
  readonly subjectId?: Id<"users">;
  readonly privacyRequestId?: Id<"privacyRequests">;
  readonly reference: string;
  readonly startsAt: number;
  readonly expiresAt?: number;
  readonly createdBy: Id<"users">;
  readonly createdAt: number;
}

export type CreatePrivacyRetentionExceptionResult =
  | {
      readonly status: "created";
      readonly exceptionId: Id<"privacyRetentionExceptions">;
      readonly exception: StoredPrivacyRetentionException;
    }
  | { readonly status: "invalid_reference" };

/**
 * Registra una excepción por obligación legal o procedimiento abierto que
 * suspende temporalmente la eliminación o anonimización (ADR-0003).
 */
export async function createPrivacyRetentionException(
  ctx: MutationCtx,
  input: CreatePrivacyRetentionExceptionInput,
): Promise<CreatePrivacyRetentionExceptionResult> {
  if (!isPrivacyRetentionExceptionKind(input.kind)) {
    throw new Error(`Clase de excepción de conservación desconocida: ${String(input.kind)}.`);
  }
  if (!isPrivacyDataCategory(input.category)) {
    throw new Error(`Categoría de conservación desconocida: ${String(input.category)}.`);
  }
  assertInstant(input.startsAt, "El inicio de la excepción requiere un instante epoch válido.");
  assertInstant(input.createdAt, "La creación de la excepción requiere un instante epoch válido.");
  if (input.expiresAt !== undefined) {
    assertInstant(input.expiresAt, "El término de la excepción requiere un instante epoch válido.");
    if (input.expiresAt <= input.startsAt) {
      throw new Error("El término de la excepción debe ser posterior a su inicio.");
    }
  }
  const reference = assertBoundedText(
    input.reference,
    PRIVACY_CONTROL_REFERENCE_MAX_LENGTH,
    "La referencia de la excepción de conservación",
  );

  if ((await ctx.db.get(input.createdBy)) === null) return { status: "invalid_reference" };
  if (input.subjectId !== undefined && (await ctx.db.get(input.subjectId)) === null) {
    return { status: "invalid_reference" };
  }
  if (input.privacyRequestId !== undefined) {
    const request = await ctx.db.get(input.privacyRequestId);
    if (request === null) return { status: "invalid_reference" };
    if (input.subjectId !== undefined && request.requesterId !== input.subjectId) {
      return { status: "invalid_reference" };
    }
  }

  const exceptionId = await ctx.db.insert("privacyRetentionExceptions", {
    kind: input.kind,
    category: input.category,
    ...(input.subjectId === undefined ? {} : { subjectId: input.subjectId }),
    ...(input.privacyRequestId === undefined ? {} : { privacyRequestId: input.privacyRequestId }),
    reference,
    startsAt: input.startsAt,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  });

  const saved = await ctx.db.get(exceptionId);
  if (saved === null) throw new Error("No se encontró la excepción recién insertada.");
  return {
    status: "created",
    exceptionId,
    exception: toStoredPrivacyRetentionException(saved),
  };
}

/** Entrada para levantar una excepción de conservación. */
export interface LiftPrivacyRetentionExceptionInput {
  readonly exceptionId: Id<"privacyRetentionExceptions">;
  readonly liftedBy: Id<"users">;
  readonly liftedAt: number;
  readonly liftReason: string;
}

export type LiftPrivacyRetentionExceptionResult =
  | {
      readonly status: "lifted" | "already_lifted";
      readonly exceptionId: Id<"privacyRetentionExceptions">;
    }
  | { readonly status: "not_found" }
  | { readonly status: "invalid_reference" };

/** Levanta una excepción de conservación conservando autor, fecha y motivo. */
export async function liftPrivacyRetentionException(
  ctx: MutationCtx,
  input: LiftPrivacyRetentionExceptionInput,
): Promise<LiftPrivacyRetentionExceptionResult> {
  assertInstant(input.liftedAt, "El levantamiento de la excepción requiere un instante válido.");
  const liftReason = assertBoundedText(
    input.liftReason,
    PRIVACY_CONTROL_REFERENCE_MAX_LENGTH,
    "El motivo de levantamiento de la excepción",
  );

  const exception = await ctx.db.get(input.exceptionId);
  if (exception === null) return { status: "not_found" };
  if ((await ctx.db.get(input.liftedBy)) === null) return { status: "invalid_reference" };
  if (exception.liftedAt !== undefined) {
    return { status: "already_lifted", exceptionId: exception._id };
  }

  await ctx.db.patch(exception._id, {
    liftedAt: input.liftedAt,
    liftedBy: input.liftedBy,
    liftReason,
  });
  return { status: "lifted", exceptionId: exception._id };
}

/** Excepciones vigentes en `now` para una categoría de datos. */
export async function listActiveRetentionExceptionsForCategory(
  ctx: DbReader,
  category: PrivacyDataCategory,
  now: number,
  limit = 50,
): Promise<StoredPrivacyRetentionException[]> {
  assertInstant(now, "La consulta de excepciones requiere un instante epoch válido.");
  const rows = await ctx.db
    .query("privacyRetentionExceptions")
    .withIndex("by_category_and_liftedAt", (q) =>
      q.eq("category", category).eq("liftedAt", undefined),
    )
    .take(limit);
  return rows
    .filter((row) => isPrivacyRetentionExceptionActive(row, now))
    .map(toStoredPrivacyRetentionException);
}

/** Excepciones vigentes en `now` acotadas a un titular concreto. */
export async function listActiveRetentionExceptionsForSubject(
  ctx: DbReader,
  subjectId: Id<"users">,
  now: number,
  limit = 50,
): Promise<StoredPrivacyRetentionException[]> {
  assertInstant(now, "La consulta de excepciones por titular requiere un instante epoch válido.");
  const rows = await ctx.db
    .query("privacyRetentionExceptions")
    .withIndex("by_subjectId_and_liftedAt", (q) =>
      q.eq("subjectId", subjectId).eq("liftedAt", undefined),
    )
    .take(limit);
  return rows
    .filter((row) => isPrivacyRetentionExceptionActive(row, now))
    .map(toStoredPrivacyRetentionException);
}

/** Excepciones asociadas a una solicitud de privacidad. */
export async function listRetentionExceptionsByPrivacyRequest(
  ctx: DbReader,
  privacyRequestId: Id<"privacyRequests">,
  limit = 20,
): Promise<StoredPrivacyRetentionException[]> {
  const rows = await ctx.db
    .query("privacyRetentionExceptions")
    .withIndex("by_privacyRequestId", (q) => q.eq("privacyRequestId", privacyRequestId))
    .take(limit);
  return rows.map(toStoredPrivacyRetentionException);
}
