import {
  canReadInternalNote,
  getAccompanimentView,
  type AccompanimentView,
  type AccountStatus,
  type AuthorizationContext,
  type InstitutionalStatus,
  type Role,
} from "../../domain/authorization/permissions";

/**
 * Caso de uso de autorización por alcance (S2).
 *
 * Capa de Aplicación: construye el contexto desde documentos ya recuperados
 * en Presentación y delega la decisión en Dominio. No acepta identificadores
 * del cliente como prueba: `callerUserId` siempre sale del perfil vinculado a
 * `ctx.auth.getUserIdentity().tokenIdentifier` en el servidor.
 */

/** Mensaje genérico único para cualquier denegación, sin exponer el motivo. */
export const AUTHORIZATION_DENIED_MESSAGE = "No autorizado";

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
