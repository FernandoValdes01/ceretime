import type { PaginationOptions, PaginationResult } from "convex/server";
import { okResult, type ApiResult } from "../../domain/errors/api_error";
import {
  toAccompanimentRequest,
  toRequestExchange,
  type AccompanimentRequest,
} from "../../domain/requests/request";
import type {
  ActiveProfessionalReader,
  ActiveRequestViewerReader,
  ActiveStudentReader,
  RequestListReader,
  RequestReader,
  RequestTakeReader,
  StoredRequestRow,
} from "./ports";
import { denied } from "./results";

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

/** Solicitud pública con los identificadores que instancia Presentación. */
type RequestEntity<RequestId extends string, UserId extends string> = AccompanimentRequest & {
  readonly _id: RequestId;
  readonly studentId: UserId;
};

/** Entidad pública de una fila: valida el estado y nunca agrega campos. */
function toEntity<RequestId extends string, UserId extends string>(
  row: StoredRequestRow<RequestId, UserId>,
): RequestEntity<RequestId, UserId> {
  return toAccompanimentRequest({
    _id: row._id,
    studentId: row.studentId,
    status: row.status,
    accessNeeds: row.accessNeeds,
    createdAt: row.createdAt,
  });
}

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
  return okResult({ ...result, page: result.page.map(toEntity) });
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
 * historial lineal. Cualquier otro rol, o un tamaño de página no finito,
 * recibe `unauthorized`.
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
  if (!Number.isFinite(input.paginationOpts.numItems)) return denied();
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
export interface GetRequestDetailDeps<RequestId extends string, UserId extends string> {
  readonly viewers: ActiveRequestViewerReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> &
    RequestTakeReader<RequestId, UserId> &
    RequestListReader<RequestId, UserId>;
}

/** Detalle público: la entidad más los textos del intercambio y la razón de cierre. */
type RequestDetail<RequestId extends string, UserId extends string> = RequestEntity<
  RequestId,
  UserId
> & {
  readonly informationRequest?: string;
  readonly informationResponse?: string;
  readonly closureReason?: string;
};

/**
 * Detalle que recibe quien ya puede leer la solicitud (TI2-141): la entidad
 * más lo pedido mientras espera respuesta, la última respuesta del
 * Estudiante y la razón de cierre. Son textos libres, por eso no viajan en
 * los listados ni en la bandeja.
 */
async function toRequestDetail<RequestId extends string, UserId extends string>(
  requests: RequestListReader<RequestId, UserId>,
  request: StoredRequestRow<RequestId, UserId>,
): Promise<RequestDetail<RequestId, UserId>> {
  const entity = toEntity(request);
  const changes = await requests.listRecentTransitions(request._id);
  return {
    ...entity,
    ...toRequestExchange(entity.status, changes),
    ...(request.closureReason === undefined ? {} : { closureReason: request.closureReason }),
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
export async function getRequestDetailUseCase<RequestId extends string, UserId extends string>(
  deps: GetRequestDetailDeps<RequestId, UserId>,
  input: { readonly tokenIdentifier: string | null; readonly requestId: RequestId },
): Promise<ApiResult<RequestDetail<RequestId, UserId>>> {
  const viewer = await deps.viewers.findActiveViewer(input.tokenIdentifier);
  if (viewer === null) return denied();
  const request = await deps.requests.getRequest(input.requestId);
  if (request === null) return denied();
  const allowed =
    viewer.role === "student"
      ? request.studentId === viewer._id
      : await deps.requests.hasActiveTake(request._id, viewer._id);
  if (!allowed) return denied();
  return okResult(await toRequestDetail(deps.requests, request));
}
