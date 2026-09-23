import type { PaginationOptions, UserIdentity } from "convex/server";
import { toAccompanimentRequest } from "../../domain/request/request";
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import {
  getRequestById,
  listActiveTakes,
  listOwnedRequests,
  listRequestsByStatus,
} from "../../infrastructure/requests/repository";
import { requireActiveProfessional, requireActiveStudent } from "./identity";

/** Tope de identificadores recordados en el cursor entre páginas. */
const MAX_TAKES_CURSOR_SEEN = 500;

/** Posición del barrido y solicitudes ya emitidas dentro del cursor. */
type AuthorizedTakesCursor = {
  readonly pos: string | null;
  readonly seen: readonly string[];
};

/** Lee el cursor con estado; un cursor ajeno reinicia desde el inicio. */
function decodeTakesCursor(cursor: string | null): AuthorizedTakesCursor {
  if (cursor === null) return { pos: null, seen: [] };
  try {
    const parsed: unknown = JSON.parse(cursor);
    if (typeof parsed !== "object" || parsed === null) return { pos: null, seen: [] };
    const record = parsed as Record<string, unknown>;
    const seen = Array.isArray(record.seen)
      ? record.seen.filter((id): id is string => typeof id === "string")
      : [];
    return {
      pos: typeof record.pos === "string" ? record.pos : null,
      seen,
    };
  } catch {
    return { pos: null, seen: [] };
  }
}

/** Guarda la posición y lo emitido para la página siguiente. */
function encodeTakesCursor(cursor: AuthorizedTakesCursor): string {
  return JSON.stringify({
    pos: cursor.pos,
    seen: cursor.seen.slice(-MAX_TAKES_CURSOR_SEEN),
  });
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
 * Barre las tomas con un único `.paginate()` por llamada y filtra repetidos
 * por solicitud con el conjunto `seen` que viaja en el cursor: ninguna se
 * repite ni se pierde entre páginas. Cualquier otro rol recibe
 * denegación genérica.
 */
export async function listAuthorizedRequestsUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly paginationOpts: PaginationOptions },
) {
  const professional = await requireActiveProfessional(ctx, identity);
  const limit = Math.min(Math.max(Math.floor(args.paginationOpts.numItems), 1), 100);
  const cursor = decodeTakesCursor(args.paginationOpts.cursor);
  const seen = new Set<string>(cursor.seen);
  const items: AuthorizedRequestItem[] = [];
  let pos: string | null = cursor.pos;
  let exhausted = false;
  for (let round = 0; round < 10 && items.length < limit; round++) {
    const page = await listActiveTakes(ctx, professional._id, {
      numItems: limit - items.length,
      cursor: pos,
    });
    for (const take of page.page) {
      if (seen.has(take.requestId)) continue;
      seen.add(take.requestId);
      const request = await getRequestById(ctx, take.requestId);
      if (request === null) continue;
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
    pos = page.continueCursor;
    if (page.isDone) {
      exhausted = true;
      break;
    }
  }
  return {
    page: items,
    isDone: exhausted,
    continueCursor: encodeTakesCursor({ pos, seen: [...seen] }),
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
