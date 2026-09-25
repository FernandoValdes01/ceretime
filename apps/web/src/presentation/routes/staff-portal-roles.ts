import type {
  StaffRole,
  WebSessionAndRole,
  WebSessionRole,
  WebSessionState,
} from "../session/session-state.ts";

/**
 * Roles y hogares de los portales del personal (TI2-20).
 *
 * Viven acá (y no junto a los componentes de `staff-portals.tsx`) por la
 * regla de fast refresh: ese archivo solo exporta componentes.
 */

/** Roles con portal propio en Sprint 1. */
export const PROFESSIONAL_ROLES: ReadonlyArray<StaffRole> = ["professional"];
export const PRACTITIONER_ROLES: ReadonlyArray<StaffRole> = ["intern"];
export const ADMIN_ROLES: ReadonlyArray<StaffRole> = ["admin"];

/** Portal de cada rol con área propia; `null` sin portal (p. ej. Estudiante). */
export const STAFF_HOME_BY_ROLE: Partial<Record<StaffRole, string>> = {
  professional: "/profesional",
  intern: "/practicante",
  admin: "/administrador",
};

export function staffHomeForRole(role: StaffRole): string | null {
  return STAFF_HOME_BY_ROLE[role] ?? null;
}

/**
 * Confirmación cruzada entre la suscripción independiente de sesión y el
 * par sesión y rol (TI2-20): ambas deben describir a la misma sesión. Si el
 * par aún trae otra sesión (revalidación en curso tras un cambio de
 * cuenta), no está confirmado y el guard espera sin renderizar ni navegar.
 * Compara los correos de identidad, nunca el guardado en el perfil (el
 * arranque admite ambos independientes).
 */
export function isPairCurrent(session: WebSessionState, pair: WebSessionAndRole): boolean {
  if (session === undefined || pair === undefined) {
    return false;
  }
  if (session.status === "unauthenticated") {
    return pair.session.status === "unauthenticated";
  }
  return pair.session.status === "authenticated" && pair.session.email === session.email;
}

/**
 * Verdadero con rol autenticado del personal (TI2-20): Profesional,
 * Practicante o Administrador. Un Estudiante o una fila sin rol no son
 * personal, y un valor pendiente tampoco concede.
 */
export function isStaffRole(role: WebSessionRole): boolean {
  return role?.status === "authenticated" && role.role !== "student";
}
