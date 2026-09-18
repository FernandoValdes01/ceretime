import { isProfileActive } from "../authorization/permissions";

/**
 * Dominio puro de concesión, retiro y revocación de acceso de Practicantes
 * (TI2-28).
 *
 * No importa Convex, React ni variables de entorno: se prueba sin backend.
 * La habilitación de la cuenta (vía administrativa, TI2-11) y la asignación
 * del acompañamiento (vía profesional autorizado, esta vía) son decisiones
 * distintas (CONTEXT.md): habilitar solo deja la cuenta en condiciones de
 * operar y jamás concede acceso a acompañamientos.
 *
 * Alcance: solo cubre la tripla con `assignedRole === "intern"`. La
 * asignación entre profesionales sigue en arranque (cualquier profesional
 * vigente puede otorgarla) y su recorte por acompañamiento llega con el flujo
 * público de RF-39. Los literales deben mantenerse en sincronía con
 * `convex/validators.ts`.
 */

export type InternAccessRole = "student" | "professional" | "intern" | "admin";

export type InternAccessInstitutionalStatus = "enabled" | "disabled" | "pending";

export type InternAccessAccountStatus = "active" | "inactive";

export type InternAccessCaller = {
  readonly role: InternAccessRole;
  readonly institutionalStatus: InternAccessInstitutionalStatus;
  readonly accountStatus: InternAccessAccountStatus;
  readonly hasActiveProfessionalAssignment: boolean;
};

export type InternAccessTarget = {
  readonly role: InternAccessRole;
  readonly institutionalStatus: InternAccessInstitutionalStatus;
  readonly accountStatus: InternAccessAccountStatus;
};

export type InternAccessRejectionReason =
  | "caller-not-professional"
  | "caller-not-active"
  | "caller-not-assigned"
  | "target-not-intern"
  | "target-not-enabled";

export type InternAccessCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: InternAccessRejectionReason };

export type InternRevokeRejectionReason =
  | "caller-not-professional"
  | "caller-not-active"
  | "caller-not-assigned"
  | "target-not-intern"
  | "target-not-enabled";

export type InternRevokeCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: InternRevokeRejectionReason };

/** Verdadero solo cuando el profesional llamante está autorizado sobre el acompañamiento. */
export function isAuthorizedProfessionalCaller(caller: InternAccessCaller): boolean {
  return (
    caller.role === "professional" &&
    isProfileActive({
      institutionalStatus: caller.institutionalStatus,
      accountStatus: caller.accountStatus,
    }) &&
    caller.hasActiveProfessionalAssignment
  );
}

/**
 * Decisión de concesión de acceso a un Practicante.
 *
 * Exige llamante profesional con cuenta habilitada y vigente y con
 * asignación profesional activa sobre el mismo acompañamiento, y objetivo
 * practicante con cuenta habilitada y vigente. El orden revela primero la
 * falta de permiso del llamante, sin distinguir el estado del objetivo ante
 * quien no está autorizado.
 */
export function checkGrantInternAccess(input: {
  readonly caller: InternAccessCaller;
  readonly target: InternAccessTarget;
}): InternAccessCheck {
  if (input.caller.role !== "professional") {
    return { ok: false, reason: "caller-not-professional" };
  }
  if (
    !isProfileActive({
      institutionalStatus: input.caller.institutionalStatus,
      accountStatus: input.caller.accountStatus,
    })
  ) {
    return { ok: false, reason: "caller-not-active" };
  }
  if (!input.caller.hasActiveProfessionalAssignment) {
    return { ok: false, reason: "caller-not-assigned" };
  }
  if (input.target.role !== "intern") {
    return { ok: false, reason: "target-not-intern" };
  }
  if (
    !isProfileActive({
      institutionalStatus: input.target.institutionalStatus,
      accountStatus: input.target.accountStatus,
    })
  ) {
    return { ok: false, reason: "target-not-enabled" };
  }
  return { ok: true };
}

/**
 * Decisión de retiro o revocación de acceso de un Practicante.
 *
 * Exige el mismo llamante autorizado que la concesión y que el objetivo sea
 * un Practicante con cuenta habilitada y vigente (TI2-28: la operación es
 * sobre un Practicante ya habilitado). Una fila legacy sobre una cuenta no
 * habilitada no se toca por esta vía; la lectura ya la deniega por vigencia.
 */
export function checkRevokeInternAccess(input: {
  readonly caller: InternAccessCaller;
  readonly target: InternAccessTarget;
}): InternRevokeCheck {
  if (input.caller.role !== "professional") {
    return { ok: false, reason: "caller-not-professional" };
  }
  if (
    !isProfileActive({
      institutionalStatus: input.caller.institutionalStatus,
      accountStatus: input.caller.accountStatus,
    })
  ) {
    return { ok: false, reason: "caller-not-active" };
  }
  if (!input.caller.hasActiveProfessionalAssignment) {
    return { ok: false, reason: "caller-not-assigned" };
  }
  if (input.target.role !== "intern") {
    return { ok: false, reason: "target-not-intern" };
  }
  if (
    !isProfileActive({
      institutionalStatus: input.target.institutionalStatus,
      accountStatus: input.target.accountStatus,
    })
  ) {
    return { ok: false, reason: "target-not-enabled" };
  }
  return { ok: true };
}
