import type { PaginationOptions, PaginationResult } from "convex/server";
import type { AccountStatus, InstitutionalStatus, Role } from "../../domain/identity/roles";
import type { PrivacyResponseDeliveryChannel } from "../../domain/privacy/privacy_controls";
import type {
  PrivacyExtensionRejectionCause,
  PrivacyResponseRule,
} from "../../domain/privacy/privacy_deadlines";
import type {
  PrivacyRequestChannel,
  PrivacyRequestContractVersion,
  PrivacyRequestKind,
  PrivacyRequestRejectionCause,
  PrivacyRequestStatus,
  PrivacyResponseOutcome,
} from "../../domain/privacy/privacy_request";

/**
 * Puertos de las solicitudes de derechos de privacidad (TI2-167).
 *
 * Capa de Aplicación: fija lo que los casos de uso leen y escriben, sin Convex.
 * Infraestructura los cumple por forma con `privacyProfileReader(ctx)`,
 * `privacyRequestReader(ctx)` y `privacyRequestStore(ctx)`, creados en
 * Presentación con el mismo `ctx`, así cada operación ocurre en una sola
 * transacción. Las pruebas pasan dobles en memoria.
 *
 * Los identificadores son genéricos: Presentación los instancia con los `Id`
 * de Convex y el caso de uso los compara y los devuelve sin convertirlos. La
 * paginación usa solo `PaginationOptions` y `PaginationResult`, sin su
 * contexto, para que las opciones del cliente lleguen al índice sin rearmarse.
 */

/** Perfil vinculado a la sesión. La vigencia la decide Dominio, no el puerto. */
export interface PrivacyProfile<UserId extends string> {
  readonly _id: UserId;
  readonly role: Role;
  readonly institutionalStatus: InstitutionalStatus;
  readonly accountStatus: AccountStatus;
}

/** Perfil de quien llama, o `null` sin identidad o sin perfil vinculado. */
export interface PrivacyProfileReader<UserId extends string> {
  findProfile(tokenIdentifier: string | null): Promise<PrivacyProfile<UserId> | null>;
}

/** Prórroga persistida de una solicitud. */
export interface PrivacyRequestExtensionRecord<UserId extends string> {
  readonly days: number;
  readonly extendedUntilDate: string;
  readonly extendedUntilAt: number;
  readonly extendedAt: number;
  readonly extendedBy: UserId;
  readonly reason: string;
}

/** Respuesta fundada persistida; `responsibleId` es el perfil de la sesión. */
export interface PrivacyRequestResponseRecord<UserId extends string> {
  readonly outcome: PrivacyResponseOutcome;
  readonly reasons: string;
  readonly responsibleId: UserId;
  readonly respondedAt: number;
  readonly temporaryBlockUntil?: number;
}

/** Constancia inmutable de envío de la respuesta. */
export interface PrivacyResponseDeliveryRecord<UserId extends string> {
  readonly channel: PrivacyResponseDeliveryChannel;
  readonly sentAt: number;
  readonly recordedBy: UserId;
  readonly reference: string;
  readonly agencyClaimDueDate: string;
  readonly agencyClaimDueAt: number;
}

/** Solicitud persistida con lo que necesitan las lecturas y los casos de uso. */
export interface PrivacyRequestRecord<RequestId extends string, UserId extends string> {
  readonly id: RequestId;
  readonly kind: PrivacyRequestKind;
  readonly status: PrivacyRequestStatus;
  readonly requesterId: UserId;
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
  readonly responsibleId?: UserId;
  readonly extension?: PrivacyRequestExtensionRecord<UserId>;
  readonly statusReason?: string;
  readonly withdrawnAt?: number;
  readonly response?: PrivacyRequestResponseRecord<UserId>;
  readonly deliveryReceipt?: PrivacyResponseDeliveryRecord<UserId>;
  readonly updatedAt: number;
}

/** Lecturas de solicitudes. Ninguna autoriza: eso ocurre antes de llamarlas. */
export interface PrivacyRequestReader<RequestId extends string, UserId extends string> {
  getRequest(requestId: RequestId): Promise<PrivacyRequestRecord<RequestId, UserId> | null>;
  listByRequester(
    requesterId: UserId,
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<PrivacyRequestRecord<RequestId, UserId>>>;
  listByStatus(
    status: PrivacyRequestStatus,
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<PrivacyRequestRecord<RequestId, UserId>>>;
  listByDeadline(
    paginationOpts: PaginationOptions,
    options?: { readonly dueBefore?: number },
  ): Promise<PaginationResult<PrivacyRequestRecord<RequestId, UserId>>>;
}

/** Resultado de registrar una solicitud. */
export type CreatePrivacyRequestOutcome<RequestId extends string, UserId extends string> =
  | { readonly status: "created"; readonly request: PrivacyRequestRecord<RequestId, UserId> }
  | { readonly status: "invalid_reference" };

/** Resultado de aplicar una transición del procedimiento. */
export type TransitionPrivacyRequestOutcome<RequestId extends string, UserId extends string> =
  | { readonly status: "applied"; readonly request: PrivacyRequestRecord<RequestId, UserId> }
  | { readonly status: "not_found" }
  | { readonly status: "invalid_reference" }
  | { readonly status: "rejected"; readonly cause: PrivacyRequestRejectionCause };

/** Resultado de aplicar la prórroga única. */
export type ExtendPrivacyRequestOutcome<RequestId extends string, UserId extends string> =
  | { readonly status: "applied"; readonly request: PrivacyRequestRecord<RequestId, UserId> }
  | { readonly status: "not_found" }
  | { readonly status: "invalid_reference" }
  | {
      readonly status: "rejected";
      readonly cause: PrivacyExtensionRejectionCause | "request_closed";
    };

/** Resultado de registrar la constancia de envío. */
export type RecordPrivacyResponseDeliveryOutcome<UserId extends string> =
  | { readonly status: "recorded"; readonly receipt: PrivacyResponseDeliveryRecord<UserId> }
  | { readonly status: "not_found" }
  | { readonly status: "invalid_reference" }
  | { readonly status: "not_resolved" }
  | { readonly status: "already_recorded" };

/** Entrada del registro de una solicitud; el canal lo deriva Infraestructura. */
export interface CreatePrivacyRequestCommand<UserId extends string> {
  readonly kind: PrivacyRequestKind;
  readonly requesterId: UserId;
  readonly receivedAt: number;
  readonly timeZone: string;
  readonly holidays?: readonly string[];
}

/** Entrada de una transición; el actor y el responsable salen de la sesión. */
export interface TransitionPrivacyRequestCommand<RequestId extends string, UserId extends string> {
  readonly requestId: RequestId;
  readonly to: PrivacyRequestStatus;
  readonly actorId: UserId;
  readonly occurredAt: number;
  readonly reason?: string;
  readonly response?: {
    readonly outcome: PrivacyResponseOutcome;
    readonly reasons: string;
    readonly responsibleId: UserId;
    readonly temporaryBlockUntil?: number;
  };
}

/** Entrada de la prórroga; el autor sale de la sesión. */
export interface ExtendPrivacyRequestCommand<RequestId extends string, UserId extends string> {
  readonly requestId: RequestId;
  readonly days: number;
  readonly extendedBy: UserId;
  readonly extendedAt: number;
  readonly reason: string;
}

/** Entrada de la constancia de envío; quien registra sale de la sesión. */
export interface RecordPrivacyResponseDeliveryCommand<
  RequestId extends string,
  UserId extends string,
> {
  readonly requestId: RequestId;
  readonly channel: PrivacyResponseDeliveryChannel;
  readonly sentAt: number;
  readonly recordedBy: UserId;
  readonly reference: string;
}

/** Escritura de solicitudes, con las lecturas que necesita la misma operación. */
export interface PrivacyRequestStore<
  RequestId extends string,
  UserId extends string,
> extends PrivacyRequestReader<RequestId, UserId> {
  create(
    input: CreatePrivacyRequestCommand<UserId>,
  ): Promise<CreatePrivacyRequestOutcome<RequestId, UserId>>;
  transition(
    input: TransitionPrivacyRequestCommand<RequestId, UserId>,
  ): Promise<TransitionPrivacyRequestOutcome<RequestId, UserId>>;
  extend(
    input: ExtendPrivacyRequestCommand<RequestId, UserId>,
  ): Promise<ExtendPrivacyRequestOutcome<RequestId, UserId>>;
  recordDelivery(
    input: RecordPrivacyResponseDeliveryCommand<RequestId, UserId>,
  ): Promise<RecordPrivacyResponseDeliveryOutcome<UserId>>;
}
