import { isInstitutionalEmail, normalizeEmail } from "../auth/institutional_domain";
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
  | "caller-not-active"
  | "target-not-intern"
  | "target-not-staff"
  | "target-email-not-institutional"
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

/** Roles que administra TI2-137: profesional y administrador. */
export type StaffRole = "professional" | "admin";

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
 * una revocación); rechaza la cuenta ya habilitada para no sobrescribir la
 * auditoría. El correo debe ser institucional y la cuenta debe estar vigente
 * (`active`). El administrador exige correo de personal (`@uct.cl`); el
 * profesional acepta cualquier correo institucional (`@uct.cl` o
 * `@alu.uct.cl`, este último solo como profesional de prueba RN-25). Jamás
 * cambia el rol. El practicante no entra por esta vía: lo habilita el flujo
 * de TI2-140.
 */
export function validateStaffEnablementTarget(target: StaffEnablementTarget): EnablementCheck {
  if (target.role !== "professional" && target.role !== "admin") {
    return { ok: false, reason: "target-not-staff" };
  }
  const normalized = normalizeEmail(target.email);
  if (target.role === "admin") {
    if (!isInstitutionalEmail(normalized) || !normalized.endsWith("@uct.cl")) {
      return { ok: false, reason: "target-email-not-institutional" };
    }
  } else if (!isInstitutionalEmail(normalized)) {
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

/** Decisión completa de habilitación profesional o administrativa (TI2-137). */
export function checkStaffEnablement(input: {
  readonly caller: EnablementCaller;
  readonly target: StaffEnablementTarget;
}): EnablementCheck {
  if (input.caller.role !== "admin") return { ok: false, reason: "caller-not-admin" };
  if (input.caller.institutionalStatus !== "enabled" || input.caller.accountStatus !== "active") {
    return { ok: false, reason: "caller-not-active" };
  }
  return validateStaffEnablementTarget(input.target);
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

/** Decisión completa de revocación profesional o administrativa (TI2-137). */
export function checkStaffRevocation(input: {
  readonly caller: EnablementCaller;
  readonly target: StaffEnablementTarget;
}): EnablementCheck {
  if (input.caller.role !== "admin") return { ok: false, reason: "caller-not-admin" };
  if (input.caller.institutionalStatus !== "enabled" || input.caller.accountStatus !== "active") {
    return { ok: false, reason: "caller-not-active" };
  }
  return validateStaffRevocationTarget(input.target);
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
