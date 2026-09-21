import type { PaginationOptions, UserIdentity } from "convex/server";
import { toAccompanimentRequest } from "../../domain/request/request";
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { getRequestById, listOwnedRequests } from "../../infrastructure/requests/repository";
import {
  getAccompanimentById,
  queryAssignedRowsAfter,
} from "../../infrastructure/accompaniments/repository";
import { requireActiveProfessional, requireActiveStudent } from "./identity";

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
 * Lista las solicitudes vinculadas a los acompañamientos con asignación
 * profesional activa de quien llama, paginado. Definición de alcance
 * (TI2-9): el Profesional solo ve las solicitudes que originaron
 * acompañamientos asignados a él. Sin asignación no hay acceso: las
 * solicitudes nuevas sin acompañamiento no aparecen. Cualquier otro rol
 * recibe denegación genérica.
 *
 * Las filas duplicadas (legacy o escritas fuera de la vía protegida) se
 * filtran por acompañamiento dentro y entre páginas: el cursor avanza
 * por filas y el conjunto `seen` excluye repetidos, como el listado
 * asignado de acompañamientos.
 */
export async function listAuthorizedRequestsUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly paginationOpts: PaginationOptions },
) {
  const professional = await requireActiveProfessional(ctx, identity);
  const limit = Math.min(Math.max(Math.floor(args.paginationOpts.numItems), 1), 100);
  let cursor = (args.paginationOpts.cursor ?? undefined) as Id<"accompaniments"> | undefined;
  const seen = new Set<string>();
  const items: AuthorizedRequestItem[] = [];
  let exhausted = false;
  scan: for (let round = 0; round < 10 && items.length < limit; round++) {
    const rows = await queryAssignedRowsAfter(ctx, {
      userId: professional._id,
      assignedRole: "professional",
      cursor,
      take: 51,
    });
    if (rows.length === 0) {
      exhausted = true;
      break;
    }
    const lastWindow = rows.length < 51;
    for (const row of rows) {
      cursor = row.accompanimentId;
      if (seen.has(row.accompanimentId)) continue;
      seen.add(row.accompanimentId);
      const accompaniment = await getAccompanimentById(ctx, row.accompanimentId);
      if (accompaniment?.requestId === undefined) continue;
      const request = await getRequestById(ctx, accompaniment.requestId);
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
      if (items.length >= limit) break scan;
    }
    if (lastWindow) {
      exhausted = true;
      break;
    }
  }
  return {
    page: items,
    isDone: exhausted,
    continueCursor: cursor ?? "",
  };
}
