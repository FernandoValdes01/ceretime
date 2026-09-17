import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import {
  checkGrantInternAccess,
  checkRevokeInternAccess,
} from "../../domain/accompaniments/intern_access";
import {
  findExistingActiveAssignment,
  findProfileByTokenIdentifier,
  getAccompanimentById,
  getUserById,
  hasActiveProfessionalAssignment,
  insertActiveAssignment,
  revokeAssignmentRow,
  takeActiveTripleRows,
  type AssignmentTriple,
} from "../../infrastructure/accompaniments/repository";
import { AUTHORIZATION_DENIED_MESSAGE } from "../authorization/authorize";

/**
 * Casos de uso de escritura de asignaciones (S2, TI2-28).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()`, exige llamante Profesional con cuenta
 * habilitada y vigente, y persiste con Infraestructura. Única vía de
 * escritura de `accompanimentAssignments` junto a `revoke`. Nadie puede
 * asignarse acceso a sí mismo: la asignación siempre la otorga otro
 * profesional autorizado, así que un Practicante jamás puede darse acceso
 * a un acompañamiento por sí mismo.
 *
 * Concesión a Practicante (TI2-28): solo un Profesional autorizado sobre el
 * mismo acompañamiento (con asignación profesional activa) puede conceder,
 * retirar o revocar acceso a un Practicante con cuenta habilitada y vigente.
 * El Administrador solo habilita la cuenta (TI2-11) y jamás concede
 * acompañamientos. La asignación entre profesionales sigue en arranque
 * (cualquier profesional vigente puede otorgarla); su recorte por
 * acompañamiento llega con el flujo público de RF-39. Opera con datos
 * ficticios.
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
 * Crea la fila activa de la tripla. Rechaza que el llamante se asigne
 * acceso a sí mismo con el mismo error genérico de autorización, sin
 * exponer el motivo. El acompañamiento inexistente o no autorizado responde
 * el mismo error genérico, sin revelar existencia. Rechaza además la fila
 * activa duplicada para la misma combinación de acompañamiento, usuario y
 * rol, sosteniendo el invariante del esquema: por rol, cada acompañamiento
 * aparece una sola vez y el listado paginado no puede repetir entre páginas.
 * Registra actor (`grantedBy`), acompañamiento y fecha (`grantedAt`); la
 * vigencia es `status === "active"` hasta su revocación.
 */
export async function assignAccompaniment(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  triple: AssignmentTriple,
) {
  const caller = await requireProfessionalCaller(ctx, identity);
  if (caller._id === triple.userId) deny();

  const accompaniment = await getAccompanimentById(ctx, triple.accompanimentId);
  const target = await getUserById(ctx, triple.userId);
  if (accompaniment === null || target === null) deny();

  if (triple.assignedRole === "intern") {
    const callerAssigned = await hasActiveProfessionalAssignment(ctx, {
      accompanimentId: triple.accompanimentId,
      userId: caller._id,
    });
    const check = checkGrantInternAccess({
      caller: {
        role: caller.role,
        institutionalStatus: caller.institutionalStatus,
        accountStatus: caller.accountStatus,
        hasActiveProfessionalAssignment: callerAssigned,
      },
      target: {
        role: target.role,
        institutionalStatus: target.institutionalStatus,
        accountStatus: target.accountStatus,
      },
    });
    if (!check.ok) {
      if (check.reason === "target-not-intern") {
        throw new Error("El rol del usuario no coincide con el rol asignado");
      }
      deny();
    }
  } else {
    // Coherencia rol-asignación: el rol del perfil debe coincidir con el rol
    // asignado; una fila que no coincide no otorga ningún acceso efectivo.
    // La vía profesional sigue en arranque (TI2-28 solo endurece Practicante).
    if (target.role !== triple.assignedRole) {
      throw new Error("El rol del usuario no coincide con el rol asignado");
    }
  }

  const existing = await findExistingActiveAssignment(ctx, triple);
  if (existing !== null) {
    throw new Error("Ya existe una asignación activa para este acompañamiento y rol");
  }
  return await insertActiveAssignment(ctx, triple, caller._id);
}

/**
 * Revoca una asignación existente. Es idempotente: revocar una fila ya
 * revocada no falla. Solo un Profesional autorizado sobre el mismo
 * acompañamiento puede retirar o revocar acceso de Practicante; el
 * acompañamiento inexistente o no autorizado responde el mismo error
 * genérico. Revoca TODAS las filas activas de la tripla en lugar de una
 * sola, para que ninguna fila escrita fuera del Backend deje acceso activo
 * tras informar éxito. Si tras los lotes acotados quedan filas activas,
 * falla en vez de informar un éxito parcial. Registra actor
 * (`revokedBy`) y fecha (`revokedAt`); la vigencia termina con
 * `status === "revoked"`.
 */
export async function revokeAccompaniment(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  triple: AssignmentTriple,
): Promise<number | null> {
  const caller = await requireProfessionalCaller(ctx, identity);

  const accompaniment = await getAccompanimentById(ctx, triple.accompanimentId);
  if (accompaniment === null) deny();

  if (triple.assignedRole === "intern") {
    const callerAssigned = await hasActiveProfessionalAssignment(ctx, {
      accompanimentId: triple.accompanimentId,
      userId: caller._id,
    });
    const check = checkRevokeInternAccess({
      caller: {
        role: caller.role,
        institutionalStatus: caller.institutionalStatus,
        accountStatus: caller.accountStatus,
        hasActiveProfessionalAssignment: callerAssigned,
      },
    });
    if (!check.ok) deny();
  }

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
  const remaining = await takeActiveTripleRows(ctx, triple, 1);
  if (remaining.length > 0) {
    throw new Error("Quedaron asignaciones activas sin revocar");
  }
  return revoked;
}
