import {
  getInstitutionalPopulation,
  isInstitutionalEmail,
  normalizeEmail,
} from "../auth/institutional_domain";
import type { AccountStatus, InstitutionalStatus, Role } from "../identity/roles";

/**
 * Dominio puro de habilitación institucional de Practicantes (TI2-11).
 *
 * No importa Convex, React ni variables de entorno: se prueba sin backend.
 * La habilitación de la cuenta y la asignación de un acompañamiento son
 * decisiones distintas (CONTEXT.md): habilitar no concede acceso a ningún
 * acompañamiento, solo deja la cuenta en condiciones de operar.
 *
 * Los literales de rol y estado viven una sola vez en
 * `convex/domain/identity/roles` (TI2-8): estos alias conservan los nombres
 * de TI2-11 sin duplicar la definición.
 */

export type EnablementRole = Role;

export type EnablementInstitutionalStatus = InstitutionalStatus;

export type EnablementAccountStatus = AccountStatus;

export type EnablementCaller = {
  readonly role: EnablementRole;
  readonly institutionalStatus: EnablementInstitutionalStatus;
  readonly accountStatus: EnablementAccountStatus;
};

export type EnablementTarget = {
  readonly role: EnablementRole;
  readonly email: string;
  readonly institutionalStatus: EnablementInstitutionalStatus;
  readonly accountStatus: EnablementAccountStatus;
};

export type EnablementRejectionReason =
  | "caller-not-admin"
  | "caller-not-professional"
  | "caller-not-authorized"
  | "caller-not-active"
  | "target-not-intern"
  | "target-not-staff"
  | "target-not-professional"
  | "target-email-not-institutional"
  | "target-email-not-test"
  | "target-account-not-active"
  | "target-not-pending"
  | "target-not-enabled"
  | "target-already-enabled";

export type EnablementCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: EnablementRejectionReason };

/** Verdadero solo cuando el actor es Administrador con cuenta vigente. */
export function canEnableAsAdmin(caller: EnablementCaller): boolean {
  return (
    caller.role === "admin" &&
    caller.institutionalStatus === "enabled" &&
    caller.accountStatus === "active"
  );
}

/** Verdadero solo cuando el actor es Profesional con cuenta habilitada y vigente (TI2-140). */
export function canEnableAsProfessional(caller: EnablementCaller): boolean {
  return (
    caller.role === "professional" &&
    caller.institutionalStatus === "enabled" &&
    caller.accountStatus === "active"
  );
}

/** Verdadero cuando el actor puede habilitar practicantes: profesional vigente (TI2-140). */
export function canEnableInternAsProfessional(caller: EnablementCaller): boolean {
  return canEnableAsProfessional(caller);
}

/**
 * Valida que el objetivo pueda transitar de `pending` a `enabled`.
 *
 * Solo el rol `intern` se habilita por esta vía: ningún otro rol cambia por
 * aquí y esta operación jamás cambia el rol, por lo que no existe
 * auto-escalamiento a Administrador. El correo debe ser institucional y la
 * cuenta debe estar vigente (`active`); una cuenta ya habilitada se rechaza
 * para no sobrescribir la auditoría original.
 */
export function validateEnablementTarget(target: EnablementTarget): EnablementCheck {
  if (target.role !== "intern") return { ok: false, reason: "target-not-intern" };
  if (!isInstitutionalEmail(normalizeEmail(target.email))) {
    return { ok: false, reason: "target-email-not-institutional" };
  }
  if (target.accountStatus !== "active") {
    return { ok: false, reason: "target-account-not-active" };
  }
  if (target.institutionalStatus === "enabled") {
    return { ok: false, reason: "target-already-enabled" };
  }
  if (target.institutionalStatus !== "pending") {
    return { ok: false, reason: "target-not-pending" };
  }
  return { ok: true };
}

/**
 * Decisión completa de habilitación: actor y objetivo.
 *
 * El orden revela primero la falta de permiso del actor, sin distinguir
 * el estado del objetivo ante quien no administra.
 */
export function checkEnablement(input: {
  readonly caller: EnablementCaller;
  readonly target: EnablementTarget;
}): EnablementCheck {
  if (input.caller.role !== "admin") return { ok: false, reason: "caller-not-admin" };
  if (input.caller.institutionalStatus !== "enabled" || input.caller.accountStatus !== "active") {
    return { ok: false, reason: "caller-not-active" };
  }
  return validateEnablementTarget(input.target);
}

/**
 * Decisión de habilitación de practicante por el profesional (TI2-140, RF-39).
 *
 * El profesional con cuenta habilitada y vigente habilita cuentas de
 * practicante pendientes; habilitar no concede acompañamientos, solo deja la
 * cuenta en condiciones de operar y la asignación posterior la realiza el
 * mismo profesional autorizado sobre el acompañamiento. El orden revela
 * primero la falta de permiso del llamante.
 */
export function checkProfessionalInternEnablement(input: {
  readonly caller: EnablementCaller;
  readonly target: EnablementTarget;
}): EnablementCheck {
  if (input.caller.role !== "professional") {
    return { ok: false, reason: "caller-not-professional" };
  }
  if (input.caller.institutionalStatus !== "enabled" || input.caller.accountStatus !== "active") {
    return { ok: false, reason: "caller-not-active" };
  }
  return validateEnablementTarget(input.target);
}

/** Objetivo cuenta de prueba: profesional con correo estudiantil (TI2-140, RF-38/RN-25). */
export type TestProfessionalTarget = {
  readonly role: Role;
  readonly email: string;
  readonly institutionalStatus: EnablementInstitutionalStatus;
  readonly accountStatus: EnablementAccountStatus;
};

/**
 * Valida que el objetivo pueda operar como profesional de prueba (TI2-140).
 *
 * Exige rol profesional con correo `@alu.uct.cl` (población estudiante), cuenta
 * vigente y estado pendiente o deshabilitado (primera habilitación o
 * rehabilitación). Rechaza la cuenta ya habilitada para no sobrescribir la
 * auditoría. Nunca cambia el rol: un `@alu.uct.cl` solo actúa dentro de
 * acompañamientos explícitamente asignados y auditados (RN-25/RD-11).
 */
export function validateTestProfessionalTarget(target: TestProfessionalTarget): EnablementCheck {
  if (target.role !== "professional") {
    return { ok: false, reason: "target-not-professional" };
  }
  if (getInstitutionalPopulation(target.email) !== "estudiante") {
    return { ok: false, reason: "target-email-not-test" };
  }
  if (!isInstitutionalEmail(normalizeEmail(target.email))) {
    return { ok: false, reason: "target-email-not-institutional" };
  }
  if (target.accountStatus !== "active") {
    return { ok: false, reason: "target-account-not-active" };
  }
  if (target.institutionalStatus === "enabled") {
    return { ok: false, reason: "target-already-enabled" };
  }
  if (target.institutionalStatus !== "pending" && target.institutionalStatus !== "disabled") {
    return { ok: false, reason: "target-not-pending" };
  }
  return { ok: true };
}

/**
 * Decisión de habilitación de cuenta de prueba (TI2-140, RF-38).
 *
 * El administrador vigente o el profesional vigente con cuenta habilitada
 * habilita al profesional de prueba; el orden revela primero la falta de
 * permiso del actor, sin distinguir el estado del objetivo ante quien no
 * administra. Habilitar no concede acompañamientos: el alcance se asigna
 * después por acompañamiento explícito y auditado.
 */
export function checkTestProfessionalEnablement(input: {
  readonly caller: EnablementCaller;
  readonly target: TestProfessionalTarget;
}): EnablementCheck {
  const isAdminActive =
    input.caller.role === "admin" &&
    input.caller.institutionalStatus === "enabled" &&
    input.caller.accountStatus === "active";
  const isProfessionalActive =
    input.caller.role === "professional" &&
    input.caller.institutionalStatus === "enabled" &&
    input.caller.accountStatus === "active";
  if (!isAdminActive && !isProfessionalActive) {
    if (input.caller.role !== "admin" && input.caller.role !== "professional") {
      return { ok: false, reason: "caller-not-authorized" };
    }
    return { ok: false, reason: "caller-not-active" };
  }
  return validateTestProfessionalTarget(input.target);
}

/** Objetivo profesional o administrativo de TI2-137. */
export type StaffEnablementTarget = {
  readonly role: Role;
  readonly email: string;
  readonly institutionalStatus: EnablementInstitutionalStatus;
  readonly accountStatus: EnablementAccountStatus;
};

/**
 * Valida que el objetivo profesional o administrativo pueda transitar a
 * `enabled` (TI2-137).
 *
 * Acepta `pending` (primera habilitación) o `disabled` (rehabilitación tras
 * una revocación, que registra nuevo actor y fecha); rechaza la cuenta ya
 * habilitada. Profesional y administrador exigen correo de personal
 * (`@uct.cl`): un Profesional `@alu.uct.cl` solo opera como cuenta de prueba
 * con alcance por acompañamiento (RN-25/RD-11) y se habilita en TI2-140, no
 * en esta vía general. La cuenta debe estar vigente (`active`) y el rol no
 * cambia jamás. El practicante no entra por esta vía: lo habilita el flujo
 * de TI2-140.
 */
export function validateStaffEnablementTarget(target: StaffEnablementTarget): EnablementCheck {
  if (target.role !== "professional" && target.role !== "admin") {
    return { ok: false, reason: "target-not-staff" };
  }
  if (getInstitutionalPopulation(target.email) !== "personal") {
    return { ok: false, reason: "target-email-not-institutional" };
  }
  if (target.accountStatus !== "active") {
    return { ok: false, reason: "target-account-not-active" };
  }
  if (target.institutionalStatus === "enabled") {
    return { ok: false, reason: "target-already-enabled" };
  }
  return { ok: true };
}

/**
 * Valida que el objetivo profesional o administrativo pueda revocarse
 * (TI2-137).
 *
 * Solo una cuenta en `enabled` y vigente (`active`) se revoca: una cuenta ya
 * `pending`, `disabled` o inactiva no opera y no hay nada que cortar.
 */
export function validateStaffRevocationTarget(target: StaffEnablementTarget): EnablementCheck {
  if (target.role !== "professional" && target.role !== "admin") {
    return { ok: false, reason: "target-not-staff" };
  }
  if (target.accountStatus !== "active") {
    return { ok: false, reason: "target-account-not-active" };
  }
  if (target.institutionalStatus !== "enabled") {
    return { ok: false, reason: "target-not-enabled" };
  }
  return { ok: true };
}

export type BootstrapCandidate = {
  readonly email: string;
  readonly role: EnablementRole;
};

export type BootstrapCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "bootstrap-email-not-institutional" | "bootstrap-role-not-admin";
    };

/**
 * Valida el candidato del arranque administrativo inicial.
 *
 * El arranque solo crea el primer Administrador del entorno con correo
 * institucional `@uct.cl` (personal); nunca crea Practicantes ni otros roles
 * y nunca se ejecuta cuando ya existe una cuenta administrativa. La estructura
 * mínima del correo (parte local no vacía y un solo `@`) la garantiza
 * `isInstitutionalEmail`: el arranque es de un solo uso y un correo
 * inválido como `@uct.cl` o `usuario@@uct.cl` dejaría la cuenta inicial
 * corrupta e incorregible por esta vía.
 */
export function validateBootstrapCandidate(candidate: BootstrapCandidate): BootstrapCheck {
  if (candidate.role !== "admin") return { ok: false, reason: "bootstrap-role-not-admin" };
  const normalized = normalizeEmail(candidate.email);
  if (!isInstitutionalEmail(normalized) || !normalized.endsWith("@uct.cl")) {
    return { ok: false, reason: "bootstrap-email-not-institutional" };
  }
  return { ok: true };
}
