/**
 * Matriz de permisos por rol y caso de uso: acompañamientos y notas internas
 * (base S2) y agenda (TI2-86).
 *
 * Dominio puro: no importa Convex, React ni variables de entorno, para poder
 * probarse sin levantar el backend (RNF-19).
 *
 * Los literales de rol y estado viven en `../identity/roles` y la vista de
 * lectura en `../accompaniments/accompaniment`; este módulo no los duplica.
 *
 * Fuentes: `docs/especificacion-prototipo.md` (tabla de accesos mínimos y
 * "Agenda y atenciones"), `CONTEXT.md` (Practicante con acceso restringido y
 * minimizado, Administrador sin acceso irrestricto) y requerimientos RF-10,
 * RF-12, RF-13, RF-15, RF-23, RF-38, RF-39, RN-06, RN-08, RN-25, RN-26,
 * RNF-08, RNF-17.
 */

import type { AccompanimentStatus, AccompanimentView } from "../accompaniments/accompaniment";
import type { AccountStatus, InstitutionalStatus, Role } from "../identity/roles";

export type { AccompanimentView } from "../accompaniments/accompaniment";
export type { AccountStatus, InstitutionalStatus, Role } from "../identity/roles";

/** Casos de uso cubiertos por la matriz, en el orden de `PERMISSION_MATRIX`. */
export const AUTHORIZATION_ACTIONS = [
  "accompaniment:read",
  "internalNote:read",
  "availability:edit",
  "availability:read",
  "appointment:read",
  "appointment:book",
  "space:read",
] as const;

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

/**
 * Operación de agenda sobre un acompañamiento: el mismo contexto de lectura
 * más el estado, porque la agenda es subordinada y solo un acompañamiento
 * activo admite consultar cupos o reservar.
 */
export type AgendaAuthorizationContext = AuthorizationContext & {
  readonly accompanimentStatus: AccompanimentStatus;
};

/**
 * Edición de disponibilidad, que no depende de un acompañamiento.
 * `isCalendarOwner` es verdadero cuando los bloques o excepciones son del
 * mismo usuario que llama.
 */
export type CalendarAuthorizationContext = {
  readonly role: Role;
  readonly institutionalStatus: InstitutionalStatus;
  readonly accountStatus: AccountStatus;
  readonly isCalendarOwner: boolean;
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
 *
 * Las atenciones del acompañamiento (`appointment:read`) usan esta misma
 * vista, sin regla propia. No mira el estado: el historial de un
 * acompañamiento pausado o cerrado se sigue leyendo.
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
 * Edición de bloques y excepciones: solo el Profesional vigente sobre su
 * propio calendario (RF-12). Poder consultar cupos para un acompañamiento no
 * habilita editar el calendario de nadie. Leer y gestionar el calendario
 * propio (bloques y excepciones del mismo Profesional) usa esta misma regla;
 * `availability:read` es solo para consultar cupos de un acompañamiento.
 */
export function canEditAvailability(context: CalendarAuthorizationContext): boolean {
  if (!isProfileActive(context)) return false;
  return context.role === "professional" && context.isCalendarOwner;
}

/**
 * Consulta de cupos para un acompañamiento activo: el Estudiante dueño o el
 * Profesional con asignación activa. El Practicante no consulta cupos aunque
 * esté asignado: se filtran por necesidades de acceso, que su vista
 * minimizada oculta.
 */
export function canReadAvailability(context: AgendaAuthorizationContext): boolean {
  if (!isProfileActive(context) || context.accompanimentStatus !== "active") return false;
  switch (context.role) {
    case "student":
      return context.isOwner;
    case "professional":
      return context.hasActiveProfessionalAssignment;
    case "intern":
    case "admin":
      return false;
  }
}

/**
 * Reserva de un cupo: solo el Estudiante dueño de un acompañamiento activo
 * (RF-15). La coordinación entre varios profesionales (RF-16) queda fuera.
 */
export function canBookAppointment(context: AgendaAuthorizationContext): boolean {
  if (!isProfileActive(context)) return false;
  return context.role === "student" && context.isOwner && context.accompanimentStatus === "active";
}

/**
 * Catálogo de espacios: cualquier rol con cuenta habilitada y vigente. No
 * trae datos personales ni da acceso a acompañamientos, pero el dominio
 * institucional por sí solo no basta (RN-06).
 */
export function canReadSpaceCatalog(input: {
  readonly institutionalStatus: InstitutionalStatus;
  readonly accountStatus: AccountStatus;
}): boolean {
  return isProfileActive(input);
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
  {
    action: "availability:edit",
    student: "denegado",
    professional: "permitido solo su propio calendario",
    intern: "denegado",
    admin: "denegado",
  },
  {
    action: "availability:read",
    student: "permitido solo propios con acompañamiento activo",
    professional: "permitido solo asignados activos con acompañamiento activo",
    intern: "denegado aunque tenga asignación",
    admin: "denegado sin acceso general",
  },
  {
    action: "appointment:read",
    student: "full solo propios",
    professional: "full solo asignados activos",
    intern: "minimized solo asignados activos",
    admin: "denegado sin acceso general",
  },
  {
    action: "appointment:book",
    student: "permitido solo propios con acompañamiento activo",
    professional: "denegado",
    intern: "denegado",
    admin: "denegado",
  },
  {
    action: "space:read",
    student: "permitido con cuenta vigente",
    professional: "permitido con cuenta vigente",
    intern: "permitido con cuenta vigente",
    admin: "permitido con cuenta vigente",
  },
];
