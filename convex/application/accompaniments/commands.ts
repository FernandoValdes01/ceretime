import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { getInstitutionalPopulation } from "../../domain/auth/institutional_domain";
import {
  validateAssignmentValidity,
  type AssignmentValidity,
} from "../../domain/accompaniments/practitioner_assignment";
import {
  checkGrantInternAccess,
  checkRevokeInternAccess,
} from "../../domain/accompaniments/intern_access";
import { isProfileActive } from "../../domain/authorization/permissions";
import {
  findExistingActiveAssignment,
  findProfileByTokenIdentifier,
  getAccompanimentById,
  getUserById,
  hasActiveProfessionalAssignment,
  insertActiveAssignment,
  patchAssignmentValidity,
  revokeAssignmentRow,
  takeActiveTripleRows,
  type AssignmentTriple,
} from "../../infrastructure/accompaniments/repository";
import { AUTHORIZATION_DENIED_MESSAGE } from "../authorization/authorize";

/**
 * Casos de uso de escritura de asignaciones (S2, TI2-28, TI2-140).
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
 * mismo acompañamiento (con asignación profesional activa) puede conceder
 * acceso a un Practicante con cuenta habilitada y vigente, y retirar o
 * revocar asignaciones existentes aunque la cuenta haya perdido vigencia.
 * El Administrador solo habilita la cuenta (TI2-11) y jamás concede
 * acompañamientos. La asignación entre profesionales de personal sigue en
 * arranque (cualquier profesional vigente puede otorgarla); la cuenta de
 * prueba (`professional` con correo `@alu.uct.cl`, TI2-140/RN-25) sí exige
 * alcance: solo un Profesional autorizado sobre el mismo acompañamiento
 * puede concederla, modificarla o retirarla, y solo accede a esos
 * acompañamientos explícitos con ambas condiciones (cuenta habilitada y
 * asignación activa). Toda operación registra actor y fecha. Opera con datos
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

/** Verdadero cuando el objetivo es cuenta de prueba profesional `@alu.uct.cl` (TI2-140). */
function isTestProfessionalTarget(target: Pick<Doc<"users">, "role" | "email">): boolean {
  return (
    target.role === "professional" && getInstitutionalPopulation(target.email) === "estudiante"
  );
}

function checkValidityOrThrow(validity: AssignmentValidity | undefined): void {
  if (validity === undefined) return;
  const check = validateAssignmentValidity(validity);
  if (!check.ok) {
    if (check.reason === "validity-range-invalid") {
      throw new Error("La vigencia acordada es inválida: el inicio no puede ser posterior al fin.");
    }
    throw new Error("La vigencia acordada debe usar fechas válidas.");
  }
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
 * vigencia es `status === "active"` hasta su revocación. Cuando se acuerdan
 * fechas (`validFrom`/`validUntil`, TI2-140), comprueba su coherencia y las
 * guarda sin reemplazar a `status`.
 */
export async function assignAccompaniment(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  triple: AssignmentTriple,
  validity?: AssignmentValidity,
) {
  const caller = await requireProfessionalCaller(ctx, identity);
  if (caller._id === triple.userId) deny();
  checkValidityOrThrow(validity);

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
    if (target.role !== triple.assignedRole) {
      throw new Error("El rol del usuario no coincide con el rol asignado");
    }
    // Ambas condiciones para la cuenta de prueba (TI2-140/RN-25): solo opera
    // habilitada y vigente, y solo dentro de acompañamientos asignados por un
    // profesional autorizado sobre el mismo acompañamiento.
    if (isTestProfessionalTarget(target)) {
      if (!isProfileActive(target)) deny();
      const callerAssigned = await hasActiveProfessionalAssignment(ctx, {
        accompanimentId: triple.accompanimentId,
        userId: caller._id,
      });
      if (!callerAssigned) deny();
    }
    // La vía entre profesionales de personal sigue en arranque: cualquier
    // profesional vigente puede otorgarla y su recorte queda fuera de TI2-140.
  }

  const existing = await findExistingActiveAssignment(ctx, triple);
  if (existing !== null) {
    throw new Error("Ya existe una asignación activa para este acompañamiento y rol");
  }
  return await insertActiveAssignment(ctx, triple, caller._id, {
    ...(validity?.validFrom === null || validity?.validFrom === undefined
      ? {}
      : { validFrom: validity.validFrom }),
    ...(validity?.validUntil === null || validity?.validUntil === undefined
      ? {}
      : { validUntil: validity.validUntil }),
  });
}

/**
 * Modifica la ventana de vigencia acordada de una asignación activa (TI2-140).
 *
 * Solo un Profesional autorizado sobre el mismo acompañamiento puede
 * modificar el acceso de Practicante o de cuenta de prueba; la vía entre
 * profesionales de personal exige la misma autorización para modificar. No
 * cambia `status` ni el historial de concesión: solo reescribe la ventana
 * sin inventar revocaciones. Comprueba la coherencia de la ventana resultante
 * y rechaza el rango invertido. El acompañamiento inexistente, no autorizado
 * o sin fila activa responde el mismo error genérico, sin revelar existencia.
 */
export async function updateAccompanimentAssignment(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  triple: AssignmentTriple,
  validity: { readonly validFrom?: number | null; readonly validUntil?: number | null },
) {
  const caller = await requireProfessionalCaller(ctx, identity);

  const accompaniment = await getAccompanimentById(ctx, triple.accompanimentId);
  if (accompaniment === null) deny();

  const callerAssigned = await hasActiveProfessionalAssignment(ctx, {
    accompanimentId: triple.accompanimentId,
    userId: caller._id,
  });
  if (!callerAssigned) deny();

  const target = await getUserById(ctx, triple.userId);
  if (target === null) deny();
  if (target.role !== triple.assignedRole) {
    throw new Error("El rol del usuario no coincide con el rol asignado");
  }

  const existing = await findExistingActiveAssignment(ctx, triple);
  if (existing === null) deny();

  const next = {
    validFrom: validity.validFrom === undefined ? (existing.validFrom ?? null) : validity.validFrom,
    validUntil:
      validity.validUntil === undefined ? (existing.validUntil ?? null) : validity.validUntil,
  };
  const check = validateAssignmentValidity(next);
  if (!check.ok) {
    if (check.reason === "validity-range-invalid") {
      throw new Error("La vigencia acordada es inválida: el inicio no puede ser posterior al fin.");
    }
    throw new Error("La vigencia acordada debe usar fechas válidas.");
  }

  await patchAssignmentValidity(ctx, existing._id, validity);
  return existing._id;
}

/**
 * Revoca una asignación existente. Es idempotente: revocar una fila ya
 * revocada no falla. Solo un Profesional autorizado sobre el mismo
 * acompañamiento puede retirar o revocar la asignación de Practicante o de
 * cuenta de prueba, aunque el objetivo haya perdido habilitación o vigencia;
 * el acompañamiento inexistente o no autorizado responde el mismo error
 * genérico. La revocación entre profesionales de personal sigue en arranque
 * y no exige alcance. Revoca TODAS las filas activas de la tripla en lugar
 * de una sola, para que ninguna fila escrita fuera del Backend deje acceso
 * activo tras informar éxito. Si tras los lotes acotados quedan filas
 * activas, falla en vez de informar un éxito parcial. Registra actor
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
    const target = await getUserById(ctx, triple.userId);
    if (target === null) deny();
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
    const target = await getUserById(ctx, triple.userId);
    if (target === null) deny();
    if (target.role !== triple.assignedRole) {
      throw new Error("El rol del usuario no coincide con el rol asignado");
    }
    if (isTestProfessionalTarget(target)) {
      const callerAssigned = await hasActiveProfessionalAssignment(ctx, {
        accompanimentId: triple.accompanimentId,
        userId: caller._id,
      });
      if (!callerAssigned) deny();
    }
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
