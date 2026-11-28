import { AGENDA_TIME_ZONE } from "../../domain/availability/availability";
import {
  canRespondToPrivacyRequest,
  canSubmitPrivacyRequest,
} from "../../domain/authorization/permissions";
import {
  CONFLICT_ERROR_CODE,
  PRIVACY_REQUEST_FIELDS_INVALID_ERROR_CODE,
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import {
  PRIVACY_CONTROL_REFERENCE_MAX_LENGTH,
  type PrivacyResponseDeliveryChannel,
} from "../../domain/privacy/privacy_controls";
import {
  PRIVACY_REQUEST_REASON_MAX_LENGTH,
  SUBMITTABLE_PRIVACY_REQUEST_KINDS,
  type PrivacyRequestKind,
  type PrivacyRequestRejectionCause,
  type PrivacyResponseOutcome,
} from "../../domain/privacy/privacy_request";
import type { PrivacyExtensionRejectionCause } from "../../domain/privacy/privacy_deadlines";
import type {
  PrivacyProfile,
  PrivacyProfileReader,
  PrivacyRequestStore,
  TransitionPrivacyRequestOutcome,
} from "./ports";
import {
  toOwnProjection,
  toReviewProjection,
  type PrivacyRequestOwnProjection,
  type PrivacyRequestReviewProjection,
} from "./projection";

/**
 * Escritura del procedimiento de solicitudes de derechos de privacidad
 * (TI2-167).
 *
 * Capa de Aplicación: coordina por puertos y no toca `ctx.db`. El titular y el
 * responsable salen del perfil vinculado a la sesión, nunca de un
 * identificador del cliente. El Estudiante solo presenta solicitudes propias
 * y por los derechos habilitados en esta entrega; el Administrador es el
 * responsable provisional de revisar, resolver, prorrogar y dejar constancia
 * del envío.
 *
 * La aprobación deja la resolución fundada y habilita el efecto solicitado;
 * la ejecución material sobre los datos reales sigue pendiente de decisión
 * institucional. Una denegación conserva los datos: no elimina ni modifica
 * ningún dato del titular. El reloj entra por dependencia para que las pruebas
 * avancen el tiempo sin depender del reloj del proceso.
 *
 * Opera con datos ficticios.
 */

const SUBMITTABLE_KINDS: ReadonlySet<PrivacyRequestKind> = new Set(
  SUBMITTABLE_PRIVACY_REQUEST_KINDS,
);

/** Mensaje público cuando el derecho todavía no se presenta desde la aplicación. */
export const PRIVACY_REQUEST_KIND_UNAVAILABLE_MESSAGE =
  "El derecho elegido todavía no está disponible en la aplicación.";

/** Dependencias de las escrituras, todas por puerto. */
export interface PrivacyCommandDeps<RequestId extends string, UserId extends string> {
  readonly profiles: PrivacyProfileReader<UserId>;
  readonly requests: PrivacyRequestStore<RequestId, UserId>;
  /** Reloj del servidor; las pruebas lo avanzan. */
  readonly now: () => number;
}

function denied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

function fieldsInvalid<T>(message: string): ApiResult<T> {
  return errResult({ code: PRIVACY_REQUEST_FIELDS_INVALID_ERROR_CODE, message });
}

function conflict<T>(message: string): ApiResult<T> {
  return errResult({ code: CONFLICT_ERROR_CODE, message });
}

function serverReferenceError(): Error {
  return new Error(
    "La solicitud de privacidad recibió una referencia que el servidor ya había resuelto.",
  );
}

/** Perfil vigente del Administrador responsable, o `null` si no lo es. */
async function findResponder<RequestId extends string, UserId extends string>(
  deps: PrivacyCommandDeps<RequestId, UserId>,
  tokenIdentifier: string | null,
): Promise<PrivacyProfile<UserId> | null> {
  const profile = await deps.profiles.findProfile(tokenIdentifier);
  return profile !== null && canRespondToPrivacyRequest(profile) ? profile : null;
}

/** Qué corregir por cada causa de una transición. */
function rejectedTransition<T>(cause: PrivacyRequestRejectionCause): ApiResult<T> {
  switch (cause) {
    case "transition_not_allowed":
      return errResult(conflictError());
    case "reason_required":
      return fieldsInvalid("El motivo es obligatorio para este cambio de estado.");
    case "reason_too_long":
      return fieldsInvalid(
        `El motivo admite hasta ${PRIVACY_REQUEST_REASON_MAX_LENGTH} caracteres.`,
      );
    case "response_required":
      return fieldsInvalid("La respuesta fundada es obligatoria.");
    case "outcome_invalid":
      return fieldsInvalid("El resultado de la respuesta no es válido.");
    case "response_reasons_required":
      return fieldsInvalid("El fundamento de la respuesta es obligatorio.");
    case "response_too_long":
      return fieldsInvalid(
        `El fundamento de la respuesta admite hasta ${PRIVACY_REQUEST_REASON_MAX_LENGTH} caracteres.`,
      );
    case "temporary_block_not_allowed":
      return fieldsInvalid(
        "Solo una solicitud de bloqueo concedida puede indicar un bloqueo temporal.",
      );
    case "temporary_block_required":
      return fieldsInvalid(
        "Una solicitud de bloqueo concedida debe indicar hasta cuándo se mantiene el bloqueo.",
      );
    case "temporary_block_invalid":
      return fieldsInvalid("El bloqueo temporal debe ser un instante posterior a la respuesta.");
    case "response_not_allowed":
    case "responsible_required":
    case "responsible_mismatch":
    case "actor_required":
    case "occurred_at_invalid":
      throw serverReferenceError();
  }
}

function transitionResult<RequestId extends string, UserId extends string>(
  result: TransitionPrivacyRequestOutcome<RequestId, UserId>,
): ApiResult<PrivacyRequestReviewProjection<RequestId, UserId>> {
  switch (result.status) {
    case "applied":
      return okResult(toReviewProjection(result.request));
    case "not_found":
      return denied();
    case "invalid_reference":
      throw serverReferenceError();
    case "rejected":
      return rejectedTransition(result.cause);
  }
}

/**
 * Presenta una solicitud propia desde la aplicación. El servidor fija el
 * instante de recepción, el rol, el canal y el plazo; la respuesta es el acuse
 * de recibo con el vencimiento. Solo el Estudiante puede presentarla y solo
 * por los derechos habilitados.
 */
export async function submitPrivacyRequest<RequestId extends string, UserId extends string>(
  deps: PrivacyCommandDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly kind: PrivacyRequestKind },
): Promise<ApiResult<PrivacyRequestOwnProjection<RequestId>>> {
  const profile = await deps.profiles.findProfile(input.tokenIdentifier);
  if (profile === null || !canSubmitPrivacyRequest(profile)) return denied();
  if (!SUBMITTABLE_KINDS.has(input.kind)) {
    return fieldsInvalid(PRIVACY_REQUEST_KIND_UNAVAILABLE_MESSAGE);
  }

  const result = await deps.requests.create({
    kind: input.kind,
    requesterId: profile._id,
    receivedAt: deps.now(),
    timeZone: AGENDA_TIME_ZONE,
  });
  if (result.status === "invalid_reference") throw serverReferenceError();
  return okResult(toOwnProjection(result.request));
}

/** Toma la solicitud para revisión: `received` pasa a `in_review`. */
export async function startPrivacyRequestReview<RequestId extends string, UserId extends string>(
  deps: PrivacyCommandDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly requestId: RequestId },
): Promise<ApiResult<PrivacyRequestReviewProjection<RequestId, UserId>>> {
  const profile = await findResponder(deps, input.tokenIdentifier);
  if (profile === null) return denied();

  return transitionResult(
    await deps.requests.transition({
      requestId: input.requestId,
      to: "in_review",
      actorId: profile._id,
      occurredAt: deps.now(),
    }),
  );
}

/**
 * Resuelve la solicitud con una respuesta fundada. El actor es también el
 * responsable de la respuesta. Una concesión de bloqueo exige
 * `temporaryBlockUntil`; una denegación no lo lleva y conserva los datos.
 */
export async function resolvePrivacyRequest<RequestId extends string, UserId extends string>(
  deps: PrivacyCommandDeps<RequestId, UserId>,
  input: {
    readonly tokenIdentifier: string | null;
    readonly requestId: RequestId;
    readonly outcome: PrivacyResponseOutcome;
    readonly reasons: string;
    readonly temporaryBlockUntil?: number;
  },
): Promise<ApiResult<PrivacyRequestReviewProjection<RequestId, UserId>>> {
  const profile = await findResponder(deps, input.tokenIdentifier);
  if (profile === null) return denied();

  return transitionResult(
    await deps.requests.transition({
      requestId: input.requestId,
      to: "resolved",
      actorId: profile._id,
      occurredAt: deps.now(),
      response: {
        outcome: input.outcome,
        reasons: input.reasons,
        responsibleId: profile._id,
        ...(input.temporaryBlockUntil === undefined
          ? {}
          : { temporaryBlockUntil: input.temporaryBlockUntil }),
      },
    }),
  );
}

/** Aplica la única prórroga de hasta 30 días corridos, con su motivo. */
export async function extendPrivacyRequestDeadline<RequestId extends string, UserId extends string>(
  deps: PrivacyCommandDeps<RequestId, UserId>,
  input: {
    readonly tokenIdentifier: string | null;
    readonly requestId: RequestId;
    readonly days: number;
    readonly reason: string;
  },
): Promise<ApiResult<PrivacyRequestReviewProjection<RequestId, UserId>>> {
  const profile = await findResponder(deps, input.tokenIdentifier);
  if (profile === null) return denied();

  const reason = input.reason.trim();
  if (reason === "") return fieldsInvalid("El motivo de la prórroga es obligatorio.");
  if (reason.length > PRIVACY_REQUEST_REASON_MAX_LENGTH) {
    return fieldsInvalid(
      `El motivo de la prórroga admite hasta ${PRIVACY_REQUEST_REASON_MAX_LENGTH} caracteres.`,
    );
  }

  const record = await deps.requests.getRequest(input.requestId);
  if (record === null) return denied();
  if (deps.now() >= record.dueAt) {
    return conflict("La prórroga no se puede aplicar con el plazo ya vencido.");
  }

  const result = await deps.requests.extend({
    requestId: input.requestId,
    days: input.days,
    extendedBy: profile._id,
    extendedAt: deps.now(),
    reason,
  });

  switch (result.status) {
    case "applied":
      return okResult(toReviewProjection(result.request));
    case "not_found":
      return denied();
    case "invalid_reference":
      throw serverReferenceError();
    case "rejected":
      return rejectedExtension(result.cause);
  }
}

/** Qué corregir por cada causa de una prórroga. */
function rejectedExtension<T>(
  cause: PrivacyExtensionRejectionCause | "request_closed",
): ApiResult<T> {
  switch (cause) {
    case "extension_not_allowed":
      return conflict("Una solicitud de bloqueo no admite prórroga.");
    case "extension_already_applied":
      return conflict("La solicitud ya tiene su única prórroga.");
    case "extension_days_invalid":
      return fieldsInvalid("La prórroga debe ser un entero entre 1 y 30 días.");
    case "request_closed":
      return conflict("La solicitud ya está cerrada.");
  }
}

/**
 * Registra la constancia inmutable de envío de la respuesta. Calcula el plazo
 * de 30 días hábiles para reclamar ante la Agencia desde el envío, que es el
 * instante en que el titular conoce la decisión. Una solicitud sin resolver o
 * con constancia previa responde `conflict`.
 */
export async function recordPrivacyResponseDelivery<
  RequestId extends string,
  UserId extends string,
>(
  deps: PrivacyCommandDeps<RequestId, UserId>,
  input: {
    readonly tokenIdentifier: string | null;
    readonly requestId: RequestId;
    readonly channel: PrivacyResponseDeliveryChannel;
    readonly reference: string;
  },
): Promise<ApiResult<PrivacyRequestReviewProjection<RequestId, UserId>>> {
  const profile = await findResponder(deps, input.tokenIdentifier);
  if (profile === null) return denied();

  const reference = input.reference.trim();
  if (reference === "") return fieldsInvalid("La referencia de envío es obligatoria.");
  if (reference.length > PRIVACY_CONTROL_REFERENCE_MAX_LENGTH) {
    return fieldsInvalid(
      `La referencia de envío admite hasta ${PRIVACY_CONTROL_REFERENCE_MAX_LENGTH} caracteres.`,
    );
  }

  const record = await deps.requests.getRequest(input.requestId);
  if (record === null) return denied();
  if (record.status !== "resolved" || record.response === undefined) {
    return conflict("La solicitud todavía no está resuelta.");
  }

  const sentAt = deps.now();
  if (sentAt < record.response.respondedAt) {
    return conflict("La constancia de envío no puede ser anterior a la respuesta.");
  }

  const result = await deps.requests.recordDelivery({
    requestId: input.requestId,
    channel: input.channel,
    sentAt,
    recordedBy: profile._id,
    reference,
  });

  switch (result.status) {
    case "recorded": {
      const updated = await deps.requests.getRequest(input.requestId);
      if (updated === null) throw serverReferenceError();
      return okResult(toReviewProjection(updated));
    }
    case "not_found":
      return denied();
    case "invalid_reference":
      throw serverReferenceError();
    case "not_resolved":
      return conflict("La solicitud todavía no está resuelta.");
    case "already_recorded":
      return conflict("La constancia de envío ya está registrada.");
  }
}
