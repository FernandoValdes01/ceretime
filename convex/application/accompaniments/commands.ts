import type { UserIdentity } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { isPersonalProfessionalActive, isTestProfessional } from "../../domain/accounts/enablement";
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
  ASSIGNMENT_FIELDS_INVALID_ERROR_CODE,
  CONFLICT_ERROR_CODE,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import {
  expireAssignmentRow,
  findExistingActiveAssignment,
  findProfileByTokenIdentifier,
  getAccompanimentById,
  getAssignmentById,
  getUserById,
  hasActiveProfessionalAssignment,
  hasAnotherActiveProfessional,
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
 * acompañamientos. La concesión a cuenta de prueba (`professional` con correo
 * `@alu.uct.cl`, TI2-140/RN-25) exige lo mismo y solo accede a esos
 * acompañamientos explícitos. Entre profesionales de personal, el alcance se
 * exige siempre salvo arranque explícito (`bootstrapStaff`, solo vía
 * interna); la vía pública nunca arranca sin alcance. La lectura exige
 * `status === "active"` y ventana vigente (TI2-140): al vencer, una función
 * programada revoca la fila para que las consultas suscritas se actualicen.
 * Toda operación registra actor y fecha. Opera con datos ficticios.
 *
 * Cambio de profesionales (TI2-152): se hace con estas mismas operaciones,
 * sin una paralela. Conceder y modificar se rechazan en un acompañamiento
 * cerrado, y retirar a un profesional exige que quede otro asignado.
 */

/**
 * Programación del vencimiento de la vigencia (TI2-140).
 *
 * Puerto para que la regla viva en el caso de uso y no en el borde:
 * Presentación lo implementa con `ctx.scheduler.runAt` y las vías internas lo
 * omiten (sus concesiones son sin fechas o de arranque).
 */
export type AssignmentScheduler = {
  readonly scheduleExpiry: (input: {
    readonly assignmentId: Id<"accompanimentAssignments">;
    readonly validUntil: number;
  }) => Promise<void>;
};

/**
 * Programa la revocación al vencer la ventana acordada, o nada sin fechas.
 *
 * La invoca el caso de uso tras escribir, con el programador que le entrega
 * el borde; la guarda idempotente de `expireAssignmentWindow` ignora
 * programaciones obsoletas.
 */
export async function scheduleValidityWindow(
  schedule: AssignmentScheduler | undefined,
  assignmentId: Id<"accompanimentAssignments">,
  validity: AssignmentValidity | undefined,
): Promise<void> {
  if (
    schedule === undefined ||
    validity?.validUntil === undefined ||
    validity.validUntil === null
  ) {
    return;
  }
  await schedule.scheduleExpiry({ assignmentId, validUntil: validity.validUntil });
}

function unauthorized<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

function conflict<T>(message: string): ApiResult<T> {
  return errResult({ code: CONFLICT_ERROR_CODE, message });
}

/**
 * Un acompañamiento cerrado es de solo lectura (TI2-152): no admite conceder
 * ni modificar accesos. Retirar sigue permitido, porque cortar un acceso a
 * datos sensibles nunca se bloquea.
 */
const CLOSED_ACCOMPANIMENT_MESSAGE = "El acompañamiento está cerrado y no admite cambios";

function invalidValidity<T>(message: string): ApiResult<T> {
  return errResult({ code: ASSIGNMENT_FIELDS_INVALID_ERROR_CODE, message });
}

/** Profesional de personal con cuenta habilitada y vigente, o `null` sin permiso. */
async function findStaffProfessionalCaller(
  ctx: MutationCtx,
  identity: UserIdentity | null,
): Promise<Doc<"users"> | null> {
  if (identity === null) return null;
  const caller = await findProfileByTokenIdentifier(ctx, identity.tokenIdentifier);
  if (caller === null || !isPersonalProfessionalActive(caller)) return null;
  return caller;
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
 * Exige programador cuando hay vencimiento que programar (TI2-140).
 *
 * Única fuente para conceder y modificar: sin `schedule`, una vigencia con
 * `validUntil` nunca vencería en vivo y nada lo detectaría. Es un error
 * interno de programación, no un rechazo al cliente: la vía pública siempre
 * lo entrega y las vías internas no conceden con vigencia.
 */
function assertSchedulerFor(
  validity: AssignmentValidity | undefined,
  schedule: AssignmentScheduler | undefined,
): void {
  if (
    validity?.validUntil !== undefined &&
    validity.validUntil !== null &&
    schedule === undefined
  ) {
    throw new Error("La vigencia con vencimiento exige un programador (AssignmentScheduler).");
  }
}

/**
 * Crea la fila activa de la terna. Primero autoriza (llamante de personal,
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
  options?: { readonly bootstrapStaff?: boolean; readonly schedule?: AssignmentScheduler },
): Promise<ApiResult<Id<"accompanimentAssignments">>> {
  assertSchedulerFor(validity, options?.schedule);
  const caller = await findStaffProfessionalCaller(ctx, identity);
  if (caller === null) return unauthorized();
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
    // Alcance (TI2-140): la prueba solo opera habilitada y vigente dentro de
    // acompañamientos asignados por un profesional autorizado sobre el mismo
    // acompañamiento. Entre profesionales de personal el alcance se exige
    // siempre, salvo arranque explícito de la vía interna (`bootstrapStaff`).
    if (isTestProfessional(target) || options?.bootstrapStaff !== true) {
      if (!isProfileActive(target)) return unauthorized();
      const callerAssigned = await hasActiveProfessionalAssignment(ctx, {
        accompanimentId: triple.accompanimentId,
        userId: caller._id,
      });
      if (!callerAssigned) return unauthorized();
    }
    // La vía interna en arranque (`bootstrapStaff`) no exige alcance.
  }

  if (accompaniment.status === "closed") return conflict(CLOSED_ACCOMPANIMENT_MESSAGE);

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
  await scheduleValidityWindow(options?.schedule, id, validity);
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
  options?: { readonly schedule?: AssignmentScheduler },
): Promise<ApiResult<Id<"accompanimentAssignments">>> {
  assertSchedulerFor(validity, options?.schedule);
  const caller = await findStaffProfessionalCaller(ctx, identity);
  if (caller === null) return unauthorized();

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
  if (accompaniment.status === "closed") return conflict(CLOSED_ACCOMPANIMENT_MESSAGE);

  const next = {
    validFrom: validity.validFrom === undefined ? (existing.validFrom ?? null) : validity.validFrom,
    validUntil:
      validity.validUntil === undefined ? (existing.validUntil ?? null) : validity.validUntil,
  };
  const invalid = validityError<Id<"accompanimentAssignments">>(next);
  if (invalid !== null) return invalid;

  await patchAssignmentValidity(ctx, existing._id, validity);
  await scheduleValidityWindow(options?.schedule, existing._id, validity);
  return okResult(existing._id);
}

/**
 * Revoca una asignación existente. Es idempotente: revocar una fila ya
 * revocada no falla. Solo un Profesional de personal autorizado sobre el
 * mismo acompañamiento puede retirar o revocar la asignación de Practicante
 * o de cuenta de prueba, aunque el objetivo haya perdido habilitación o
 * vigencia; el acompañamiento inexistente o no autorizado responde el mismo
 * error genérico. La vía interna en arranque (`bootstrapStaff`) no exige
 * alcance y la vía pública siempre lo exige. Revoca TODAS las filas activas
 * de la terna en lugar de una sola, para que ninguna fila escrita fuera del
 * Backend deje acceso activo tras informar éxito. Si tras los lotes acotados
 * quedan filas activas, falla en vez de informar un éxito parcial. Registra
 * actor (`revokedBy`) y fecha (`revokedAt`); la vigencia termina con
 * `status === "revoked"`.
 */
export async function revokeAccompaniment(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  triple: AssignmentTriple,
  options?: { readonly bootstrapStaff?: boolean },
): Promise<ApiResult<number | null>> {
  const caller = await findStaffProfessionalCaller(ctx, identity);
  if (caller === null) return unauthorized();

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
    if (isTestProfessional(target) || options?.bootstrapStaff !== true) {
      const callerAssigned = await hasActiveProfessionalAssignment(ctx, {
        accompanimentId: triple.accompanimentId,
        userId: caller._id,
      });
      if (!callerAssigned) return unauthorized();
    }
    // La vía interna en arranque (`bootstrapStaff`) no exige alcance.
  }

  // Un acompañamiento no queda sin profesional (TI2-152): quien se retira
  // necesita que otro profesional siga asignado. La vía interna en arranque
  // conserva la revocación libre para migraciones y datos de prueba.
  if (triple.assignedRole === "professional" && options?.bootstrapStaff !== true) {
    const holdsAssignment = (await takeActiveTripleRows(ctx, triple, 1)).length > 0;
    if (holdsAssignment && !(await hasAnotherActiveProfessional(ctx, triple))) {
      return conflict("El acompañamiento no puede quedar sin profesional asignado");
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

/**
 * Revoca la fila al vencer su ventana acordada (TI2-140).
 *
 * La ejecuta el programador (`ctx.scheduler.runAt(validUntil, ...)`): cambia
 * el dato para que las consultas suscritas vuelvan a ejecutarse al vencer,
 * ya que el paso del tiempo por sí solo no invalida la caché. Es idempotente
 * y con guarda: si la fila ya no está activa, si la ventana cambió o si aún
 * no vence, no escribe. El actor es el sistema (`revokedBy` ausente con
 * `revokedAt`), distinto de la revocación de una persona.
 */
export async function expireAssignmentWindow(
  ctx: MutationCtx,
  input: { readonly assignmentId: Id<"accompanimentAssignments">; readonly validUntil: number },
): Promise<Id<"accompanimentAssignments"> | null> {
  const row = await getAssignmentById(ctx, input.assignmentId);
  if (row === null || row.status !== "active") return null;
  if (row.validUntil !== input.validUntil) return null;
  if (Date.now() < input.validUntil) return null;
  await expireAssignmentRow(ctx, row._id);
  return row._id;
}
