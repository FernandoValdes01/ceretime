import type { PaginationOptions, PaginationResult } from "convex/server";
import { okResult, type ApiResult } from "../../domain/errors/api_error";
import {
  invalidRequestFields,
  requestProvenanceChannelOf,
  toRequestExchange,
  type RequestProvenanceChannel,
} from "../../domain/requests/request";
import type {
  ActiveProfessionalReader,
  ActiveRequestViewerReader,
  ActiveStudentReader,
  RequestListReader,
  RequestReader,
  RequestTakeReader,
  ResultingAccompanimentReader,
  StoredRequestRow,
} from "./ports";
import { denied, toEntity, type RequestEntity } from "./results";

/**
 * Casos de uso de lectura de solicitudes (TI2-9, TI2-10, TI2-141, TI2-181).
 *
 * Capa de Aplicación: cada consulta recibe sus dependencias como puertos y
 * devuelve `ApiResult`; Presentación lo traduce con `unwrapApiResult`, así toda
 * denegación llega como `{ code: "unauthorized" }`, sin motivo ni existencia
 * de recursos. El Estudiante solo ve sus recursos propios: el `studentId`
 * siempre sale del perfil del servidor, nunca del cliente. Opera con datos
 * ficticios.
 */

/** Posición del barrido y última solicitud emitida u omitida dentro del cursor (O(1)). */
type AuthorizedTakesCursor = {
  readonly pos: string | null;
  readonly last: string | null;
};

/** Lee el cursor con estado; un cursor ajeno o del formato anterior reinicia desde el inicio. */
function decodeTakesCursor(cursor: string | null): AuthorizedTakesCursor {
  if (cursor === null) return { pos: null, last: null };
  try {
    const parsed: unknown = JSON.parse(cursor);
    if (typeof parsed !== "object" || parsed === null) return { pos: null, last: null };
    const record = parsed as Record<string, unknown>;
    if (typeof record.last !== "string" && record.last !== null) {
      return { pos: null, last: null };
    }
    return {
      pos: typeof record.pos === "string" ? record.pos : null,
      last: typeof record.last === "string" ? record.last : null,
    };
  } catch {
    return { pos: null, last: null };
  }
}

/** Guarda la posición y lo emitido para la página siguiente. */
function encodeTakesCursor(cursor: AuthorizedTakesCursor): string {
  return JSON.stringify(cursor);
}

/** Capacidades del listado propio del Estudiante. */
export interface ListOwnRequestsDeps<RequestId extends string, UserId extends string> {
  readonly students: ActiveStudentReader<UserId>;
  readonly requests: RequestListReader<RequestId, UserId>;
}

/**
 * Lista las solicitudes propias del Estudiante, paginado y en cualquier
 * estado, incluidas las canceladas y las cerradas sin acompañamiento
 * (TI2-141). Cualquier otro rol recibe `unauthorized`.
 */
export async function listOwnRequestsUseCase<RequestId extends string, UserId extends string>(
  deps: ListOwnRequestsDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly paginationOpts: PaginationOptions },
): Promise<ApiResult<PaginationResult<RequestEntity<RequestId, UserId>>>> {
  const student = await deps.students.findActiveStudent(input.tokenIdentifier);
  if (student === null) return denied();
  const result = await deps.requests.listOwnedRequests(student._id, input.paginationOpts);
  return okResult({ ...result, page: result.page.map((row) => toEntity(row)) });
}

/** Capacidades del listado de solicitudes tomadas por el Profesional. */
export interface ListAuthorizedRequestsDeps<RequestId extends string, UserId extends string> {
  readonly professionals: ActiveProfessionalReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> & RequestListReader<RequestId, UserId>;
}

/**
 * Lista las solicitudes tomadas por el Profesional, paginado. Definición de
 * alcance (TI2-9): el Profesional solo ve las solicitudes con toma activa a
 * su nombre, vengan de la vía guardada o de filas legacy escritas a mano.
 * Un único `.paginate()` por llamada (límite de Convex) sobre las tomas
 * ordenadas por solicitud: las filas duplicadas quedan adyacentes y el
 * cursor solo guarda la posición y la última solicitud emitida u omitida (O(1)), sin
 * historial lineal. Cualquier otro rol recibe `unauthorized`; un tamaño de
 * página no finito es un argumento inválido y recibe `request_fields_invalid`
 * (TI2-181).
 *
 * Cerrar o cancelar no revoca la toma, así que una solicitud cancelada o
 * cerrada sin acompañamiento sigue en el listado con su estado (TI2-141).
 */
export async function listAuthorizedRequestsUseCase<
  RequestId extends string,
  UserId extends string,
>(
  deps: ListAuthorizedRequestsDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly paginationOpts: PaginationOptions },
): Promise<ApiResult<PaginationResult<RequestEntity<RequestId, UserId>>>> {
  const professional = await deps.professionals.findActiveProfessional(input.tokenIdentifier);
  if (professional === null) return denied();
  if (!Number.isFinite(input.paginationOpts.numItems)) {
    return invalidRequestFields("El tamaño de página debe ser un número finito.");
  }
  const limit = Math.min(Math.max(Math.floor(input.paginationOpts.numItems), 1), 100);
  const cursor = decodeTakesCursor(input.paginationOpts.cursor);
  const page = await deps.requests.listActiveTakes(professional._id, {
    numItems: limit,
    cursor: cursor.pos,
  });
  const items: RequestEntity<RequestId, UserId>[] = [];
  const seenInPage = new Set<string>();
  let last = cursor.last;
  for (const take of page.page) {
    if (take.requestId === last || seenInPage.has(take.requestId)) continue;
    seenInPage.add(take.requestId);
    const request = await deps.requests.getRequest(take.requestId);
    if (request === null) continue;
    last = take.requestId;
    items.push(toEntity(request));
  }
  return okResult({
    page: items,
    isDone: page.isDone,
    continueCursor: encodeTakesCursor({ pos: page.continueCursor, last }),
  });
}

/** Capacidades de la bandeja de triage. */
export interface ListOpenRequestsDeps<RequestId extends string, UserId extends string> {
  readonly professionals: ActiveProfessionalReader<UserId>;
  readonly requests: RequestListReader<RequestId, UserId>;
}

/**
 * Bandeja de triage para el Profesional, paginado y con vista minimizada:
 * solo solicitudes `received` (abiertas, sin tomar), con `_id`,
 * `studentId`, `status` y `createdAt`, nunca `accessNeeds`. Solo descubrir,
 * no autoriza a operar: cada solicitud requiere su toma. Cualquier otro rol
 * recibe `unauthorized`.
 */
export async function listOpenRequestsUseCase<RequestId extends string, UserId extends string>(
  deps: ListOpenRequestsDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly paginationOpts: PaginationOptions },
): Promise<
  ApiResult<
    PaginationResult<
      Pick<RequestEntity<RequestId, UserId>, "_id" | "studentId" | "status" | "createdAt">
    >
  >
> {
  const professional = await deps.professionals.findActiveProfessional(input.tokenIdentifier);
  if (professional === null) return denied();
  const result = await deps.requests.listReceivedRequests(input.paginationOpts);
  return okResult({
    ...result,
    page: result.page.map((row) => {
      const adapted = toEntity(row);
      return {
        _id: adapted._id,
        studentId: adapted.studentId,
        status: adapted.status,
        createdAt: adapted.createdAt,
      };
    }),
  });
}

/** Capacidades del detalle. */
export interface GetRequestDetailDeps<
  RequestId extends string,
  UserId extends string,
  AccompanimentId extends string,
> {
  readonly viewers: ActiveRequestViewerReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> &
    RequestTakeReader<RequestId, UserId> &
    RequestListReader<RequestId, UserId>;
  readonly accompaniments: ResultingAccompanimentReader<RequestId, AccompanimentId>;
}

/**
 * Detalle público: la entidad más los textos del intercambio, la razón de
 * cierre, el canal de procedencia y las derivaciones (TI2-143). De las
 * derivaciones no viaja quién contactó ni quién derivó: el detalle no entrega
 * identificadores de personal. Una solicitud aceptada suma el
 * `accompanimentId` que abrió (TI2-183), para enlazar ambos.
 */
type RequestDetail<
  RequestId extends string,
  UserId extends string,
  AccompanimentId extends string,
> = RequestEntity<RequestId, UserId> & {
  readonly informationRequest?: string;
  readonly informationResponse?: string;
  readonly closureReason?: string;
  readonly provenanceChannel: RequestProvenanceChannel;
  readonly incomingReferral?: {
    readonly originUnit: string;
    readonly referredAt: number;
    readonly contactedAt?: number;
    readonly acceptedAt?: number;
  };
  readonly outgoingReferral?: {
    readonly destinationUnit: string;
    readonly referredAt: number;
    readonly reason: string;
  };
  readonly accompanimentId?: AccompanimentId;
};

/**
 * Detalle que recibe quien ya puede leer la solicitud (TI2-141): la entidad
 * más lo pedido mientras espera respuesta, la última respuesta del
 * Estudiante y la razón de cierre. Son textos libres, por eso no viajan en
 * los listados ni en la bandeja.
 */
async function toRequestDetail<
  RequestId extends string,
  UserId extends string,
  AccompanimentId extends string,
>(
  deps: Pick<
    GetRequestDetailDeps<RequestId, UserId, AccompanimentId>,
    "requests" | "accompaniments"
  >,
  request: StoredRequestRow<RequestId, UserId>,
): Promise<RequestDetail<RequestId, UserId, AccompanimentId>> {
  const entity = toEntity(request);
  const changes = await deps.requests.listRecentTransitions(request._id);
  const accompanimentId = await deps.accompaniments.findAccompanimentIdForRequest(request._id);
  const { incomingReferral, outgoingReferral } = request;
  return {
    ...entity,
    ...toRequestExchange(entity.status, changes),
    provenanceChannel: requestProvenanceChannelOf(request),
    ...(incomingReferral === undefined
      ? {}
      : {
          incomingReferral: {
            originUnit: incomingReferral.originUnit,
            referredAt: incomingReferral.referredAt,
            ...(incomingReferral.contactedAt === undefined
              ? {}
              : { contactedAt: incomingReferral.contactedAt }),
            ...(incomingReferral.acceptedAt === undefined
              ? {}
              : { acceptedAt: incomingReferral.acceptedAt }),
          },
        }),
    ...(outgoingReferral === undefined
      ? {}
      : {
          outgoingReferral: {
            destinationUnit: outgoingReferral.destinationUnit,
            referredAt: outgoingReferral.referredAt,
            reason: outgoingReferral.reason,
          },
        }),
    ...(accompanimentId === null ? {} : { accompanimentId }),
  };
}

/**
 * Detalle de una solicitud con autorización estricta (TI2-10).
 *
 * El Estudiante solo lee sus solicitudes propias y el Profesional solo las
 * que tomó con una toma activa a su nombre; en ambos casos se devuelve la
 * entidad completa. Cualquier otra persona (sin identidad, sin perfil, cuenta
 * inhabilitada, Practicante, Administrador, solicitud inexistente o ajena,
 * o Profesional sin toma) recibe la misma `unauthorized`, sin revelar
 * existencia ni motivo. La bandeja minimizada sigue siendo la única vía de
 * descubrimiento: una solicitud abierta sin toma no se detalla.
 */
export async function getRequestDetailUseCase<
  RequestId extends string,
  UserId extends string,
  AccompanimentId extends string,
>(
  deps: GetRequestDetailDeps<RequestId, UserId, AccompanimentId>,
  input: { readonly tokenIdentifier: string | null; readonly requestId: RequestId },
): Promise<ApiResult<RequestDetail<RequestId, UserId, AccompanimentId>>> {
  const request = await findReadableRequest(deps, input);
  if (request === null) return denied();
  return okResult(await toRequestDetail(deps, request));
}

/** Capacidades de la regla de lectura del detalle. */
export interface RequestReadDeps<RequestId extends string, UserId extends string> {
  readonly viewers: ActiveRequestViewerReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> & RequestTakeReader<RequestId, UserId>;
}

/**
 * Solicitud que quien llama puede leer en detalle, o `null`. Es la única
 * regla de lectura de una solicitud: la usan el detalle y la bandeja de
 * avisos (TI2-154), que vuelve a comprobarla al abrir un aviso.
 */
export async function findReadableRequest<RequestId extends string, UserId extends string>(
  deps: RequestReadDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly requestId: RequestId },
): Promise<StoredRequestRow<RequestId, UserId> | null> {
  const viewer = await deps.viewers.findActiveViewer(input.tokenIdentifier);
  if (viewer === null) return null;
  const request = await deps.requests.getRequest(input.requestId);
  if (request === null) return null;
  const allowed =
    viewer.role === "student"
      ? request.studentId === viewer._id
      : await deps.requests.hasActiveTake(request._id, viewer._id);
  return allowed ? request : null;
}
