import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import {
  backfillMissingTraceability,
  findExistingActiveAssignment,
  findProfileByTokenIdentifier,
  getAccompanimentById,
  getUserById,
  insertActiveAssignment,
  revokeAssignmentRow,
  takeActiveTripleRows,
  type AssignmentTriple,
} from "../../infrastructure/accompaniments/repository";
import { AUTHORIZATION_DENIED_MESSAGE } from "../authorization/authorize";

/**
 * Casos de uso de escritura de asignaciones (S2).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()`, exige llamante Profesional con cuenta
 * habilitada y vigente, y persiste con Infraestructura. Única vía de
 * escritura de `accompanimentAssignments` junto a `revoke`. El recorte por
 * acompañamiento (asignar solo en los propios) llega con el flujo público
 * de RF-39. Opera con datos ficticios.
 */

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

/** Llamante Profesional con cuenta habilitada y vigente. */
async function requireProfessionalCaller(
  ctx: MutationCtx,
  identity: UserIdentity | null,
): Promise<Doc<"users">> {
  if (identity === null) deny();
  const caller = await findProfileByTokenIdentifier(ctx, identity?.tokenIdentifier ?? "");
  if (
    caller === null ||
    caller.role !== "professional" ||
    caller.institutionalStatus !== "enabled" ||
    caller.accountStatus !== "active"
  ) {
    deny();
  }
  return caller;
}

/**
 * Crea la fila activa de la tripla. Rechaza la fila activa duplicada para
 * la misma combinación de acompañamiento, usuario y rol, sosteniendo el
 * invariante del esquema: por rol, cada acompañamiento aparece una sola vez
 * y el listado paginado no puede repetir entre páginas.
 */
export async function assignAccompaniment(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  triple: AssignmentTriple,
) {
  const caller = await requireProfessionalCaller(ctx, identity);

  const accompaniment = await getAccompanimentById(ctx, triple.accompanimentId);
  const target = await getUserById(ctx, triple.userId);
  if (accompaniment === null || target === null) {
    throw new Error("El acompañamiento y el usuario deben existir");
  }

  const existing = await findExistingActiveAssignment(ctx, triple);
  if (existing !== null) {
    throw new Error("Ya existe una asignación activa para este acompañamiento y rol");
  }
  return await insertActiveAssignment(ctx, triple, caller._id);
}

/**
 * Revoca una asignación existente. Es idempotente: revocar una fila ya
 * revocada no falla. Revoca TODAS las filas activas de la tripla en lugar
 * de una sola, para que ninguna fila escrita fuera del Backend deje acceso
 * activo tras informar éxito.
 */
export async function revokeAccompaniment(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  triple: AssignmentTriple,
): Promise<number | null> {
  const caller = await requireProfessionalCaller(ctx, identity);

  let revoked = 0;
  for (let round = 0; round < 10; round++) {
    const rows = await takeActiveTripleRows(ctx, triple, 50);
    if (rows.length === 0) break;
    for (const row of rows) {
      await revokeAssignmentRow(ctx, row._id, caller._id);
    }
    revoked += rows.length;
    if (rows.length < 50) break;
  }
  if (revoked === 0) return null;
  return revoked;
}

/**
 * Migra una página acotada de filas legacy sin trazabilidad. `grantedAt`
 * se recupera de la creación real de cada fila; `attestedGrantedBy` lo
 * aporta el operador y solo debe usarse cuando consta externamente quién
 * concedió esas asignaciones. No exige identidad: es herramienta puntual de
 * operador, no un flujo de aplicación. Se avanza con `cursor`
 * hasta alcanzar `done`; cada página corre en su propia transacción.
 */
export async function backfillAssignmentTraceabilityUseCase(
  ctx: MutationCtx,
  input: {
    readonly attestedGrantedBy: Id<"users">;
    readonly cursor: string | null;
    readonly numItems?: number;
  },
): Promise<{ migrated: number; cursor: string | null; done: boolean }> {
  const pageSize = Math.min(Math.max(Math.floor(input.numItems ?? 100), 1), 100);
  return await backfillMissingTraceability(ctx, {
    attestedGrantedBy: input.attestedGrantedBy,
    cursor: input.cursor,
    numItems: pageSize,
  });
}
