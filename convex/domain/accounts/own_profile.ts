import type { InstitutionalPopulation } from "../auth/institutional_domain";
import type { AccountStatus, InstitutionalStatus, Role } from "../identity/roles";

/**
 * Perfil inicial de una cuenta institucional en su primer ingreso (TI2-182).
 *
 * Dominio puro: aplica el ADR 0002. Una cuenta `@alu.uct.cl` entra al portal
 * estudiantil sin trámite previo; una cuenta `@uct.cl` solo opera cuando
 * CERETI la habilita, así que nace pendiente para que el Administrador la
 * habilite por la vía de cuentas. Ninguna de las dos concede acceso a
 * acompañamientos: el Estudiante solo lee lo propio y el personal espera su
 * habilitación. Practicantes y cuentas de prueba siguen naciendo por la vía
 * del operador, porque su rol no se deduce del dominio del correo.
 */
export type InitialProfile = {
  readonly role: Role;
  readonly institutionalStatus: InstitutionalStatus;
  readonly accountStatus: AccountStatus;
};

const INITIAL_PROFILE_BY_POPULATION = {
  estudiante: { role: "student", institutionalStatus: "enabled", accountStatus: "active" },
  personal: { role: "professional", institutionalStatus: "pending", accountStatus: "active" },
} as const satisfies Record<InstitutionalPopulation, InitialProfile>;

export function initialProfileFor(population: InstitutionalPopulation): InitialProfile {
  return INITIAL_PROFILE_BY_POPULATION[population];
}

/**
 * Nombre visible del perfil: el que entrega Google o, si llega vacío, la parte
 * local del correo, para no guardar un perfil sin nombre.
 */
export function profileFullName(name: string, email: string): string {
  const trimmed = name.trim();
  if (trimmed.length > 0) return trimmed;
  return email.slice(0, email.indexOf("@"));
}
