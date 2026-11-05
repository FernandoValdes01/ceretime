export const authRoleIds = ["estudiante", "profesional", "practicante", "administrador"] as const;

export type AuthRole = (typeof authRoleIds)[number];

export interface AuthCredentials {
  readonly email: string;
  readonly password: string;
}

export interface AssignedAccompanimentSummary {
  readonly id: string;
  readonly title: string;
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: AuthRole;
  readonly assignedAccompaniments: readonly AssignedAccompanimentSummary[];
}

export interface AuthSession {
  readonly user: AuthenticatedUser;
}
