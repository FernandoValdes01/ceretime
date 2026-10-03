import {
  canReadInternalNote,
  getAccompanimentView,
  type AccompanimentView,
  type AccountStatus,
  type AuthorizationContext,
  type InstitutionalStatus,
  type Role,
} from "../../domain/authorization/permissions";
import {
  UNAUTHORIZED_ERROR_CODE,
  UNAUTHORIZED_ERROR_MESSAGE,
  unauthorizedError,
  type PublicApiError,
} from "../../domain/errors/api_error";

/**
 * Caso de uso de autorización por alcance (S2, TI2-88).
 *
 * Capa de Aplicación: construye el contexto desde documentos ya recuperados
 * en Presentación y delega la decisión en Dominio. No acepta identificadores
 * del cliente como prueba: `callerUserId` siempre sale del perfil vinculado a
 * `ctx.auth.getUserIdentity().tokenIdentifier` en el servidor.
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
