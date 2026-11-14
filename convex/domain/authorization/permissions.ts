/**
 * Matriz de permisos por rol y caso de uso: acompañamientos y notas internas
 * (base S2), agenda (TI2-86), seguimiento (TI2-127) y cuentas (TI2-137).
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
import type { AppointmentView } from "../appointments/appointment";
import type { FollowUpView } from "../follow_up/follow_up";
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
  "appointment:cancel",
  "appointment:reschedule",
  "appointment:recordAttendance",
  "appointment:calendar",
  "followUp:read",
  "followUp:write",
  "space:read",
  "space:manage",
  "account:list",
  "account:read",
  "account:enable",
  "account:revoke",
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
 * Operación sobre una atención concreta: el contexto de agenda más la
 * pertenencia de la fila. `isAppointmentStudent` exige que la atención sea del
 * mismo estudiante dueño del acompañamiento; `isAppointmentProfessional`, que
 * el Profesional asignado sea el de esa atención. Un Profesional asignado al
 * acompañamiento no opera la atención de otro profesional.
 */
export type AppointmentChangeAuthorizationContext = AgendaAuthorizationContext & {
  readonly isAppointmentStudent: boolean;
  readonly isAppointmentProfessional: boolean;
};

/** Destino de una cancelación permitida, decidido por el rol del actor. */
export type AppointmentCancellationTarget = "cancelled_by_student" | "cancelled_by_cereti";

/**
 * Edición de disponibilidad, que no depende de un acompañamiento.
 * `isAvailabilityOwner` es verdadero cuando los bloques o excepciones son del
 * mismo usuario que llama.
 */
export type AvailabilityAuthorizationContext = {
  readonly role: Role;
  readonly institutionalStatus: InstitutionalStatus;
  readonly accountStatus: AccountStatus;
  readonly isAvailabilityOwner: boolean;
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
 * Las atenciones y el seguimiento derivan su vista de esta decisión, sin
 * regla de acceso propia. No mira el estado: el historial de un acompañamiento
 * pausado o cerrado se sigue leyendo.
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
 * Vista de las atenciones del acompañamiento (`appointment:read`): la misma
 * decisión de acceso, con la vista compartida para el Estudiante, que no
 * recibe el motivo de cancelación.
 */
export function getAppointmentView(context: AuthorizationContext): AppointmentView | null {
  const view = getAccompanimentView(context);
  if (view === null) return null;
  return context.role === "student" ? "shared" : view;
}

/**
 * Vista del seguimiento: la misma decisión de acceso del acompañamiento. La
 * vista `professional` trae la nota, así que exige también `canReadInternalNote`.
 */
export function getFollowUpView(context: AuthorizationContext): FollowUpView | null {
  const view = getAccompanimentView(context);
  if (view === null) return null;
  if (view === "minimized") return "minimized";
  return canReadInternalNote(context) ? "professional" : "shared";
}

/**
 * Registro de seguimiento: solo el Profesional con asignación activa y con el
 * acompañamiento activo, porque el cierre deja el historial en solo lectura.
 * El Estudiante y el Practicante leen su vista, pero no escriben.
 */
export function canWriteFollowUp(context: AgendaAuthorizationContext): boolean {
  if (!isProfileActive(context) || context.accompanimentStatus !== "active") return false;
  return context.role === "professional" && context.hasActiveProfessionalAssignment;
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
 * propia disponibilidad (RF-12). Poder consultar cupos para un
 * acompañamiento no habilita editar la disponibilidad de nadie. Leer y
 * gestionar la disponibilidad propia (bloques y excepciones del mismo
 * Profesional) usa esta misma regla; `availability:read` es solo para
 * consultar cupos de un acompañamiento.
 */
export function canEditAvailability(context: AvailabilityAuthorizationContext): boolean {
  if (!isProfileActive(context)) return false;
  return context.role === "professional" && context.isAvailabilityOwner;
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
 * (RF-15). La coordinación entre varios profesionales (RF-16) es
 * `canCoordinateAppointment`.
 */
export function canBookAppointment(context: AgendaAuthorizationContext): boolean {
  if (!isProfileActive(context)) return false;
  return context.role === "student" && context.isOwner && context.accompanimentStatus === "active";
}

/**
 * Coordinación de una atención con uno o más profesionales (RF-16, TI2-142):
 * el Profesional con asignación activa en un acompañamiento activo reserva en
 * nombre del Estudiante dueño. Que el Profesional sea uno de los profesionales
 * de la atención lo exige el caso de uso con la selección ya normalizada.
 */
export function canCoordinateAppointment(context: AgendaAuthorizationContext): boolean {
  if (!isProfileActive(context)) return false;
  return (
    context.role === "professional" &&
    context.hasActiveProfessionalAssignment &&
    context.accompanimentStatus === "active"
  );
}

/**
 * Cambio de una atención existente (cancelar o reagendar): el Estudiante dueño
 * de esa atención o el Profesional asignado que la tiene a su cargo, siempre
 * con el acompañamiento activo. Practicante y Administrador no cambian
 * atenciones. La fila se revalida en la misma operación para que una
 * asignación revocada o una atención de otro profesional dejen de autorizar.
 */
function canChangeAppointment(context: AppointmentChangeAuthorizationContext): boolean {
  if (!isProfileActive(context) || context.accompanimentStatus !== "active") return false;
  switch (context.role) {
    case "student":
      return context.isOwner && context.isAppointmentStudent;
    case "professional":
      return context.hasActiveProfessionalAssignment && context.isAppointmentProfessional;
    case "intern":
    case "admin":
      return false;
  }
}

/** Verdadero solo cuando el actor puede cancelar esta atención. */
export function canCancelAppointment(context: AppointmentChangeAuthorizationContext): boolean {
  return canChangeAppointment(context);
}

/**
 * Acceso en línea de una atención (TI2-142): leer el enlace privado o, si es
 * profesional, agregarlo. Exige la misma vigencia que un cambio, pero aquí
 * `isAppointmentProfessional` cuenta a todos los profesionales de la atención,
 * no solo al responsable. Practicante y Administrador se deniegan igual.
 */
export function canUseAppointmentOnlineAccess(
  context: AppointmentChangeAuthorizationContext,
): boolean {
  return canChangeAppointment(context);
}

/**
 * Entrega de la explicación de una inasistencia (TI2-119): solo el Estudiante
 * dueño de esa atención, con perfil vigente y acompañamiento activo. El
 * Profesional asignado, el Practicante y el Administrador se deniegan igual.
 */
export function canSubmitAppointmentJustification(
  context: AppointmentChangeAuthorizationContext,
): boolean {
  if (!isProfileActive(context) || context.accompanimentStatus !== "active") return false;
  return context.role === "student" && context.isOwner && context.isAppointmentStudent;
}

/**
 * Revisión de la justificación de inasistencia (TI2-119): solo el Profesional
 * asignado que tiene la atención a su cargo, con perfil vigente y
 * acompañamiento activo. Una asignación revocada deja de autorizar.
 */
export function canReviewAppointmentJustification(
  context: AppointmentChangeAuthorizationContext,
): boolean {
  if (!isProfileActive(context) || context.accompanimentStatus !== "active") return false;
  return (
    context.role === "professional" &&
    context.hasActiveProfessionalAssignment &&
    context.isAppointmentProfessional
  );
}

/**
 * Destino de la cancelación según el rol: el Estudiante cancela como
 * `cancelled_by_student` y el Profesional como `cancelled_by_cereti`. `null`
 * cuando la operación no está permitida.
 */
export function appointmentCancellationTarget(
  context: AppointmentChangeAuthorizationContext,
): AppointmentCancellationTarget | null {
  if (!canCancelAppointment(context)) return null;
  return context.role === "student" ? "cancelled_by_student" : "cancelled_by_cereti";
}

/** Verdadero solo cuando el actor puede reagendar esta atención. */
export function canRescheduleAppointment(context: AppointmentChangeAuthorizationContext): boolean {
  return canChangeAppointment(context);
}

/**
 * Registro de realización o inasistencia (TI2-110): solo el Profesional
 * asignado que tiene la atención a su cargo, con perfil vigente y
 * acompañamiento activo. El Estudiante dueño no registra el resultado de su
 * propia atención, y Practicante y Administrador tampoco, aunque la fila los
 * nombre: el resultado lo declara quien realizó el encuentro.
 */
export function canRecordAppointmentAttendance(
  context: AppointmentChangeAuthorizationContext,
): boolean {
  if (!isProfileActive(context) || context.accompanimentStatus !== "active") return false;
  return (
    context.role === "professional" &&
    context.hasActiveProfessionalAssignment &&
    context.isAppointmentProfessional
  );
}

/**
 * Evento de calendario de una atención (TI2-122): solo el Estudiante dueño de
 * la atención, con perfil vigente y acompañamiento activo. El Profesional
 * asignado no agrega la atención de otra persona a su calendario, y Practicante
 * y Administrador tampoco. El consentimiento de Google Calendar es personal y
 * se pide por separado del inicio institucional.
 */
export function canAddAppointmentToCalendar(
  context: AppointmentChangeAuthorizationContext,
): boolean {
  if (!isProfileActive(context) || context.accompanimentStatus !== "active") return false;
  return context.role === "student" && context.isAppointmentStudent;
}

/**
 * Profesional elegido para un cupo: rol profesional, cuenta habilitada y
 * vigente y asignación activa sobre el acompañamiento. Que el Estudiante
 * pueda reservar no basta; el recurso profesional se revalida en la misma
 * operación antes de ocupar el cupo.
 */
export function isProfessionalBookable(input: {
  readonly role: Role;
  readonly institutionalStatus: InstitutionalStatus;
  readonly accountStatus: AccountStatus;
  readonly hasActiveProfessionalAssignment: boolean;
}): boolean {
  return (
    input.role === "professional" && isProfileActive(input) && input.hasActiveProfessionalAssignment
  );
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
 * Gestión de cuentas profesionales y administrativas (TI2-137).
 *
 * Solo el Administrador con cuenta habilitada y vigente lista, lee,
 * habilita y revoca cuentas. El dominio institucional por sí solo no
 * concede acceso (RN-06): sin perfil vinculado la respuesta es denegación.
 * Administrar no concede acompañamientos ni notas: esa lectura sigue
 * denegada por `getAccompanimentView` y `canReadInternalNote`.
 */
export type AccountManagementContext = {
  readonly role: Role;
  readonly institutionalStatus: InstitutionalStatus;
  readonly accountStatus: AccountStatus;
};

/** Verdadero solo cuando el actor administra cuentas (TI2-137). */
export function canManageAccounts(context: AccountManagementContext): boolean {
  if (!isProfileActive(context)) return false;
  return context.role === "admin";
}

/** Verdadero solo cuando el actor lista cuentas (TI2-137). */
export function canListAccounts(context: AccountManagementContext): boolean {
  return canManageAccounts(context);
}

/** Verdadero solo cuando el actor lee el detalle mínimo (TI2-137). */
export function canReadAccount(context: AccountManagementContext): boolean {
  return canManageAccounts(context);
}

/** Verdadero solo cuando el actor habilita profesionales o administradores. */
export function canEnableAccount(context: AccountManagementContext): boolean {
  return canManageAccounts(context);
}

/** Verdadero solo cuando el actor revoca profesionales o administradores. */
export function canRevokeAccount(context: AccountManagementContext): boolean {
  return canManageAccounts(context);
}

/**
 * Gestión del catálogo de espacios (TI2-148): solo el Administrador con
 * cuenta habilitada y vigente. Estudiante, Profesional y Practicante se
 * deniegan aunque tengan cuenta vigente: el catálogo publicado se lee, no
 * se administra.
 */
export function canManageSpaceCatalog(input: {
  readonly role: Role;
  readonly institutionalStatus: InstitutionalStatus;
  readonly accountStatus: AccountStatus;
}): boolean {
  return input.role === "admin" && isProfileActive(input);
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
    professional: "permitido solo su propia disponibilidad",
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
    student: "shared solo propios, sin motivo de cancelación",
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
    action: "appointment:cancel",
    student: "permitido solo sus propias atenciones con acompañamiento activo",
    professional: "permitido solo la atención propia asignada, con acompañamiento activo",
    intern: "denegado",
    admin: "denegado",
  },
  {
    action: "appointment:reschedule",
    student: "permitido solo sus propias atenciones con acompañamiento activo",
    professional: "permitido solo la atención propia asignada, con acompañamiento activo",
    intern: "denegado",
    admin: "denegado",
  },
  {
    action: "appointment:recordAttendance",
    student: "denegado aunque sea dueño de la atención",
    professional: "permitido solo la atención propia asignada, con acompañamiento activo",
    intern: "denegado",
    admin: "denegado",
  },
  {
    action: "appointment:calendar",
    student: "permitido solo sus propias atenciones con acompañamiento activo",
    professional: "denegado",
    intern: "denegado",
    admin: "denegado",
  },
  {
    action: "followUp:read",
    student: "shared solo propios, sin nota interna",
    professional: "professional solo asignados activos, con nota interna",
    intern: "minimized solo asignados activos, sin textos libres",
    admin: "denegado sin acceso general",
  },
  {
    action: "followUp:write",
    student: "denegado aunque sea dueño",
    professional: "permitido solo asignados activos con acompañamiento activo",
    intern: "denegado aunque tenga asignación",
    admin: "denegado",
  },
  {
    action: "space:read",
    student: "permitido con cuenta vigente",
    professional: "permitido con cuenta vigente",
    intern: "permitido con cuenta vigente",
    admin: "permitido con cuenta vigente",
  },
  {
    action: "space:manage",
    student: "denegado",
    professional: "denegado",
    intern: "denegado",
    admin: "permitido solo con cuenta vigente",
  },
  {
    action: "account:list",
    student: "denegado, solo su perfil propio",
    professional: "denegado, solo su perfil propio",
    intern: "denegado, solo su perfil propio",
    admin: "permitido con cuenta vigente, detalle mínimo sin acompañamientos",
  },
  {
    action: "account:read",
    student: "denegado, solo su perfil propio",
    professional: "denegado, solo su perfil propio",
    intern: "denegado, solo su perfil propio",
    admin: "permitido con cuenta vigente, detalle mínimo sin acompañamientos",
  },
  {
    action: "account:enable",
    student: "denegado",
    professional: "denegado",
    intern: "denegado",
    admin: "permitido con cuenta vigente, solo profesional o administrador",
  },
  {
    action: "account:revoke",
    student: "denegado",
    professional: "denegado",
    intern: "denegado",
    admin: "permitido con cuenta vigente, solo profesional o administrador",
  },
];
