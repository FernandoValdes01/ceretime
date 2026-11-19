import type { Id } from "../../_generated/dataModel";
import { checkInternReclassification } from "../../domain/accounts/enablement";
import type { InternReclassificationStore } from "./ports";

/**
 * Corrige a Practicante pendiente un perfil creado como Estudiante en el
 * primer ingreso (TI2-182).
 *
 * Vía del operador, sin identidad: es la misma que registra Practicantes con
 * `createTestUser`, aplicada a quien ingresó antes de ser registrado. Valida
 * con Dominio y falla con el motivo en español, sin escribir, si el perfil no
 * existe, no es Estudiante, no tiene correo institucional o ya tiene
 * solicitudes o acompañamientos. No habilita: la cuenta queda pendiente para
 * que la habilite el profesional o el Administrador con `enableIntern`.
 */
export async function reclassifyAsInternUseCase(
  userId: Id<"users">,
  deps: { readonly accounts: InternReclassificationStore },
): Promise<Id<"users">> {
  const account = await deps.accounts.findAccount(userId);
  if (account === null) throw new Error("No existe un perfil con ese identificador");
  const check = checkInternReclassification({
    role: account.role,
    email: account.email,
    hasStudentActivity: await deps.accounts.hasStudentActivity(userId),
  });
  if (!check.ok) {
    switch (check.reason) {
      case "target-not-student":
        throw new Error("Solo un perfil de Estudiante puede pasar a Practicante");
      case "target-email-not-institutional":
        throw new Error("El perfil debe tener correo institucional");
      case "target-has-student-activity":
        throw new Error("El perfil ya tiene solicitudes o acompañamientos como Estudiante");
    }
  }
  await deps.accounts.markPendingIntern(userId);
  return userId;
}
