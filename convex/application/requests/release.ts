import { okResult, type ApiResult } from "../../domain/errors/api_error";
import { transitionRequest } from "../../domain/requests/transition_policy";
import type {
  ActiveProfessionalReader,
  RequestReader,
  RequestStatusWriter,
  RequestTakeReader,
  RequestTakeReleaser,
  RequestTransitionRecorder,
} from "./ports";
import { denied, stateConflict, toEntity, type RequestEntity } from "./results";
import { toStatusChange } from "./status_change";

/**
 * Liberación de la toma de una solicitud (revisión TI4-84).
 *
 * Capa de Aplicación: sin la liberación, una solicitud tomada quedaba sin
 * salida si el Profesional que la tomó dejaba de operar, porque nadie más
 * puede tomarla ni leerla. La solicitud vuelve a `received` con la política
 * de `transitions.ts` y aparece de nuevo en la bandeja; la toma queda revocada
 * con quién la liberó y cuándo, y el cambio de estado queda en el historial.
 * Otro Profesional solo ve el contenido después de tomarla. Recibe sus
 * dependencias como puertos y Presentación los compone con el `ctx` de la
 * mutation, así todo ocurre en una sola transacción.
 */

/** Capacidades que necesita liberar; la composición entrega los adaptadores. */
export interface ReleaseRequestStore<RequestId extends string, UserId extends string>
  extends
    RequestReader<RequestId, UserId>,
    RequestTakeReader<RequestId, UserId>,
    RequestTakeReleaser<RequestId, UserId>,
    RequestStatusWriter<RequestId, UserId>,
    RequestTransitionRecorder<RequestId, UserId> {}

/** Capacidades del Profesional que libera su propia toma. */
export interface ReleaseRequestDeps<RequestId extends string, UserId extends string> {
  readonly professionals: ActiveProfessionalReader<UserId>;
  readonly requests: ReleaseRequestStore<RequestId, UserId>;
  /** Reloj del servidor para el registro del cambio; las pruebas lo fijan. */
  readonly now: () => number;
}

/**
 * Libera la toma propia: solo el Profesional con cuenta vigente y toma
 * activa. Cualquier otra persona, o una solicitud inexistente o sin su toma,
 * recibe `unauthorized`, igual que al leerla. Un estado sin toma vigente
 * (recibida, aceptada, cerrada, cancelada o derivada) responde `conflict` sin
 * modificar nada.
 */
export async function releaseRequest<RequestId extends string, UserId extends string>(
  deps: ReleaseRequestDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly requestId: RequestId },
): Promise<ApiResult<RequestEntity<RequestId, UserId>>> {
  const professional = await deps.professionals.findActiveProfessional(input.tokenIdentifier);
  if (professional === null) return denied();
  const row = await deps.requests.getRequest(input.requestId);
  if (row === null) return denied();
  if (!(await deps.requests.hasActiveTake(row._id, professional._id))) return denied();
  const released = await releaseTakeOf(deps.requests, {
    requestId: row._id,
    from: row.status,
    professionalId: professional._id,
    releasedBy: professional._id,
    releasedAt: deps.now(),
  });
  if (!released) {
    return stateConflict("La solicitud no admite liberar la toma en su estado actual.");
  }
  return okResult(toEntity(row, "received"));
}

/**
 * Libera las tomas de un Profesional cuya cuenta se revoca. La llama la
 * revocación en la misma mutation, con el Administrador como actor: cada
 * solicitud en revisión o en espera de información vuelve a la bandeja. Las
 * tomas de solicitudes ya terminadas quedan como rastro de quién revisó, igual
 * que al cerrar o aceptar.
 */
export async function releaseTakesOfProfessional<RequestId extends string, UserId extends string>(
  deps: { readonly requests: ReleaseRequestStore<RequestId, UserId>; readonly now: () => number },
  input: { readonly professionalId: UserId; readonly releasedBy: UserId },
): Promise<void> {
  const releasedAt = deps.now();
  for (const requestId of await deps.requests.listActiveTakeRequestIds(input.professionalId)) {
    const row = await deps.requests.getRequest(requestId);
    if (row === null) continue;
    await releaseTakeOf(deps.requests, {
      requestId: row._id,
      from: row.status,
      professionalId: input.professionalId,
      releasedBy: input.releasedBy,
      releasedAt,
    });
  }
}

/**
 * Aplica la política hacia `received` y, si procede, revoca la toma, escribe
 * el estado y registra el cambio. Devuelve `false` sin escribir cuando el
 * estado no admite la liberación.
 */
async function releaseTakeOf<RequestId extends string, UserId extends string>(
  requests: ReleaseRequestStore<RequestId, UserId>,
  input: {
    readonly requestId: RequestId;
    readonly from: Parameters<typeof transitionRequest>[0]["from"];
    readonly professionalId: UserId;
    readonly releasedBy: UserId;
    readonly releasedAt: number;
  },
): Promise<boolean> {
  const result = transitionRequest({
    from: input.from,
    to: "received",
    actorId: input.releasedBy,
    occurredAt: input.releasedAt,
  });
  if (result.status === "rejected") return false;
  await requests.releaseTake({
    requestId: input.requestId,
    professionalId: input.professionalId,
    releasedBy: input.releasedBy,
    releasedAt: input.releasedAt,
  });
  await requests.setRequestStatus(input.requestId, toStatusChange(result.change));
  await requests.logRequestTransition({
    requestId: input.requestId,
    from: result.change.from,
    to: result.change.to,
    actorId: input.releasedBy,
    occurredAt: result.change.occurredAt,
  });
  return true;
}
