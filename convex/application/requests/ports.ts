import type { PaginationOptions, PaginationResult } from "convex/server";
import type { AccompanimentRow } from "../../domain/accompaniments/accompaniment";
import type { IncomingReferral, OutgoingReferral } from "../../domain/requests/referral";
import type { RequestState } from "../../domain/requests/state";
import type { RequestProvenanceChannel, RequestSubmission } from "../../domain/requests/request";
import type { RequestStatusChange } from "../../domain/requests/transitions";

/**
 * Puertos de los casos de uso de solicitudes (TI2-141, TI2-181, TI2-143).
 *
 * Capa de Aplicación: fija lo que un caso de uso lee y escribe, sin Convex.
 * Infraestructura los cumple por forma con `requestStore(ctx)`,
 * `requestReader(ctx)`, `activeStudentReader(ctx)`,
 * `activeStudentByEmailReader(ctx)`, `activeProfessionalReader(ctx)`,
 * `activeRequestViewerReader(ctx)` y `accompanimentOpener(ctx)`, creados en
 * Presentación con el mismo `ctx`, así
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
  readonly status: RequestState;
  readonly accessNeeds: string;
  readonly createdAt: number;
  /** Profesional que la tomó para revisión; recibe los avisos del Estudiante (TI2-150). */
  readonly takenBy?: UserId;
  /**
   * Canal por el que llegó y, en el canal oficial, quién la registró; ausente
   * en las filas anteriores a TI2-135.
   */
  readonly provenance?: {
    readonly channel: RequestProvenanceChannel;
    readonly registeredBy?: UserId;
  };
  /** Derivación de entrada, si otra unidad avisó a CERETI (TI2-143). */
  readonly incomingReferral?: IncomingReferral<UserId>;
  /** Derivación de salida, si CERETI derivó la solicitud (TI2-143). */
  readonly outgoingReferral?: OutgoingReferral<UserId>;
};

/** Solicitud por id, o `null` si no existe. */
export interface RequestReader<RequestId extends string, UserId extends string> {
  getRequest(requestId: RequestId): Promise<StoredRequestRow<RequestId, UserId> | null>;
}

/** Escribe el estado vigente con el cambio que dejó la política. */
export interface RequestStatusWriter<RequestId extends string, UserId extends string> {
  setRequestStatus(requestId: RequestId, change: RequestStatusChange<UserId>): Promise<void>;
}

/** Registra el cambio de estado con motivo, actor y fecha. */
export interface RequestTransitionRecorder<RequestId extends string, UserId extends string> {
  logRequestTransition(entry: {
    readonly requestId: RequestId;
    readonly from: RequestState;
    readonly to: RequestState;
    readonly actorId: UserId;
    readonly reason?: string;
    readonly occurredAt: number;
  }): Promise<void>;
}

/** Si el Profesional tiene una toma activa de la solicitud: la que deja operarla. */
export interface RequestTakeReader<RequestId extends string, UserId extends string> {
  hasActiveTake(requestId: RequestId, userId: UserId): Promise<boolean>;
}

/**
 * Si el Profesional tiene una toma activa o terminada de la solicitud
 * (TI4-84): deja leer el detalle a quien la revisa y a quien la revisó hasta
 * que terminó. Una toma liberada no cuenta. Las operaciones del Profesional
 * también autorizan con ella: sobre una solicitud terminada la política de
 * estados responde `conflict`, como cuando la toma seguía activa.
 */
export interface ReadableTakeReader<RequestId extends string, UserId extends string> {
  hasReadableTake(requestId: RequestId, userId: UserId): Promise<boolean>;
}

/** Crea la toma activa del Profesional y marca la solicitud como tomada por él. */
export interface RequestTakeRecorder<RequestId extends string, UserId extends string> {
  recordTake(requestId: RequestId, professionalId: UserId): Promise<void>;
}

/**
 * Libera la toma activa del Profesional (TI4-84): la cierra como `revoked`
 * con quién la liberó y cuándo, y deja la solicitud sin `takenBy`, así los
 * avisos de quien la tome después no le llegan a quien la liberó.
 */
export interface RequestTakeReleaser<RequestId extends string, UserId extends string> {
  releaseTake(input: {
    readonly requestId: RequestId;
    readonly holderId: UserId;
    readonly releasedBy: UserId;
    readonly releasedAt: number;
  }): Promise<void>;
}

/**
 * Cierra como `finished` las tomas activas de una solicitud que llegó a un
 * estado terminal (TI4-84). Quien la revisó la sigue leyendo.
 */
export interface RequestTakeFinisher<RequestId extends string> {
  finishTakes(requestId: RequestId, finishedAt: number): Promise<void>;
}

/** Solicitudes con toma activa del Profesional, para liberarlas al revocar su cuenta. */
export interface ActiveTakesReader<RequestId extends string, UserId extends string> {
  listActiveTakeRequestIds(userId: UserId): Promise<readonly RequestId[]>;
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
  }): Promise<AccompanimentRow<AccompanimentId, UserId, RequestId>>;
}

/**
 * Guarda una solicitud recibida del Estudiante. `registerComplete` guarda el
 * envío completo ya validado y `registerLegacy` la forma anterior, solo con el
 * texto de necesidades de acceso.
 */
export interface RequestRegistrar<RequestId extends string, UserId extends string> {
  registerComplete(
    studentId: UserId,
    submission: RequestSubmission,
    receivedAt: number,
  ): Promise<RequestId>;
  registerLegacy(studentId: UserId, accessNeeds: string): Promise<RequestId>;
}

/** Estudiante con cuenta habilitada y vigente que tiene ese correo; si no, `null`. */
export interface ActiveStudentByEmailReader<UserId extends string> {
  findActiveStudentByEmail(email: string): Promise<{ readonly _id: UserId } | null>;
}

/**
 * Guarda una solicitud recibida por canal oficial (TI2-143). La procedencia
 * lleva quién la registró y cuándo la recibió CERETI; con `originUnit` queda
 * además como derivación de entrada, avisada en esa misma fecha.
 */
export interface OfficialRequestRegistrar<RequestId extends string, UserId extends string> {
  registerOfficial(input: {
    readonly studentId: UserId;
    readonly submission: RequestSubmission;
    readonly registeredBy: UserId;
    readonly receivedAt: number;
    readonly originUnit?: string;
  }): Promise<RequestId>;
}

/**
 * Escritura de la derivación de entrada (TI2-143): la guarda con el contacto
 * o la aceptación ya aplicados. La de salida no tiene puerto propio: va con
 * el estado `referred`, por `RequestStatusWriter`.
 */
export interface RequestReferralWriter<RequestId extends string, UserId extends string> {
  setIncomingReferral(requestId: RequestId, referral: IncomingReferral<UserId>): Promise<void>;
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

/**
 * Acompañamiento que abrió la solicitud al aceptarse (TI2-183), o `null` si
 * no se abrió ninguno. La aceptación abre como máximo uno por solicitud.
 */
export interface ResultingAccompanimentReader<
  RequestId extends string,
  AccompanimentId extends string,
> {
  findAccompanimentIdForRequest(requestId: RequestId): Promise<AccompanimentId | null>;
}

/** Cambio de estado registrado, del más reciente al más antiguo. */
export type RecentRequestTransition = {
  readonly from: RequestState;
  readonly to: RequestState;
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
  /**
   * Tomas activas y terminadas del usuario, sin las liberadas, ordenadas por
   * solicitud: así las duplicadas quedan juntas.
   */
  listReviewTakes(
    userId: UserId,
    options: PaginationOptions,
  ): Promise<PaginationResult<{ readonly requestId: RequestId }>>;
  listRecentTransitions(requestId: RequestId): Promise<readonly RecentRequestTransition[]>;
}
