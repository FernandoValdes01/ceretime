import { okResult, type ApiResult } from "../../domain/errors/api_error";
import { transitionRequest } from "../../domain/requests/transition_policy";
import { isOpenRequestState, type RequestStateChange } from "../../domain/requests/transitions";
import type {
  ActiveProfessionalReader,
  ActiveTakesReader,
  ReadableTakeReader,
  RequestReader,
  RequestStatusWriter,
  RequestTakeFinisher,
  RequestTakeReader,
  RequestTakeReleaser,
  RequestTransitionRecorder,
  StoredRequestRow,
} from "./ports";
import { denied, stateConflict, toEntity, type RequestEntity } from "./results";
import { toStatusChange } from "./status_change";

/**
 * Ciclo de la toma de una solicitud (TI4-84): liberar y terminar.
 *
 * Capa de Aplicación. Liberar devuelve la solicitud a `received` para que
 * reaparezca en la bandeja; lo hace el propio Profesional con la toma activa
 * o, al revocar su cuenta, el Administrador. Nadie reasigna una toma a otro:
 * administrar cuentas no da acceso a las solicitudes. Terminar cierra las
 * tomas cuando la solicitud llega a un estado terminal. Todo ocurre en la
 * mutation que llama, con los adaptadores que crea Presentación.
 */

/** Escrituras que comparten la liberación propia y la de una cuenta revocada. */
type ReleaseWriter<RequestId extends string, UserId extends string> = RequestTakeReleaser<
  RequestId,
  UserId
> &
  RequestStatusWriter<RequestId, UserId> &
  RequestTransitionRecorder<RequestId, UserId>;

/**
 * Libera la toma de `holderId` y devuelve la solicitud a `received`, con el
 * cambio en el historial. `null` si el estado no admite liberarse, sin
 * escribir nada. La liberación no avisa al Estudiante: es interna de CERETI y
 * la solicitud sigue su curso con quien la tome después.
 */
async function releaseHeldTake<RequestId extends string, UserId extends string>(
  requests: ReleaseWriter<RequestId, UserId>,
  row: StoredRequestRow<RequestId, UserId>,
  input: { readonly holderId: UserId; readonly actorId: UserId; readonly occurredAt: number },
): Promise<RequestStateChange | null> {
  const result = transitionRequest({
    from: row.status,
    to: "received",
    actorId: input.actorId,
    occurredAt: input.occurredAt,
  });
  if (result.status === "rejected") return null;
  await requests.releaseTake({
    requestId: row._id,
    holderId: input.holderId,
    releasedBy: input.actorId,
    releasedAt: result.change.occurredAt,
  });
  await requests.setRequestStatus(row._id, toStatusChange(result.change));
  await requests.logRequestTransition({
    requestId: row._id,
    from: result.change.from,
    to: result.change.to,
    actorId: input.actorId,
    occurredAt: result.change.occurredAt,
  });
  return result.change;
}

/** Capacidades que necesita liberar; la composición entrega los adaptadores. */
export interface ReleaseRequestDeps<RequestId extends string, UserId extends string> {
  readonly professionals: ActiveProfessionalReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> &
    RequestTakeReader<RequestId, UserId> &
    ReadableTakeReader<RequestId, UserId> &
    ReleaseWriter<RequestId, UserId>;
  /** Reloj del servidor para el registro del cambio; las pruebas lo fijan. */
  readonly now: () => number;
}

/**
 * El Profesional libera la solicitud que tomó (TI4-84): vuelve a `received`,
 * reaparece en la bandeja y la toma queda liberada con quién y cuándo.
 *
 * Solo el Profesional vigente que la revisa o la revisó: sin toma, o con una
 * ya liberada, recibe `unauthorized`, igual que ante una solicitud
 * inexistente. Liberar desde un estado que no es `under_review` ni
 * `awaiting_information_or_acceptance` responde `conflict` sin escribir: a
 * quien la revisó solo le dice algo que ya puede leer. Responde como
 * `takeRequest`, con la solicitud en su estado nuevo.
 */
export async function releaseRequest<RequestId extends string, UserId extends string>(
  deps: ReleaseRequestDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly requestId: RequestId },
): Promise<ApiResult<RequestEntity<RequestId, UserId>>> {
  const professional = await deps.professionals.findActiveProfessional(input.tokenIdentifier);
  if (professional === null) return denied();
  const row = await deps.requests.getRequest(input.requestId);
  if (row === null) return denied();
  if (!(await deps.requests.hasReadableTake(row._id, professional._id))) return denied();
  if (!(await deps.requests.hasActiveTake(row._id, professional._id))) {
    return stateConflict("La solicitud ya terminó y no se puede liberar.");
  }
  const change = await releaseHeldTake(deps.requests, row, {
    holderId: professional._id,
    actorId: professional._id,
    occurredAt: deps.now(),
  });
  if (change === null) {
    return stateConflict("La solicitud no admite liberarse en su estado actual.");
  }
  return okResult(toEntity(row, change.to));
}

/** Capacidades que necesita liberar las tomas de una cuenta revocada. */
export interface ReleaseOpenTakesDeps<RequestId extends string, UserId extends string> {
  readonly requests: RequestReader<RequestId, UserId> &
    ActiveTakesReader<RequestId, UserId> &
    ReleaseWriter<RequestId, UserId>;
}

/**
 * Libera las tomas abiertas del Profesional cuya cuenta se revoca (TI4-84),
 * con el Administrador que revoca como actor y en la misma transacción que la
 * revocación. Así ninguna solicitud queda bloqueada: vuelven a `received` y a
 * la bandeja. Una toma activa de una solicitud que ya no admite liberarse,
 * como una fila anterior a TI4-84 de una solicitud terminada, se deja como
 * está: la cuenta revocada ya no opera. Devuelve cuántas se liberaron.
 */
export async function releaseOpenTakesOf<RequestId extends string, UserId extends string>(
  deps: ReleaseOpenTakesDeps<RequestId, UserId>,
  input: { readonly professionalId: UserId; readonly actorId: UserId; readonly occurredAt: number },
): Promise<number> {
  let released = 0;
  for (const requestId of await deps.requests.listActiveTakeRequestIds(input.professionalId)) {
    const row = await deps.requests.getRequest(requestId);
    if (row === null) continue;
    const change = await releaseHeldTake(deps.requests, row, {
      holderId: input.professionalId,
      actorId: input.actorId,
      occurredAt: input.occurredAt,
    });
    if (change !== null) released += 1;
  }
  return released;
}

/**
 * Termina las tomas activas cuando el cambio deja la solicitud en un estado
 * terminal (TI4-84): aceptada, cerrada, derivada o cancelada. Quien la revisó
 * la sigue leyendo; ya no la opera.
 */
export async function finishTakesIfTerminal<RequestId extends string>(
  requests: RequestTakeFinisher<RequestId>,
  requestId: RequestId,
  change: RequestStateChange,
): Promise<void> {
  if (isOpenRequestState(change.to)) return;
  await requests.finishTakes(requestId, change.occurredAt);
}
