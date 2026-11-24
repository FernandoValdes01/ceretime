import type { Id } from "../../_generated/dataModel";
import {
  checkStudentReclassification,
  type ReclassifiedRole,
} from "../../domain/accounts/enablement";
import type { StudentReclassificationStore } from "./ports";

/**
 * Corrige a Practicante o a cuenta de prueba pendiente un perfil creado como
 * Estudiante en el primer ingreso (TI2-182).
 *
 * Vía del operador, sin identidad: es la misma que registra esos roles con
 * `createTestUser`, aplicada a quien ingresó antes de ser registrado. Valida
 * con Dominio y falla con el motivo en español, sin escribir, si el perfil no
 * existe, no es Estudiante, no tiene correo `@alu.uct.cl` o ya tiene
 * solicitudes o acompañamientos. No habilita: la cuenta queda pendiente para
 * que la habilite el profesional o el Administrador con `enableIntern` o
 * `enableTestProfessional`.
 */
export async function reclassifyStudentUseCase(
  input: { readonly userId: Id<"users">; readonly role: ReclassifiedRole },
  deps: { readonly accounts: StudentReclassificationStore },
): Promise<Id<"users">> {
  const account = await deps.accounts.findAccount(input.userId);
  if (account === null) throw new Error("No existe un perfil con ese identificador");
  const check = checkStudentReclassification({
    role: account.role,
    email: account.email,
    hasStudentActivity: await deps.accounts.hasStudentActivity(input.userId),
  });
  if (!check.ok) {
    switch (check.reason) {
      case "target-not-student":
        throw new Error("Solo se puede corregir un perfil de Estudiante");
      case "target-email-not-student":
        throw new Error("El perfil debe tener correo @alu.uct.cl");
      case "target-has-student-activity":
        throw new Error("El perfil ya tiene solicitudes o acompañamientos como Estudiante");
    }
  }
  await deps.accounts.markPending(input.userId, input.role);
  return input.userId;
}
