import type { PersistableRequestState } from "../../domain/requests/state";
import type { RequestStatusChange } from "../../domain/requests/transitions";

/**
 * Puertos de los casos de uso de solicitudes (TI2-141).
 *
 * Capa de Aplicación: fija lo que un caso de uso lee y escribe, sin Convex.
 * Infraestructura los cumple por forma con `requestStore(ctx)` y
 * `activeStudentReader(ctx)`, creados en Presentación con el mismo `ctx`, así
 * todo ocurre en una sola mutation. Las pruebas pasan dobles en memoria.
 *
 * Los identificadores son genéricos: Presentación los instancia con los `Id`
 * de Convex y el caso de uso los compara y los devuelve sin convertirlos.
 * Hoy solo los usa `respondToInformationRequest`; el resto del módulo pasa a
 * puertos en TI2-181.
 */

/** Estudiante con cuenta habilitada y vigente; cualquier otro caso es `null`. */
export interface ActiveStudentReader<UserId extends string> {
  findActiveStudent(tokenIdentifier: string | null): Promise<{ readonly _id: UserId } | null>;
}

/** Lo que el caso de uso necesita de una solicitud guardada. */
export type StoredRequestRow<RequestId extends string, UserId extends string> = {
  readonly _id: RequestId;
  readonly studentId: UserId;
  readonly status: PersistableRequestState;
  readonly accessNeeds: string;
  readonly createdAt: number;
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
