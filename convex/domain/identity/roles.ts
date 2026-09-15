/**
 * Identidad, roles y habilitación institucional (TI2-8).
 *
 * Deriva los tipos desde los validadores de Convex (`convex/validators.ts`)
 * para no duplicar los literales de rol en una segunda fuente de verdad.
 */
import type { Infer } from "convex/values";
import type { accountStatusUnion, institutionalStatusUnion, roleUnion } from "../../validators";

/** Los cuatro roles institucionales de Sprint 1. */
export type Role = Infer<typeof roleUnion>;

/** Estado de habilitación institucional (ej. matrícula o contrato vigente). */
export type InstitutionalStatus = Infer<typeof institutionalStatusUnion>;

/** Estado de la cuenta dentro de la plataforma. */
export type AccountStatus = Infer<typeof accountStatusUnion>;

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
