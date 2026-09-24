import type { StaffRole } from "../session/session-state.ts";

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
