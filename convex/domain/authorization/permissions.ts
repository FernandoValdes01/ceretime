/**
 * Matriz base de permisos por rol y caso de uso (S2).
 *
 * Dominio puro: no importa Convex, React ni variables de entorno, para poder
 * probarse sin levantar el backend (RNF-19).
 *
 * Los literales de rol y estado viven en `../identity/roles` y la vista de
 * lectura en `../accompaniment/accompaniment`; este módulo no los duplica.
 *
 * Fuentes: `docs/especificacion-prototipo.md` (tabla de accesos mínimos),
 * `CONTEXT.md` (Practicante con acceso restringido y minimizado,
 * Administrador sin acceso irrestricto) y requerimientos RF-10, RF-23,
 * RF-38, RF-39, RN-06, RN-08, RN-25, RN-26, RNF-08, RNF-17.
 */

import type { AccompanimentView } from "../accompaniment/accompaniment";
import type { AccountStatus, InstitutionalStatus, Role } from "../identity/roles";

export type { AccompanimentView } from "../accompaniment/accompaniment";
export type { AccountStatus, InstitutionalStatus, Role } from "../identity/roles";

/** Casos de uso cubiertos por la matriz base S2. */
export const AUTHORIZATION_ACTIONS = ["accompaniment:read", "internalNote:read"] as const;

export type AuthorizationAction = (typeof AUTHORIZATION_ACTIONS)[number];

/**
 * Contexto mínimo para decidir. `isOwner` es verdadero cuando el
 * acompañamiento pertenece al estudiante que consulta. Las asignaciones solo
 * cuentan cuando están activas (`status === "active"`); una asignación
 * revocada no autoriza.
 */
export type AuthorizationContext = {
  readonly role: Role;
  readonly institutionalStatus: InstitutionalStatus;
  readonly accountStatus: AccountStatus;
  readonly isOwner: boolean;
  readonly hasActiveProfessionalAssignment: boolean;
  readonly hasActiveInternAssignment: boolean;
};

/** La cuenta debe estar habilitada y vigente para cualquier operación. */
export function isProfileActive(input: {
  readonly institutionalStatus: InstitutionalStatus;
  readonly accountStatus: AccountStatus;
}): boolean {
  return input.institutionalStatus === "enabled" && input.accountStatus === "active";
}

/**
 * Vista permitida de un acompañamiento o `null` cuando se deniega.
 *
 * - Estudiante: solo sus propios acompañamientos, vista completa.
 * - Profesional: solo acompañamientos con asignación activa como profesional,
 *   vista completa.
 * - Practicante: solo acompañamientos con asignación activa como practicante,
 *   vista minimizada (sin necesidades de acceso ni notas internas).
 * - Administrador: siempre denegado, sin acceso general a acompañamientos.
 */
export function getAccompanimentView(context: AuthorizationContext): AccompanimentView | null {
  if (!isProfileActive(context)) return null;
  switch (context.role) {
    case "student":
      return context.isOwner ? "full" : null;
    case "professional":
      return context.hasActiveProfessionalAssignment ? "full" : null;
    case "intern":
      return context.hasActiveInternAssignment ? "minimized" : null;
    case "admin":
      return null;
  }
}

/**
 * Permiso de lectura de notas internas breves.
 *
 * Solo el Profesional con asignación activa puede leerlas. El Estudiante no
 * las ve aunque sea dueño del acompañamiento, el Practicante no las ve aunque
 * tenga asignación y el Administrador no las ve por defecto (RNF-17).
 */
export function canReadInternalNote(context: AuthorizationContext): boolean {
  if (!isProfileActive(context)) return false;
  return context.role === "professional" && context.hasActiveProfessionalAssignment;
}

/**
 * Matriz explícita para documentación y revisión con CERETI. Cada celda indica
 * el resultado esperado en Backend; la UI no sustituye esta decisión (RN-08).
 */
export const PERMISSION_MATRIX: ReadonlyArray<{
  readonly action: AuthorizationAction;
  readonly student: string;
  readonly professional: string;
  readonly intern: string;
  readonly admin: string;
}> = [
  {
    action: "accompaniment:read",
    student: "full solo propios",
    professional: "full solo asignados activos",
    intern: "minimized solo asignados activos",
    admin: "denegado sin acceso general",
  },
  {
    action: "internalNote:read",
    student: "denegado",
    professional: "permitido solo asignados activos",
    intern: "denegado",
    admin: "denegado por defecto",
  },
];
