import { ConvexError } from "convex/values";
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
 * La autorización contextual queda acá: Dominio no importa Convex y la base
 * de datos y los servicios externos viven en Infraestructura. Presentación
 * solo valida la entrada, resuelve la identidad y delega.
 */

/** Mensaje genérico único para cualquier denegación, sin exponer el motivo. */
export const AUTHORIZATION_DENIED_MESSAGE = UNAUTHORIZED_ERROR_MESSAGE;

/** Código estable de acceso denegado del contrato público común (TI2-88). */
export const AUTHORIZATION_DENIED_CODE = UNAUTHORIZED_ERROR_CODE;

/** Error público de acceso denegado, sin motivo ni existencia del recurso. */
export function deniedPublicError(): PublicApiError {
  return { code: AUTHORIZATION_DENIED_CODE, message: AUTHORIZATION_DENIED_MESSAGE };
}

/**
 * Denegación de Sprint 1 para reutilizar en endpoints nuevos y existentes.
 *
 * Lanza el mismo `ConvexError("No autorizado")` sin revelar si el recurso
 * existe o a quién pertenece. Se conserva para compatibilidad: los clientes
 * distinguen por código en el contrato común, nunca interpretando el texto.
 */
export function denyUnauthorized(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

/**
 * Traducción segura del borde Convex para endpoints nuevos (TI2-88).
 *
 * Convierte un `PublicApiError` del dominio en `ConvexError({code, message})`
 * con solo esas dos claves, sin pila, identificadores de terceros,
 * necesidades ni notas. Conflicto (`conflict`) y ausencia de cupo
 * (`no_availability`) usan códigos distintos sin filtrar la existencia de
 * recursos; la ausencia de cupo se coordina por el canal oficial con la
 * referencia mínima ya entregada, sin crear una reserva incompatible.
 * Todos los endpoints nuevos de disponibilidad, espacios y atención la
 * reutilizan en vez de inventar su propia forma de error.
 */
export function toSecureConvexError(
  error: PublicApiError,
): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code: error.code, message: error.message });
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
