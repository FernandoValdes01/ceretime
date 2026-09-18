/**
 * Identidad, roles y habilitación institucional (TI2-8).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`, para que Web y
 * Mobile puedan consumirlo sin levantar el backend. Esta es la única fuente
 * de los literales de rol y estado; `convex/validators.ts` los convierte a
 * validadores en el borde que conecta con la base de datos y la API.
 */

/** Los cuatro roles institucionales de Sprint 1. */
export const ROLE_VALUES = ["student", "professional", "intern", "admin"] as const;

export type Role = (typeof ROLE_VALUES)[number];

/** Estado de habilitación institucional (ej. matrícula o contrato vigente). */
export const INSTITUTIONAL_STATUS_VALUES = ["enabled", "disabled", "pending"] as const;

export type InstitutionalStatus = (typeof INSTITUTIONAL_STATUS_VALUES)[number];

/** Estado de la cuenta dentro de la plataforma. */
export const ACCOUNT_STATUS_VALUES = ["active", "inactive"] as const;

export type AccountStatus = (typeof ACCOUNT_STATUS_VALUES)[number];

/**
 * Habilitación institucional mínima requerida para operar en la plataforma.
 * Separada del perfil para que Web/Mobile puedan chequearla sin cargar
 * todo el perfil autenticado.
 */
export interface AccountEnablement {
  institutionalStatus: InstitutionalStatus;
  accountStatus: AccountStatus;
}

/**
 * Identidad/perfil autenticado mínimo que Web y Mobile necesitan para
 * renderizar UI condicionada por rol y estado de habilitación.
 * No incluye agenda, privacidad ni auditoría (fuera de alcance de Sprint 1).
 */
export interface AuthenticatedProfile extends AccountEnablement {
  fullName: string;
  email: string;
  role: Role;
}
