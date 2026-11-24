import {
  HOSTED_DOMAIN_BY_POPULATION,
  type InstitutionalPopulation,
} from "../../../../convex/domain/auth/institutional_domain";

export type { InstitutionalPopulation };

/** Las dos cuentas institucionales de Google: cada una pide al proveedor solo su dominio. */
export const institutionalLogins = (["estudiante", "personal"] as const).map((population) => ({
  population,
  emailSuffix: `@${HOSTED_DOMAIN_BY_POPULATION[population]}`,
}));

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
