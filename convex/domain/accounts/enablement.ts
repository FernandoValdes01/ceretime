import { isInstitutionalEmail, normalizeEmail } from "../auth/institutional_domain";

/**
 * Dominio puro de habilitación institucional de Practicantes (TI2-11).
 *
 * No importa Convex, React ni variables de entorno: se prueba sin backend.
 * La habilitación de la cuenta y la asignación de un acompañamiento son
 * decisiones distintas (CONTEXT.md): habilitar no concede acceso a ningún
 * acompañamiento, solo deja la cuenta en condiciones de operar.
 *
 * Roles provisionales: `student`, `professional`, `intern` y `admin`. Los
 * literales deben mantenerse en sincronía con `convex/validators.ts`.
 */

export type EnablementRole = "student" | "professional" | "intern" | "admin";

export type EnablementInstitutionalStatus = "enabled" | "disabled" | "pending";

export type EnablementAccountStatus = "active" | "inactive";

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
  | "target-email-not-institutional"
  | "target-account-not-active"
  | "target-not-pending"
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
