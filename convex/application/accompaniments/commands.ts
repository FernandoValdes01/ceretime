import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { isPersonalProfessionalActive } from "../../domain/accounts/enablement";
import {
  validateAssignmentValidity,
  type AssignmentValidity,
} from "../../domain/accompaniments/practitioner_assignment";
import {
  checkGrantInternAccess,
  checkRevokeInternAccess,
} from "../../domain/accompaniments/intern_access";
import { getInstitutionalPopulation } from "../../domain/auth/institutional_domain";
import { isProfileActive } from "../../domain/authorization/permissions";
import {
  ASSIGNMENT_FIELDS_INVALID_ERROR_CODE,
  CONFLICT_ERROR_CODE,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
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

/**
 * Casos de uso de escritura de asignaciones (S2, TI2-28, TI2-140).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()`, exige llamante profesional de personal con
 * cuenta habilitada y vigente (la cuenta de prueba jamás concede, modifica
 * ni retira: `isPersonalProfessionalActive`, la misma regla que habilita),
 * y persiste con Infraestructura. Devuelve el `ApiResult` común de TI2-88
 * para que Presentación traduzca con `unwrapApiResult` y las vías internas
 * desenvuelvan el mensaje. Nadie puede asignarse acceso a sí mismo.
 *
 * Concesión a Practicante (TI2-28): solo un Profesional autorizado sobre el
 * mismo acompañamiento (con asignación profesional activa y vigente) puede
 * conceder acceso a un Practicante con cuenta habilitada y vigente, y retirar
 * o revocar asignaciones existentes aunque la cuenta haya perdido vigencia.
 * El Administrador solo habilita la cuenta (TI2-11) y jamás concede
 * acompañamientos. La asignación entre profesionales de personal sigue en
 * arranque (cualquier profesional de personal vigente puede otorgarla); la
 * cuenta de prueba (`professional` con correo `@alu.uct.cl`, TI2-140/RN-25)
 * sí exige alcance: solo un Profesional autorizado sobre el mismo
 * acompañamiento puede concederla, modificarla o retirarla, y solo accede a
 * esos acompañamientos explícitos con cuenta habilitada y asignación vigente.
 * La lectura exige `status === "active"` y ventana vigente (TI2-140). Toda
 * operación registra actor y fecha. Opera con datos ficticios.
 */

function unauthorized<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

function conflict<T>(message: string): ApiResult<T> {
  return errResult({ code: CONFLICT_ERROR_CODE, message });
}

function invalidValidity<T>(message: string): ApiResult<T> {
  return errResult({ code: ASSIGNMENT_FIELDS_INVALID_ERROR_CODE, message });
}

/** Llamante profesional con cuenta habilitada y vigente, o `null` sin permiso. */
async function findProfessionalCaller(
  ctx: MutationCtx,
  identity: UserIdentity | null,
): Promise<Doc<"users"> | null> {
  if (identity === null) return null;
  const caller = await findProfileByTokenIdentifier(ctx, identity?.tokenIdentifier ?? "");
  if (
    caller === null ||
    caller.role !== "professional" ||
    caller.institutionalStatus !== "enabled" ||
    caller.accountStatus !== "active"
  ) {
    return null;
  }
  return caller;
}

/** Verdadero cuando el objetivo es cuenta de prueba profesional `@alu.uct.cl` (TI2-140). */
function isTestProfessionalTarget(target: Pick<Doc<"users">, "role" | "email">): boolean {
  return (
    target.role === "professional" && getInstitutionalPopulation(target.email) === "estudiante"
  );
}

/**
 * Coherencia de la vigencia acordada, o `null` cuando es válida (TI2-140).
 * Única fuente para conceder y modificar: la autoriza el llamante antes de
 * validar, así un profesional sin alcance recibe `unauthorized` y no el
 * error de regla.
 */
function validityError<T>(validity: AssignmentValidity): ApiResult<T> | null {
  const check = validateAssignmentValidity(validity);
  if (check.ok) return null;
  if (check.reason === "validity-range-invalid") {
    return invalidValidity(
      "La vigencia acordada es inválida: el inicio no puede ser posterior al fin.",
    );
  }
  return invalidValidity("La vigencia acordada debe usar fechas válidas.");
}

/**
 * Crea la fila activa de la tripla. Primero autoriza (llamante de personal,
 * existencia y alcance con el mismo error genérico, sin revelar existencia)
 * y después valida (coherencia de la vigencia y duplicada). Rechaza que el
 * llamante se asigne acceso a sí mismo. Registra actor (`grantedBy`),
 * acompañamiento y fecha (`grantedAt`); cuando se acuerdan fechas
 * (`validFrom`/`validUntil`, TI2-140), las guarda y la lectura exige ventana
 * vigente además de `status === "active"`.
 */
export async function assignAccompaniment(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  triple: AssignmentTriple,
  validity?: AssignmentValidity,
): Promise<ApiResult<Id<"accompanimentAssignments">>> {
  const caller = await findProfessionalCaller(ctx, identity);
  if (caller === null) return unauthorized();
  if (
    !isPersonalProfessionalActive({
      role: caller.role,
      email: caller.email,
      institutionalStatus: caller.institutionalStatus,
      accountStatus: caller.accountStatus,
    })
  ) {
    return unauthorized();
  }
  if (caller._id === triple.userId) return unauthorized();

  const accompaniment = await getAccompanimentById(ctx, triple.accompanimentId);
  if (accompaniment === null) return unauthorized();
  const target = await getUserById(ctx, triple.userId);
  if (target === null) return unauthorized();

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
        return conflict("El rol del usuario no coincide con el rol asignado");
      }
      return unauthorized();
    }
  } else {
    // Coherencia rol-asignación: el rol del perfil debe coincidir con el rol
    // asignado; una fila que no coincide no otorga ningún acceso efectivo.
    if (target.role !== triple.assignedRole) {
      return conflict("El rol del usuario no coincide con el rol asignado");
    }
    // Cuenta de prueba (TI2-140/RN-25): solo opera habilitada y vigente, y
    // solo dentro de acompañamientos asignados por un profesional autorizado
    // sobre el mismo acompañamiento.
    if (isTestProfessionalTarget(target)) {
      if (!isProfileActive(target)) return unauthorized();
      const callerAssigned = await hasActiveProfessionalAssignment(ctx, {
        accompanimentId: triple.accompanimentId,
        userId: caller._id,
      });
      if (!callerAssigned) return unauthorized();
    }
    // La vía entre profesionales de personal sigue en arranque: cualquier
    // profesional de personal vigente puede otorgarla y su recorte queda
    // fuera de TI2-140.
  }

  const invalid =
    validity === undefined ? null : validityError<Id<"accompanimentAssignments">>(validity);
  if (invalid !== null) return invalid;

  const existing = await findExistingActiveAssignment(ctx, triple);
  if (existing !== null) {
    return conflict("Ya existe una asignación activa para este acompañamiento y rol");
  }
  const id = await insertActiveAssignment(ctx, triple, caller._id, {
    ...(validity?.validFrom === null || validity?.validFrom === undefined
      ? {}
      : { validFrom: validity.validFrom }),
    ...(validity?.validUntil === null || validity?.validUntil === undefined
      ? {}
      : { validUntil: validity.validUntil }),
  });
  return okResult(id);
}

/**
 * Modifica la ventana de vigencia acordada de una asignación activa (TI2-140).
 *
 * Solo un Profesional de personal autorizado sobre el mismo acompañamiento
 * puede modificar el acceso de Practicante, de cuenta de prueba o de
 * profesional de personal. No cambia `status` ni el historial de concesión:
 * solo reescribe la ventana. Comprueba la coherencia de la ventana resultante
 * y rechaza el rango invertido. El acompañamiento inexistente, no autorizado
 * o sin fila activa responde el mismo error genérico, sin revelar existencia.
 */
export async function updateAccompanimentAssignment(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  triple: AssignmentTriple,
  validity: { readonly validFrom?: number | null; readonly validUntil?: number | null },
): Promise<ApiResult<Id<"accompanimentAssignments">>> {
  const caller = await findProfessionalCaller(ctx, identity);
  if (caller === null) return unauthorized();
  if (
    !isPersonalProfessionalActive({
      role: caller.role,
      email: caller.email,
      institutionalStatus: caller.institutionalStatus,
      accountStatus: caller.accountStatus,
    })
  ) {
    return unauthorized();
  }

  const accompaniment = await getAccompanimentById(ctx, triple.accompanimentId);
  if (accompaniment === null) return unauthorized();

  const callerAssigned = await hasActiveProfessionalAssignment(ctx, {
    accompanimentId: triple.accompanimentId,
    userId: caller._id,
  });
  if (!callerAssigned) return unauthorized();

  const target = await getUserById(ctx, triple.userId);
  if (target === null) return unauthorized();
  if (target.role !== triple.assignedRole) {
    return conflict("El rol del usuario no coincide con el rol asignado");
  }

  const existing = await findExistingActiveAssignment(ctx, triple);
  if (existing === null) return unauthorized();

  const next = {
    validFrom: validity.validFrom === undefined ? (existing.validFrom ?? null) : validity.validFrom,
    validUntil:
      validity.validUntil === undefined ? (existing.validUntil ?? null) : validity.validUntil,
  };
  const invalid = validityError<Id<"accompanimentAssignments">>(next);
  if (invalid !== null) return invalid;

  await patchAssignmentValidity(ctx, existing._id, validity);
  return okResult(existing._id);
}

/**
 * Revoca una asignación existente. Es idempotente: revocar una fila ya
 * revocada no falla. Solo un Profesional de personal autorizado sobre el
 * mismo acompañamiento puede retirar o revocar la asignación de Practicante
 * o de cuenta de prueba, aunque el objetivo haya perdido habilitación o
 * vigencia; el acompañamiento inexistente o no autorizado responde el mismo
 * error genérico. La revocación entre profesionales de personal sigue en
 * arranque y no exige alcance. Revoca TODAS las filas activas de la tripla en
 * lugar de una sola, para que ninguna fila escrita fuera del Backend deje
 * acceso activo tras informar éxito. Si tras los lotes acotados quedan filas
 * activas, falla en vez de informar un éxito parcial. Registra actor
 * (`revokedBy`) y fecha (`revokedAt`); la vigencia termina con
 * `status === "revoked"`.
 */
export async function revokeAccompaniment(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  triple: AssignmentTriple,
): Promise<ApiResult<number | null>> {
  const caller = await findProfessionalCaller(ctx, identity);
  if (caller === null) return unauthorized();
  if (
    !isPersonalProfessionalActive({
      role: caller.role,
      email: caller.email,
      institutionalStatus: caller.institutionalStatus,
      accountStatus: caller.accountStatus,
    })
  ) {
    return unauthorized();
  }

  const accompaniment = await getAccompanimentById(ctx, triple.accompanimentId);
  if (accompaniment === null) return unauthorized();

  if (triple.assignedRole === "intern") {
    const target = await getUserById(ctx, triple.userId);
    if (target === null) return unauthorized();
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
        return conflict("El rol del usuario no coincide con el rol asignado");
      }
      return unauthorized();
    }
  } else {
    const target = await getUserById(ctx, triple.userId);
    if (target === null) return unauthorized();
    if (target.role !== triple.assignedRole) {
      return conflict("El rol del usuario no coincide con el rol asignado");
    }
    if (isTestProfessionalTarget(target)) {
      const callerAssigned = await hasActiveProfessionalAssignment(ctx, {
        accompanimentId: triple.accompanimentId,
        userId: caller._id,
      });
      if (!callerAssigned) return unauthorized();
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
  if (revoked === 0) return okResult(null);
  const remaining = await takeActiveTripleRows(ctx, triple, 1);
  if (remaining.length > 0) {
    return conflict("Quedaron asignaciones activas sin revocar");
  }
  return okResult(revoked);
}
