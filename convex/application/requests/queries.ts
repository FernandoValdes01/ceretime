import type { PaginationOptions, UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import { toAccompanimentRequest } from "../../domain/request/request";
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { findProfileByTokenIdentifier } from "../../infrastructure/accompaniments/repository";
import {
  findActiveTake,
  getRequestById,
  listActiveTakes,
  listOwnedRequests,
  listRequestsByStatus,
} from "../../infrastructure/requests/repository";
import { AUTHORIZATION_DENIED_MESSAGE } from "../authorization/authorize";
import { requireActiveProfessional, requireActiveStudent } from "./identity";

/** Posición del barrido y última solicitud emitida dentro del cursor (O(1)). */
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

/**
 * Casos de uso de lectura de solicitudes (TI2-9).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()`, exige Estudiante con cuenta habilitada y
 * vigente, y lee con Infraestructura. El Estudiante solo ve sus recursos
 * propios: el `studentId` siempre sale del perfil del servidor, nunca del
 * cliente. Opera con datos ficticios.
 */

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

/**
 * Lista las solicitudes propias del Estudiante, paginado. Cualquier otro
 * rol recibe denegación genérica, sin motivo ni existencia de recursos.
 */
export async function listOwnRequestsUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly paginationOpts: PaginationOptions },
) {
  const student = await requireActiveStudent(ctx, identity);
  const result = await listOwnedRequests(ctx, student._id, args.paginationOpts);
  return {
    ...result,
    page: result.page.map((row) =>
      toAccompanimentRequest({
        _id: row._id,
        studentId: row.studentId,
        status: row.status,
        accessNeeds: row.accessNeeds,
        createdAt: row.createdAt,
      }),
    ),
  };
}

export type AuthorizedRequestItem = {
  readonly _id: Id<"requests">;
  readonly studentId: Id<"users">;
  readonly status: Doc<"requests">["status"];
  readonly accessNeeds: string;
  readonly createdAt: number;
};

/**
 * Lista las solicitudes tomadas por el Profesional, paginado. Definición de
 * alcance (TI2-9): el Profesional solo ve las solicitudes con toma activa a
 * su nombre, vengan de la vía guardada o de filas legacy escritas a mano.
 * Un único `.paginate()` por llamada (límite de Convex) sobre las tomas
 * ordenadas por solicitud: las filas duplicadas quedan adyacentes y el
 * cursor solo guarda la posición y la última solicitud emitida (O(1)), sin
 * historial lineal. Cualquier otro rol recibe denegación genérica.
 */
export async function listAuthorizedRequestsUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly paginationOpts: PaginationOptions },
) {
  const professional = await requireActiveProfessional(ctx, identity);
  if (!Number.isFinite(args.paginationOpts.numItems)) deny();
  const limit = Math.min(Math.max(Math.floor(args.paginationOpts.numItems), 1), 100);
  const cursor = decodeTakesCursor(args.paginationOpts.cursor);
  const page = await listActiveTakes(ctx, professional._id, {
    numItems: limit,
    cursor: cursor.pos,
  });
  const items: AuthorizedRequestItem[] = [];
  const seenInPage = new Set<string>();
  let last = cursor.last;
  for (const take of page.page) {
    if (take.requestId === last || seenInPage.has(take.requestId)) continue;
    seenInPage.add(take.requestId);
    const request = await getRequestById(ctx, take.requestId);
    if (request === null) continue;
    last = take.requestId;
    items.push(
      toAccompanimentRequest({
        _id: request._id,
        studentId: request.studentId,
        status: request.status,
        accessNeeds: request.accessNeeds,
        createdAt: request.createdAt,
      }),
    );
  }
  return {
    page: items,
    isDone: page.isDone,
    continueCursor: encodeTakesCursor({ pos: page.continueCursor, last }),
  };
}

/**
 * Bandeja de triage para el Profesional, paginado y con vista minimizada:
 * solo solicitudes `received` (abiertas, sin tomar), con `_id`,
 * `studentId`, `status` y `createdAt`, nunca `accessNeeds`. Solo descubrir,
 * no autoriza a operar: cada solicitud requiere su toma. Cualquier otro rol
 * recibe denegación genérica.
 */
export async function listOpenRequestsUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly paginationOpts: PaginationOptions },
) {
  await requireActiveProfessional(ctx, identity);
  const result = await listRequestsByStatus(ctx, "received", args.paginationOpts);
  return {
    ...result,
    page: result.page.map((row) => ({
      _id: row._id,
      studentId: row.studentId,
      status: row.status,
      createdAt: row.createdAt,
    })),
  };
}

/**
 * Detalle de una solicitud con autorización estricta (TI2-10).
 *
 * El Estudiante solo lee sus solicitudes propias y el Profesional solo las
 * que tomó con una toma activa a su nombre; en ambos casos se devuelve la
 * entidad completa. Cualquier otro caso (sin identidad, sin perfil, cuenta
 * inhabilitada, Practicante, Administrador, solicitud inexistente o ajena,
 * o Profesional sin toma) recibe la misma denegación genérica, sin revelar
 * existencia ni motivo. La bandeja minimizada sigue siendo la única vía de
 * descubrimiento: una solicitud abierta sin toma no se detalla.
 */
export async function getRequestDetailUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly requestId: Id<"requests"> },
) {
  if (identity === null) deny();
  const caller = await findProfileByTokenIdentifier(ctx, identity?.tokenIdentifier ?? "");
  if (
    caller === null ||
    caller.institutionalStatus !== "enabled" ||
    caller.accountStatus !== "active"
  ) {
    deny();
  }

  const request = await getRequestById(ctx, args.requestId);
  if (request === null) deny();

  if (caller.role === "student") {
    if (request.studentId !== caller._id) deny();
    return toAccompanimentRequest({
      _id: request._id,
      studentId: request.studentId,
      status: request.status,
      accessNeeds: request.accessNeeds,
      createdAt: request.createdAt,
    });
  }

  if (caller.role === "professional") {
    const take = await findActiveTake(ctx, args.requestId, caller._id);
    if (take === null) deny();
    return toAccompanimentRequest({
      _id: request._id,
      studentId: request.studentId,
      status: request.status,
      accessNeeds: request.accessNeeds,
      createdAt: request.createdAt,
    });
  }

  deny();
}
