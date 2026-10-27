import type { AccompanimentStatus } from "../../domain/accompaniments/accompaniment";
import {
  appointmentCancellationTarget,
  canBookAppointment,
  canEditAvailability,
  canReadAvailability,
  canReadInternalNote,
  canReadSpaceCatalog,
  canRescheduleAppointment,
  getAccompanimentView,
  type AccompanimentView,
  type AccountStatus,
  type AgendaAuthorizationContext,
  type AppointmentCancellationTarget,
  type AppointmentChangeAuthorizationContext,
  type AuthorizationContext,
  type InstitutionalStatus,
  type Role,
} from "../../domain/authorization/permissions";
import {
  errResult,
  okResult,
  UNAUTHORIZED_ERROR_CODE,
  UNAUTHORIZED_ERROR_MESSAGE,
  unauthorizedError,
  type ApiResult,
  type PublicApiError,
} from "../../domain/errors/api_error";

/**
 * Caso de uso de autorización por alcance (S2, TI2-88).
 *
 * Capa de Aplicación: construye el contexto desde documentos ya recuperados
 * en Presentación y delega la decisión en Dominio. No acepta identificadores
 * del cliente como prueba: `callerUserId` siempre sale del perfil vinculado a
 * `ctx.auth.getUserIdentity().tokenIdentifier` en el servidor. La agenda
 * (TI2-86) arma el mismo contexto con las lecturas del puerto
 * `AuthorizationReader`.
 *
 * Módulo puro: trabaja con tipos y políticas sin importar Convex. La
 * autorización contextual queda acá; la traducción al borde Convex vive en
 * Presentación para que disponibilidad, espacios y atención no dependan de
 * autorización para adaptar sus respuestas.
 */

/** Mensaje genérico único para cualquier denegación, sin exponer el motivo. */
export const AUTHORIZATION_DENIED_MESSAGE = UNAUTHORIZED_ERROR_MESSAGE;

/** Código estable de acceso denegado del contrato público común (TI2-88). */
export const AUTHORIZATION_DENIED_CODE = UNAUTHORIZED_ERROR_CODE;

/**
 * Error público de acceso denegado, sin motivo ni existencia del recurso.
 *
 * Reutiliza el contrato común del dominio sin una segunda fábrica: es el
 * mismo `{code: "unauthorized", message: "No autorizado"}` de
 * `unauthorizedError()`.
 */
export function deniedPublicError(): PublicApiError {
  return unauthorizedError();
}

export type AuthorizableProfile = {
  readonly _id: string;
  readonly role: Role;
  readonly institutionalStatus: InstitutionalStatus;
  readonly accountStatus: AccountStatus;
};

export type AuthorizableAccompaniment = {
  readonly _id: string;
  readonly studentId: string;
};

export type AuthorizableAssignment = {
  readonly accompanimentId: string;
  readonly userId: string;
  readonly assignedRole: "professional" | "intern";
  readonly status: "active" | "revoked";
};

export function buildAuthorizationContext(input: {
  readonly profile: AuthorizableProfile;
  readonly accompaniment: AuthorizableAccompaniment;
  readonly assignments: ReadonlyArray<AuthorizableAssignment>;
}): AuthorizationContext {
  const callerId = input.profile._id;
  const accompanimentId = input.accompaniment._id;
  return {
    role: input.profile.role,
    institutionalStatus: input.profile.institutionalStatus,
    accountStatus: input.profile.accountStatus,
    isOwner: input.accompaniment.studentId === callerId,
    hasActiveProfessionalAssignment: input.assignments.some(
      (assignment) =>
        assignment.accompanimentId === accompanimentId &&
        assignment.userId === callerId &&
        assignment.assignedRole === "professional" &&
        assignment.status === "active",
    ),
    hasActiveInternAssignment: input.assignments.some(
      (assignment) =>
        assignment.accompanimentId === accompanimentId &&
        assignment.userId === callerId &&
        assignment.assignedRole === "intern" &&
        assignment.status === "active",
    ),
  };
}

/** Vista permitida o `null` cuando se deniega. */
export function authorizeAccompanimentRead(input: {
  readonly profile: AuthorizableProfile;
  readonly accompaniment: AuthorizableAccompaniment;
  readonly assignments: ReadonlyArray<AuthorizableAssignment>;
}): AccompanimentView | null {
  return getAccompanimentView(buildAuthorizationContext(input));
}

/** Verdadero solo cuando el perfil puede leer notas internas. */
export function authorizeInternalNoteRead(input: {
  readonly profile: AuthorizableProfile;
  readonly accompaniment: AuthorizableAccompaniment;
  readonly assignments: ReadonlyArray<AuthorizableAssignment>;
}): boolean {
  return canReadInternalNote(buildAuthorizationContext(input));
}

/**
 * Alcance de listado según el rol, para que Presentación solo adapte.
 * Estudiante lista lo propio, Profesional y Practicante lo asignado en su
 * rol, y Administrador no lista nada (sin acceso general).
 */
export type ListingScope =
  | { readonly kind: "owned" }
  | { readonly kind: "assigned"; readonly assignedRole: "professional" | "intern" }
  | { readonly kind: "denied" };

export function listingScopeForRole(role: Role): ListingScope {
  switch (role) {
    case "student":
      return { kind: "owned" };
    case "professional":
      return { kind: "assigned", assignedRole: "professional" };
    case "intern":
      return { kind: "assigned", assignedRole: "intern" };
    case "admin":
      return { kind: "denied" };
  }
}

/** Acompañamiento con su estado, para las operaciones de agenda (TI2-86). */
export type AuthorizableAgendaAccompaniment = AuthorizableAccompaniment & {
  readonly status: AccompanimentStatus;
};

/**
 * Puerto de las lecturas que necesita la autorización de agenda (TI2-86).
 *
 * Infraestructura lo cumple con `authorizationReader(ctx)`; los casos de uso
 * de disponibilidad y reserva lo reciben por parámetro, así que se prueban
 * con un doble sin esperar los repositorios de agenda. Cada llamada vuelve a
 * leer las asignaciones vigentes: una revocación corta el acceso en la
 * operación siguiente. La reserva usa `getProfileById` para revalidar al
 * Profesional elegido, no solo al usuario que llama.
 */
export interface AuthorizationReader {
  findProfileByTokenIdentifier(tokenIdentifier: string): Promise<AuthorizableProfile | null>;
  getProfileById(userId: string): Promise<AuthorizableProfile | null>;
  getAccompaniment(accompanimentId: string): Promise<AuthorizableAgendaAccompaniment | null>;
  findActiveAssignments(
    accompanimentId: string,
    userId: string,
  ): Promise<ReadonlyArray<AuthorizableAssignment>>;
}

/**
 * Autorización concedida. `callerId` es el perfil vinculado a la identidad
 * del servidor: el caso de uso lo usa como actor y nunca toma un `userId`
 * del cliente.
 */
export type AgendaGrant = { readonly callerId: string };

/** Lectura de atenciones concedida, con la vista que corresponde al rol. */
export type AppointmentReadGrant = AgendaGrant & { readonly view: AccompanimentView };

/**
 * Atención concreta que se quiere cambiar. `_id`, `studentId` y
 * `professionalId` salen de la fila leída en el servidor, nunca del cliente:
 * son la pertenencia que la autorización contextual revalida.
 */
export type AuthorizableAppointment = {
  readonly _id: string;
  readonly accompanimentId: string;
  readonly studentId: string;
  readonly professionalId: string;
};

/** Rol efectivo del actor en el cambio: decide el destino de la cancelación. */
export type AppointmentChangeActor = "student" | "professional";

/** Cambio concedido: el actor sale siempre de la sesión del servidor. */
export type AppointmentChangeGrant = AgendaGrant & {
  readonly actor: AppointmentChangeActor;
};

/** Cancelación concedida, con el estado destino que corresponde al actor. */
export type AppointmentCancellationGrant = AppointmentChangeGrant & {
  readonly target: AppointmentCancellationTarget;
};

/** Cambio de una atención concreta: identidad de sesión más la fila leída. */
export type AppointmentChangeRequest = {
  readonly tokenIdentifier: string | null;
  readonly appointment: AuthorizableAppointment;
};

/**
 * `tokenIdentifier` sale de `ctx.auth.getUserIdentity()` en el servidor, o es
 * `null` sin sesión.
 */
export type AgendaRequest = {
  readonly tokenIdentifier: string | null;
  readonly accompanimentId: string;
};

function denied<T>(): ApiResult<T> {
  return errResult(deniedPublicError());
}

async function findCaller(
  reader: AuthorizationReader,
  tokenIdentifier: string | null,
): Promise<AuthorizableProfile | null> {
  return tokenIdentifier === null
    ? null
    : await reader.findProfileByTokenIdentifier(tokenIdentifier);
}

/**
 * Contexto de agenda, o `null` sin identidad, perfil o acompañamiento. Que
 * falte cualquiera se deniega igual que un acompañamiento ajeno.
 */
async function loadAgendaContext(
  reader: AuthorizationReader,
  request: AgendaRequest,
): Promise<{ readonly callerId: string; readonly context: AgendaAuthorizationContext } | null> {
  const profile = await findCaller(reader, request.tokenIdentifier);
  if (profile === null) return null;
  const accompaniment = await reader.getAccompaniment(request.accompanimentId);
  if (accompaniment === null) return null;
  const assignments = await reader.findActiveAssignments(accompaniment._id, profile._id);
  return {
    callerId: profile._id,
    context: {
      ...buildAuthorizationContext({ profile, accompaniment, assignments }),
      accompanimentStatus: accompaniment.status,
    },
  };
}

/**
 * Edición de bloques y excepciones. `professionalId` es el dueño de la
 * disponibilidad que se quiere editar, no la identidad: se compara con el
 * perfil del servidor y solo coincide cuando el Profesional edita lo suyo.
 *
 * Nunca sale del cliente. Al editar un bloque o una excepción existente es
 * el `professionalId` guardado en esa fila, leído en el servidor. Al crear no
 * hay fila: se pasa `null` y el dueño de lo creado es `auth.data.callerId`.
 * Un `professionalId` del cliente junto con un `blockId` también del cliente
 * autorizaría editar la disponibilidad de otro.
 */
export async function authorizeAvailabilityEdit(
  reader: AuthorizationReader,
  request: { readonly tokenIdentifier: string | null; readonly professionalId: string | null },
): Promise<ApiResult<AgendaGrant>> {
  const profile = await findCaller(reader, request.tokenIdentifier);
  if (
    profile === null ||
    !canEditAvailability({
      role: profile.role,
      institutionalStatus: profile.institutionalStatus,
      accountStatus: profile.accountStatus,
      isAvailabilityOwner:
        request.professionalId === null || profile._id === request.professionalId,
    })
  ) {
    return denied();
  }
  return okResult({ callerId: profile._id });
}

/** Consulta de cupos para un acompañamiento activo. */
export async function authorizeAvailabilityRead(
  reader: AuthorizationReader,
  request: AgendaRequest,
): Promise<ApiResult<AgendaGrant>> {
  const loaded = await loadAgendaContext(reader, request);
  if (loaded === null || !canReadAvailability(loaded.context)) return denied();
  return okResult({ callerId: loaded.callerId });
}

/** Lectura de las atenciones del acompañamiento, con la vista del rol. */
export async function authorizeAppointmentRead(
  reader: AuthorizationReader,
  request: AgendaRequest,
): Promise<ApiResult<AppointmentReadGrant>> {
  const loaded = await loadAgendaContext(reader, request);
  const view = loaded === null ? null : getAccompanimentView(loaded.context);
  if (loaded === null || view === null) return denied();
  return okResult({ callerId: loaded.callerId, view });
}

/** Reserva de un cupo en el acompañamiento. */
export async function authorizeAppointmentBook(
  reader: AuthorizationReader,
  request: AgendaRequest,
): Promise<ApiResult<AgendaGrant>> {
  const loaded = await loadAgendaContext(reader, request);
  if (loaded === null || !canBookAppointment(loaded.context)) return denied();
  return okResult({ callerId: loaded.callerId });
}

/**
 * Contexto de cambio de una atención concreta. La fila leída en el servidor
 * aporta la pertenencia: el Estudiante solo opera su propia atención y el
 * Profesional solo la que tiene asignada. Un acompañamiento inexistente,
 * una atención de otro acompañamiento o una identidad sin perfil se deniegan
 * igual, sin revelar cuál faltó.
 */
async function loadAppointmentChangeContext(
  reader: AuthorizationReader,
  request: AppointmentChangeRequest,
): Promise<{
  readonly callerId: string;
  readonly context: AppointmentChangeAuthorizationContext;
} | null> {
  const profile = await findCaller(reader, request.tokenIdentifier);
  if (profile === null) return null;
  const accompaniment = await reader.getAccompaniment(request.appointment.accompanimentId);
  if (accompaniment === null) return null;
  if (request.appointment.accompanimentId !== accompaniment._id) return null;
  const assignments = await reader.findActiveAssignments(accompaniment._id, profile._id);
  const base = buildAuthorizationContext({ profile, accompaniment, assignments });
  return {
    callerId: profile._id,
    context: {
      ...base,
      accompanimentStatus: accompaniment.status,
      isAppointmentStudent:
        request.appointment.studentId === profile._id &&
        accompaniment.studentId === request.appointment.studentId,
      isAppointmentProfessional: request.appointment.professionalId === profile._id,
    },
  };
}

/** Verdadero solo para los roles que pueden cambiar una atención. */
function appointmentChangeActorForRole(role: Role): AppointmentChangeActor | null {
  switch (role) {
    case "student":
      return "student";
    case "professional":
      return "professional";
    case "intern":
    case "admin":
      return null;
  }
}

/**
 * Cancelación de una atención: Estudiante dueño o Profesional que la tiene a
 * su cargo, con acompañamiento activo. El destino (`cancelled_by_student` o
 * `cancelled_by_cereti`) lo decide el rol, no el cliente.
 */
export async function authorizeAppointmentCancel(
  reader: AuthorizationReader,
  request: AppointmentChangeRequest,
): Promise<ApiResult<AppointmentCancellationGrant>> {
  const loaded = await loadAppointmentChangeContext(reader, request);
  if (loaded === null) return denied();
  const target = appointmentCancellationTarget(loaded.context);
  const actor = appointmentChangeActorForRole(loaded.context.role);
  if (target === null || actor === null) return denied();
  return okResult({ callerId: loaded.callerId, actor, target });
}

/** Reagendamiento de una atención, con la misma pertenencia y vigencia. */
export async function authorizeAppointmentReschedule(
  reader: AuthorizationReader,
  request: AppointmentChangeRequest,
): Promise<ApiResult<AppointmentChangeGrant>> {
  const loaded = await loadAppointmentChangeContext(reader, request);
  if (loaded === null || !canRescheduleAppointment(loaded.context)) return denied();
  const actor = appointmentChangeActorForRole(loaded.context.role);
  if (actor === null) return denied();
  return okResult({ callerId: loaded.callerId, actor });
}

/** Lectura del catálogo de espacios: basta una cuenta vigente de cualquier rol. */
export async function authorizeSpaceCatalogRead(
  reader: AuthorizationReader,
  request: { readonly tokenIdentifier: string | null },
): Promise<ApiResult<AgendaGrant>> {
  const profile = await findCaller(reader, request.tokenIdentifier);
  if (profile === null || !canReadSpaceCatalog(profile)) return denied();
  return okResult({ callerId: profile._id });
}
