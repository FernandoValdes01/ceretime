import type { Role } from "../../domain/identity/roles";
import type { PrivacyResponseDeliveryChannel } from "../../domain/privacy/privacy_controls";
import type { PrivacyResponseRule } from "../../domain/privacy/privacy_deadlines";
import type {
  PrivacyRequestChannel,
  PrivacyRequestContractVersion,
  PrivacyRequestKind,
  PrivacyRequestStatus,
  PrivacyResponseOutcome,
} from "../../domain/privacy/privacy_request";
import type { PrivacyRequestRecord } from "./ports";

/**
 * Proyecciones públicas de una solicitud de derechos de privacidad (TI2-167).
 *
 * Capa de Aplicación: recorta la fila persistida antes de entregarla. Nunca
 * expone `tokenIdentifier`, identificadores de personal ni campos internos de
 * control. La vista `own` es la del titular y no lleva `requesterId`; la vista
 * `review` es la del Administrador responsable y suma quién presentó la
 * solicitud.
 *
 * `effect` es la consecuencia que el procedimiento reconoce: `authorized`
 * cuando la respuesta concede total o parcialmente y `preserved` cuando
 * deniega. En este prototipo la ejecución material sobre los datos reales
 * sigue pendiente de decisión institucional; una denegación no elimina ni
 * modifica ningún dato del titular.
 */

/** Campos comunes a las dos vistas. */
export interface PrivacyRequestProjectionFields<RequestId extends string> {
  readonly id: RequestId;
  readonly kind: PrivacyRequestKind;
  readonly status: PrivacyRequestStatus;
  readonly channel: PrivacyRequestChannel;
  readonly receivedAt: number;
  readonly receivedDate: string;
  readonly initialDueDate: string;
  readonly initialDueAt: number;
  readonly dueAt: number;
  readonly responseRule: PrivacyResponseRule;
  readonly timeZone: string;
  readonly extension?: {
    readonly days: number;
    readonly extendedUntilDate: string;
    readonly extendedUntilAt: number;
    readonly extendedAt: number;
    readonly reason: string;
  };
  readonly statusReason?: string;
  readonly withdrawnAt?: number;
  readonly response?: {
    readonly outcome: PrivacyResponseOutcome;
    readonly reasons: string;
    readonly respondedAt: number;
    readonly temporaryBlockUntil?: number;
  };
  readonly deliveryReceipt?: {
    readonly channel: PrivacyResponseDeliveryChannel;
    readonly sentAt: number;
    readonly reference: string;
    readonly agencyClaimDueDate: string;
    readonly agencyClaimDueAt: number;
  };
  readonly effect?: "authorized" | "preserved";
  readonly version: PrivacyRequestContractVersion;
}

/** Vista del titular: su propia solicitud, sin identificadores de personal. */
export type PrivacyRequestOwnProjection<RequestId extends string> =
  PrivacyRequestProjectionFields<RequestId> & { readonly view: "own" };

/** Vista del responsable: suma quién presentó la solicitud y quién la atiende. */
export type PrivacyRequestReviewProjection<
  RequestId extends string,
  UserId extends string,
> = PrivacyRequestProjectionFields<RequestId> & {
  readonly view: "review";
  readonly requesterId: UserId;
  readonly requesterRole: Role;
  readonly responsibleId?: UserId;
};

function toFields<RequestId extends string, UserId extends string>(
  record: PrivacyRequestRecord<RequestId, UserId>,
): PrivacyRequestProjectionFields<RequestId> {
  const effect =
    record.response === undefined
      ? undefined
      : record.response.outcome === "denied"
        ? ("preserved" as const)
        : ("authorized" as const);
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    channel: record.channel,
    receivedAt: record.receivedAt,
    receivedDate: record.receivedDate,
    initialDueDate: record.initialDueDate,
    initialDueAt: record.initialDueAt,
    dueAt: record.dueAt,
    responseRule: record.responseRule,
    timeZone: record.deadlineTimeZone,
    ...(record.extension === undefined
      ? {}
      : {
          extension: {
            days: record.extension.days,
            extendedUntilDate: record.extension.extendedUntilDate,
            extendedUntilAt: record.extension.extendedUntilAt,
            extendedAt: record.extension.extendedAt,
            reason: record.extension.reason,
          },
        }),
    ...(record.statusReason === undefined ? {} : { statusReason: record.statusReason }),
    ...(record.withdrawnAt === undefined ? {} : { withdrawnAt: record.withdrawnAt }),
    ...(record.response === undefined
      ? {}
      : {
          response: {
            outcome: record.response.outcome,
            reasons: record.response.reasons,
            respondedAt: record.response.respondedAt,
            ...(record.response.temporaryBlockUntil === undefined
              ? {}
              : { temporaryBlockUntil: record.response.temporaryBlockUntil }),
          },
        }),
    ...(record.deliveryReceipt === undefined
      ? {}
      : {
          deliveryReceipt: {
            channel: record.deliveryReceipt.channel,
            sentAt: record.deliveryReceipt.sentAt,
            reference: record.deliveryReceipt.reference,
            agencyClaimDueDate: record.deliveryReceipt.agencyClaimDueDate,
            agencyClaimDueAt: record.deliveryReceipt.agencyClaimDueAt,
          },
        }),
    ...(effect === undefined ? {} : { effect }),
    version: record.version,
  };
}

/** Proyección del titular. */
export function toOwnProjection<RequestId extends string, UserId extends string>(
  record: PrivacyRequestRecord<RequestId, UserId>,
): PrivacyRequestOwnProjection<RequestId> {
  return { ...toFields(record), view: "own" };
}

/** Proyección del responsable, con la identidad de quien presentó la solicitud. */
export function toReviewProjection<RequestId extends string, UserId extends string>(
  record: PrivacyRequestRecord<RequestId, UserId>,
): PrivacyRequestReviewProjection<RequestId, UserId> {
  return {
    ...toFields(record),
    view: "review",
    requesterId: record.requesterId,
    requesterRole: record.requesterRole,
    ...(record.responsibleId === undefined ? {} : { responsibleId: record.responsibleId }),
  };
}
