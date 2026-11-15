import type { PaginationOptions, PaginationResult } from "convex/server";
import type { AccompanimentRow } from "../../domain/accompaniments/accompaniment";
import type { PersistableRequestState } from "../../domain/requests/state";
import type { RequestSubmission } from "../../domain/requests/request";
import type { RequestStatusChange } from "../../domain/requests/transitions";

/**
 * Puertos de los casos de uso de solicitudes (TI2-141, TI2-181).
 *
 * Capa de Aplicación: fija lo que un caso de uso lee y escribe, sin Convex.
 * Infraestructura los cumple por forma con `requestStore(ctx)`,
 * `requestReader(ctx)`, `activeStudentReader(ctx)`,
 * `activeProfessionalReader(ctx)`, `activeRequestViewerReader(ctx)` y
 * `accompanimentOpener(ctx)`, creados en Presentación con el mismo `ctx`, así
 * cada operación ocurre en una sola transacción. Las pruebas pasan dobles en
 * memoria.
 *
 * Los identificadores son genéricos: Presentación los instancia con los `Id`
 * de Convex y el caso de uso los compara y los devuelve sin convertirlos. La
 * paginación usa solo los tipos `PaginationOptions` y `PaginationResult` de
 * Convex, sin su contexto: así las opciones del cliente, incluido `endCursor`,
 * llegan al índice sin que Aplicación las rearme.
 */

/** Estudiante con cuenta habilitada y vigente; si no, `null`. */
export interface ActiveStudentReader<UserId extends string> {
  findActiveStudent(tokenIdentifier: string | null): Promise<{ readonly _id: UserId } | null>;
}

/** Profesional con cuenta habilitada y vigente; si no, `null`. */
export interface ActiveProfessionalReader<UserId extends string> {
  findActiveProfessional(tokenIdentifier: string | null): Promise<{ readonly _id: UserId } | null>;
}

/** Lo que el caso de uso necesita de una solicitud guardada. */
export type StoredRequestRow<RequestId extends string, UserId extends string> = {
  readonly _id: RequestId;
  readonly studentId: UserId;
  readonly status: PersistableRequestState;
  readonly accessNeeds: string;
  readonly createdAt: number;
  /** Razón vigente del cierre sin acompañamiento; solo la entrega el detalle. */
  readonly closureReason?: string;
};

/** Solicitud por id, o `null` si no existe. */
export interface RequestReader<RequestId extends string, UserId extends string> {
  getRequest(requestId: RequestId): Promise<StoredRequestRow<RequestId, UserId> | null>;
}

/** Escribe el estado vigente con el cambio que dejó la política. */
export interface RequestStatusWriter<RequestId extends string> {
  setRequestStatus(requestId: RequestId, change: RequestStatusChange): Promise<void>;
}

/** Registra el cambio de estado con motivo, actor y fecha. */
export interface RequestTransitionRecorder<RequestId extends string, UserId extends string> {
  logRequestTransition(entry: {
    readonly requestId: RequestId;
    readonly from: PersistableRequestState;
    readonly to: PersistableRequestState;
    readonly actorId: UserId;
    readonly reason?: string;
    readonly occurredAt: number;
  }): Promise<void>;
}

/** Si el Profesional tiene una toma activa de la solicitud. */
export interface RequestTakeReader<RequestId extends string, UserId extends string> {
  hasActiveTake(requestId: RequestId, userId: UserId): Promise<boolean>;
}

/** Crea la toma activa del Profesional y marca la solicitud como tomada por él. */
export interface RequestTakeRecorder<RequestId extends string, UserId extends string> {
  recordTake(requestId: RequestId, professionalId: UserId): Promise<void>;
}

/**
 * Abre el acompañamiento de una solicitud aceptada (TI2-24) con la asignación
 * inicial de quien acepta, y lo devuelve leído de vuelta.
 * `hasAccompanimentForRequest` comprueba la unicidad en la misma mutation que
 * la apertura.
 */
export interface AccompanimentOpener<
  RequestId extends string,
  UserId extends string,
  AccompanimentId extends string,
> {
  hasAccompanimentForRequest(requestId: RequestId): Promise<boolean>;
  openAccompaniment(input: {
    readonly requestId: RequestId;
    readonly studentId: UserId;
    readonly objective: string;
    readonly accessNeeds: string;
    readonly professionalId: UserId;
  }): Promise<AccompanimentRow<AccompanimentId, UserId>>;
}

/**
 * Guarda una solicitud recibida del Estudiante. `registerOnce` guarda el envío
 * completo ya validado una sola vez por clave de idempotencia y, con una clave
 * repetida, devuelve la solicitud existente sin escribir. `registerLegacy`
 * guarda la forma anterior, solo con el texto de necesidades de acceso.
 */
export interface RequestRegistrar<RequestId extends string, UserId extends string> {
  registerOnce(
    studentId: UserId,
    submission: RequestSubmission,
    receivedAt: number,
  ): Promise<RequestId>;
  registerLegacy(studentId: UserId, accessNeeds: string): Promise<RequestId>;
}

/**
 * Perfil vigente de quien llama con un rol que lee solicitudes: Estudiante o
 * Profesional. Cualquier otro rol, o una cuenta no vigente, es `null`.
 */
export interface ActiveRequestViewerReader<UserId extends string> {
  findActiveViewer(tokenIdentifier: string | null): Promise<{
    readonly _id: UserId;
    readonly role: "student" | "professional";
  } | null>;
}

/** Cambio de estado registrado, del más reciente al más antiguo. */
export type RecentRequestTransition = {
  readonly from: PersistableRequestState;
  readonly to: PersistableRequestState;
  readonly reason?: string;
};

/** Lecturas paginadas y del detalle que necesitan las consultas. */
export interface RequestListReader<RequestId extends string, UserId extends string> {
  listOwnedRequests(
    studentId: UserId,
    options: PaginationOptions,
  ): Promise<PaginationResult<StoredRequestRow<RequestId, UserId>>>;
  listReceivedRequests(
    options: PaginationOptions,
  ): Promise<PaginationResult<StoredRequestRow<RequestId, UserId>>>;
  /** Tomas activas del usuario ordenadas por solicitud, así las duplicadas quedan juntas. */
  listActiveTakes(
    userId: UserId,
    options: PaginationOptions,
  ): Promise<PaginationResult<{ readonly requestId: RequestId }>>;
  listRecentTransitions(requestId: RequestId): Promise<readonly RecentRequestTransition[]>;
}
