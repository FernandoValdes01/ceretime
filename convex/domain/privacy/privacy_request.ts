/**
 * Solicitud de privacidad: tipos, estados, transiciones, responsable, canal y
 * respuesta fundada (TI2-136).
 *
 * Dominio puro: no importa Convex, React ni Expo. Modela el procedimiento de
 * prueba acordado para ejercer los derechos de la Ley 21.719; las decisiones
 * que todavía dependen de la UCT se enumeran en
 * `PENDING_INSTITUTIONAL_DECISIONS` y en `docs/privacidad-procedimiento.md`.
 * La persistencia, los casos de uso y las pantallas quedan fuera de esta
 * entrega.
 */

import { isUsableInstant } from "../calendar/civil_days";
import type { Role } from "../identity/roles";

/** Versión del contrato público de la solicitud de privacidad. */
export const PRIVACY_REQUEST_CONTRACT_VERSION = "v1" as const;

export type PrivacyRequestContractVersion = typeof PRIVACY_REQUEST_CONTRACT_VERSION;

/**
 * Derechos que el titular puede ejercer. Los literales son los valores que
 * persistirá la tabla de solicitudes cuando exista (TI2-151); no se traducen
 * ni se renombran en Web o Mobile.
 */
export const PRIVACY_REQUEST_KIND_VALUES = [
  "access",
  "rectification",
  "erasure",
  "objection",
  "blocking",
  "portability",
] as const;

export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_KIND_VALUES)[number];

/** Etiqueta en español de cada derecho, para que todos los canales usen el mismo lenguaje. */
export const PRIVACY_REQUEST_KIND_LABELS: Record<PrivacyRequestKind, string> = {
  access: "Acceso",
  rectification: "Rectificación",
  erasure: "Supresión",
  objection: "Oposición",
  blocking: "Bloqueo",
  portability: "Portabilidad",
};

/**
 * Derechos que esta entrega acepta por la aplicación, en el orden en que se
 * ofrecen. Bloqueo y oposición son la siguiente tarea del módulo (TI2-168).
 * Es la única lista: el caso de uso rechaza los demás y la Web solo ofrece
 * estos, así no se ofrece un derecho que el Backend no recibe.
 */
export const SUBMITTABLE_PRIVACY_REQUEST_KINDS = [
  "access",
  "rectification",
  "erasure",
  "portability",
] as const satisfies readonly PrivacyRequestKind[];

/** Verdadero cuando el valor es un derecho conocido. */
export function isPrivacyRequestKind(value: string): value is PrivacyRequestKind {
  return (PRIVACY_REQUEST_KIND_VALUES as readonly string[]).includes(value);
}

/**
 * Estados del procedimiento de prueba, en orden de flujo. `resolved` y
 * `withdrawn` son terminales: una solicitud resuelta no se reabre y una
 * retirada no se revive. El vencimiento del plazo no es un estado: se deriva
 * al comparar el instante de respuesta con el plazo calculado, porque el
 * procedimiento no cambia por el solo paso del tiempo.
 */
export const PRIVACY_REQUEST_STATUS_VALUES = [
  "received",
  "in_review",
  "awaiting_information",
  "resolved",
  "withdrawn",
] as const;

export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUS_VALUES)[number];

/** Toda solicitud nace recibida; la revisión es el primer paso del responsable. */
export const INITIAL_PRIVACY_REQUEST_STATUS: PrivacyRequestStatus = "received";

/** Estados que cierran el procedimiento y no admiten salida. */
export const TERMINAL_PRIVACY_REQUEST_STATUSES = ["resolved", "withdrawn"] as const;

export type TerminalPrivacyRequestStatus = (typeof TERMINAL_PRIVACY_REQUEST_STATUSES)[number];

/** Etiqueta en español de cada estado. */
export const PRIVACY_REQUEST_STATUS_LABELS: Record<PrivacyRequestStatus, string> = {
  received: "Recibida",
  in_review: "En revisión",
  awaiting_information: "Esperando información del titular",
  resolved: "Resuelta",
  withdrawn: "Retirada por el titular",
};

/** Verdadero cuando el valor es un estado conocido. */
export function isPrivacyRequestStatus(value: string): value is PrivacyRequestStatus {
  return (PRIVACY_REQUEST_STATUS_VALUES as readonly string[]).includes(value);
}

/** Verdadero cuando el estado no admite más transiciones. */
export function isTerminalPrivacyRequestStatus(
  status: PrivacyRequestStatus,
): status is TerminalPrivacyRequestStatus {
  return (TERMINAL_PRIVACY_REQUEST_STATUSES as readonly string[]).includes(status);
}

/**
 * Canal por el que se recibe la solicitud. El Estudiante usa la aplicación;
 * los demás roles titulares de datos (Profesional, Practicante y
 * Administrador) usan el canal institucional, porque la aplicación no expone
 * un formulario de privacidad para ellos. La dirección y el procedimiento de
 * ese canal dependen de una decisión institucional.
 */
export const PRIVACY_REQUEST_CHANNEL_VALUES = ["student_app", "institutional_channel"] as const;

export type PrivacyRequestChannel = (typeof PRIVACY_REQUEST_CHANNEL_VALUES)[number];

/** Canal autorizado para el rol: solo el Estudiante entra por la aplicación. */
export function privacyRequestChannelForRole(role: Role): PrivacyRequestChannel {
  return role === "student" ? "student_app" : "institutional_channel";
}

/**
 * Solicitud de privacidad con identificadores genéricos, sin persistencia.
 *
 * `requesterRole` es el rol vigente al presentar la solicitud y `channel` sale
 * de `privacyRequestChannelForRole`; no se aceptan desde el cliente en la
 * futura capa de Aplicación. La respuesta fundada y el historial no viven acá:
 * se agregan como entradas de estado para no sobrescribir la decisión.
 */
export interface PrivacyRequest {
  readonly id: string;
  readonly kind: PrivacyRequestKind;
  readonly status: PrivacyRequestStatus;
  readonly requesterId: string;
  readonly requesterRole: Role;
  readonly channel: PrivacyRequestChannel;
  readonly receivedAt: number;
  readonly version: PrivacyRequestContractVersion;
}

/** Responsable legal del tratamiento según el análisis de la Ley 21.719. */
export const PRIVACY_DATA_CONTROLLER = "uct" as const;

export type PrivacyDataController = typeof PRIVACY_DATA_CONTROLLER;

/**
 * Responsable operativo de resolver la solicitud. Es una decisión provisional
 * del procedimiento de prueba: hoy responde el Administrador y la UCT debe
 * designar al responsable institucional definitivo. No se crea un rol nuevo
 * hasta que esa designación exista.
 */
export const PRIVACY_REQUEST_RESPONSIBLE_ROLE_VALUES = ["admin"] as const;

export type PrivacyRequestResponsibleRole =
  (typeof PRIVACY_REQUEST_RESPONSIBLE_ROLE_VALUES)[number];

/** Verdadero cuando el rol puede responder una solicitud de privacidad. */
export function isPrivacyRequestResponsibleRole(role: Role): role is PrivacyRequestResponsibleRole {
  return (PRIVACY_REQUEST_RESPONSIBLE_ROLE_VALUES as readonly string[]).includes(role);
}

/**
 * Decisiones que el procedimiento de prueba no puede tomar por sí solo. Se
 * exponen en el dominio y en el documento para que no se presenten como
 * política aprobada por la UCT.
 */
export const PENDING_INSTITUTIONAL_DECISIONS = [
  "designar al responsable institucional de privacidad y su reemplazo",
  "definir la dirección y el procedimiento del canal institucional para roles que no son estudiantes",
  "validar jurídicamente la fundamentación y el texto de la respuesta",
  "confirmar el cómputo de los plazos, el día de recepción que se cuenta y los feriados aplicables",
  "definir cómo se ejecutan el bloqueo, la supresión y la portabilidad sobre los datos reales",
] as const;

export type PendingInstitutionalDecision = (typeof PENDING_INSTITUTIONAL_DECISIONS)[number];

/** Resultado de la respuesta fundada. */
export const PRIVACY_RESPONSE_OUTCOME_VALUES = ["granted", "partially_granted", "denied"] as const;

export type PrivacyResponseOutcome = (typeof PRIVACY_RESPONSE_OUTCOME_VALUES)[number];

/** Etiqueta en español de cada resultado, para que todos los canales usen el mismo lenguaje. */
export const PRIVACY_RESPONSE_OUTCOME_LABELS: Record<PrivacyResponseOutcome, string> = {
  granted: "Concedida",
  partially_granted: "Concedida en parte",
  denied: "Denegada",
};

/** Verdadero cuando el valor es un resultado de respuesta conocido. */
export function isPrivacyResponseOutcome(value: string): value is PrivacyResponseOutcome {
  return (PRIVACY_RESPONSE_OUTCOME_VALUES as readonly string[]).includes(value);
}

/** Límite del texto libre de la fundamentación y del motivo de estado. */
export const PRIVACY_REQUEST_REASON_MAX_LENGTH = 2000;

/**
 * Respuesta fundada de la solicitud. `reasons` explica la decisión en palabras
 * que el titular puede entender; no es una nota interna ni un texto jurídico
 * reservado. `responsibleId` sale de la sesión autenticada en Aplicación,
 * nunca de un parámetro del cliente.
 */
export interface PrivacyResponseInput {
  readonly outcome: PrivacyResponseOutcome;
  readonly reasons: string;
  readonly responsibleId: string;
  /**
   * Obligatorio en una solicitud de bloqueo concedida, total o parcialmente:
   * instante epoch en milisegundos hasta el que se mantiene el bloqueo. Un
   * bloqueo denegado no lo lleva y otro derecho tampoco.
   */
  readonly temporaryBlockUntil?: number;
}

/** Respuesta registrada con el instante del servidor que la emitió. */
export interface PrivacyRequestResponse extends PrivacyResponseInput {
  readonly respondedAt: number;
}

/** Transición declarada del procedimiento. */
export interface PrivacyRequestTransition {
  readonly from: PrivacyRequestStatus;
  readonly to: PrivacyRequestStatus;
  /** Exige motivo: retirar o pedir información necesita explicación. */
  readonly requiresReason: boolean;
  /** Exige respuesta fundada: solo el cierre con decisión la lleva. */
  readonly requiresResponse: boolean;
}

/**
 * Tabla única de transiciones válidas. Cualquier par ausente es inválido,
 * incluidos los saltos, los retrocesos fuera de `awaiting_information` y las
 * salidas desde estados terminales. Pedir información se registra como
 * transición a `awaiting_information`; recibirla vuelve a `in_review`.
 */
export const PRIVACY_REQUEST_TRANSITIONS = [
  { from: "received", to: "in_review", requiresReason: false, requiresResponse: false },
  {
    from: "in_review",
    to: "awaiting_information",
    requiresReason: true,
    requiresResponse: false,
  },
  {
    from: "awaiting_information",
    to: "in_review",
    requiresReason: true,
    requiresResponse: false,
  },
  { from: "in_review", to: "resolved", requiresReason: false, requiresResponse: true },
  { from: "received", to: "withdrawn", requiresReason: true, requiresResponse: false },
  { from: "in_review", to: "withdrawn", requiresReason: true, requiresResponse: false },
  {
    from: "awaiting_information",
    to: "withdrawn",
    requiresReason: true,
    requiresResponse: false,
  },
] as const satisfies readonly PrivacyRequestTransition[];

/** Búsqueda exacta en la tabla: un par ausente es una transición inválida. */
export function findPrivacyRequestTransition(
  from: PrivacyRequestStatus,
  to: PrivacyRequestStatus,
): PrivacyRequestTransition | undefined {
  return PRIVACY_REQUEST_TRANSITIONS.find(
    (transition) => transition.from === from && transition.to === to,
  );
}

/** Intento de cambio de estado. `kind` permite aplicar reglas propias del bloqueo. */
export interface PrivacyRequestTransitionAttempt {
  readonly kind: PrivacyRequestKind;
  readonly from: PrivacyRequestStatus;
  readonly to: PrivacyRequestStatus;
  readonly actorId: string;
  readonly occurredAt: number;
  readonly reason?: string;
  readonly response?: PrivacyResponseInput;
}

/**
 * Entrada del historial de estados: se agrega, no se edita ni se borra. La
 * respuesta fundada viaja con la transición que resuelve la solicitud.
 */
export interface PrivacyRequestStateChange {
  readonly from: PrivacyRequestStatus;
  readonly to: PrivacyRequestStatus;
  readonly actorId: string;
  readonly occurredAt: number;
  readonly reason?: string;
  readonly response?: PrivacyRequestResponse;
}

/** Causas de rechazo, devueltas como valor y no como excepción. */
export const PRIVACY_REQUEST_REJECTION_CAUSES = [
  "transition_not_allowed",
  "actor_required",
  "occurred_at_invalid",
  "reason_required",
  "reason_too_long",
  "response_required",
  "response_not_allowed",
  "outcome_invalid",
  "responsible_required",
  "responsible_mismatch",
  "response_reasons_required",
  "response_too_long",
  "temporary_block_not_allowed",
  "temporary_block_required",
  "temporary_block_invalid",
] as const;

export type PrivacyRequestRejectionCause = (typeof PRIVACY_REQUEST_REJECTION_CAUSES)[number];

export type PrivacyRequestTransitionResult =
  | { readonly status: "applied"; readonly change: PrivacyRequestStateChange }
  | { readonly status: "rejected"; readonly cause: PrivacyRequestRejectionCause };

function normalizedText(value: string | undefined): string {
  return value?.trim() ?? "";
}

function rejected(cause: PrivacyRequestRejectionCause): PrivacyRequestTransitionResult {
  return { status: "rejected", cause };
}

/**
 * Valida la respuesta fundada y la normaliza con el instante del cambio.
 *
 * Devuelve la respuesta lista para el historial o la causa del rechazo. El
 * bloqueo temporal solo existe en una solicitud de bloqueo: la concesión
 * total o parcial lo exige y la denegación no lo lleva. Quien firma la
 * respuesta debe ser el mismo actor que ejecuta la transición para que el
 * historial no atribuya una decisión a otra persona.
 */
function resolveResponse(
  attempt: PrivacyRequestTransitionAttempt,
): PrivacyRequestResponse | PrivacyRequestRejectionCause {
  const response = attempt.response;
  if (response === undefined) return "response_required";
  if (!isPrivacyResponseOutcome(response.outcome)) return "outcome_invalid";

  const responsibleId = normalizedText(response.responsibleId);
  if (responsibleId === "") return "responsible_required";
  if (responsibleId !== normalizedText(attempt.actorId)) return "responsible_mismatch";

  const reasons = normalizedText(response.reasons);
  if (reasons === "") return "response_reasons_required";
  if (reasons.length > PRIVACY_REQUEST_REASON_MAX_LENGTH) return "response_too_long";

  const hasTemporaryBlock = response.temporaryBlockUntil !== undefined;
  if (attempt.kind !== "blocking") {
    if (hasTemporaryBlock) return "temporary_block_not_allowed";
  } else {
    if (response.outcome === "denied" && hasTemporaryBlock) {
      return "temporary_block_not_allowed";
    }
    if (
      (response.outcome === "granted" || response.outcome === "partially_granted") &&
      !hasTemporaryBlock
    ) {
      return "temporary_block_required";
    }
  }

  if (
    hasTemporaryBlock &&
    (!isUsableInstant(response.temporaryBlockUntil ?? 0) ||
      (response.temporaryBlockUntil ?? 0) <= attempt.occurredAt)
  ) {
    return "temporary_block_invalid";
  }

  return {
    outcome: response.outcome,
    reasons,
    responsibleId,
    respondedAt: attempt.occurredAt,
    ...(hasTemporaryBlock ? { temporaryBlockUntil: response.temporaryBlockUntil } : {}),
  };
}

/**
 * Aplica la política de transición de una solicitud de privacidad.
 *
 * Dominio puro: no persiste ni muta nada. Un rechazo no construye `change`, así
 * que el intento inválido no deja entrada en el historial. El motivo y la
 * respuesta se normalizan; las causas se evalúan de la más general a la más
 * específica.
 */
export function transitionPrivacyRequest(
  attempt: PrivacyRequestTransitionAttempt,
): PrivacyRequestTransitionResult {
  const transition = findPrivacyRequestTransition(attempt.from, attempt.to);
  if (transition === undefined) return rejected("transition_not_allowed");

  const actorId = normalizedText(attempt.actorId);
  if (actorId === "") return rejected("actor_required");
  if (!isUsableInstant(attempt.occurredAt)) return rejected("occurred_at_invalid");

  const reason = normalizedText(attempt.reason);
  if (transition.requiresReason && reason === "") return rejected("reason_required");
  if (reason.length > PRIVACY_REQUEST_REASON_MAX_LENGTH) return rejected("reason_too_long");

  const changeBase = {
    from: transition.from,
    to: transition.to,
    actorId,
    occurredAt: attempt.occurredAt,
    ...(reason === "" ? {} : { reason }),
  };

  if (!transition.requiresResponse) {
    if (attempt.response !== undefined) return rejected("response_not_allowed");
    return { status: "applied", change: changeBase };
  }

  const response = resolveResponse(attempt);
  if (typeof response === "string") return rejected(response);

  return { status: "applied", change: { ...changeBase, response } };
}
