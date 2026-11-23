import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type {
  AccountStatus,
  InstitutionalStatus,
  Role,
} from "../../../../../convex/domain/index.ts";

/**
 * Lecturas y escrituras de cuentas de personal para Administración (TI2-169).
 *
 * Cableado delgado sobre la API real de TI2-137 (`listAccounts`,
 * `enableAccount` y `revokeAccount`): filtrado por rol con el índice
 * `by_role`, paginado con cursor. Solo el Administrador con cuenta vigente
 * lista, habilita y revoca cuentas de personal; la autorización vive en
 * Convex y la denegación llega como error genérico sin motivo. Habilitar no
 * concede acompañamientos ni notas: la lectura sigue denegada sin asignación.
 *
 * Fuera de alcance: gestión de practicantes (TI2-170) y cuentas de prueba.
 */

/** Tamaño de página del listado; el Backend acota entre 1 y 100. */
export const STAFF_ACCOUNTS_PAGE_SIZE = 10;

export function useStaffAccounts(role: StaffAccountsRole, cursor: string | null) {
  return useQuery(api.presentation.accounts.listAccounts, {
    role,
    paginationOpts: { numItems: STAFF_ACCOUNTS_PAGE_SIZE, cursor },
  });
}

export function useProfessionalAccounts(cursor: string | null) {
  return useStaffAccounts("professional", cursor);
}

export function useAdminAccounts(cursor: string | null) {
  return useStaffAccounts("admin", cursor);
}

/** Habilita una cuenta profesional o administrativa pendiente o revocada. */
export function useEnableStaffAccount() {
  return useMutation(api.presentation.accounts.enableAccount);
}

/** Revoca una cuenta profesional o administrativa habilitada. */
export function useRevokeStaffAccount() {
  return useMutation(api.presentation.accounts.revokeAccount);
}

/** Página paginada de cuentas, derivada del contrato generado (sin duplicar formas). */
export type StaffAccountsPage = NonNullable<
  FunctionReturnType<typeof api.presentation.accounts.listAccounts>
>;

/** Cuenta de personal tal como la entrega el Backend: detalle mínimo. */
export type StaffAccountItem = StaffAccountsPage["page"][number];

/** Identificador de cuenta de personal para habilitar o revocar. */
export type StaffAccountId = Id<"users">;

/** Roles del listado de personal: solo profesional y administración. */
export type StaffAccountsRole = "professional" | "admin";

/**
 * Etiqueta legible del rol de una cuenta de personal.
 *
 * `switch` exhaustivo sobre el contrato: si el Backend agrega un rol, el
 * compilador avisa acá en vez de pintar el código en la pantalla. En
 * ejecución, un valor desconocido se muestra tal cual como último recurso.
 */
export function staffRoleLabel(role: Role): string {
  switch (role) {
    case "professional":
      return "Profesional";
    case "admin":
      return "Administrador";
    case "student":
      return "Estudiante";
    case "intern":
      return "Practicante";
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

/** Etiqueta legible de la habilitación institucional de la cuenta. */
export function staffInstitutionalStatusLabel(status: InstitutionalStatus): string {
  switch (status) {
    case "enabled":
      return "Habilitada";
    case "pending":
      return "Pendiente";
    case "disabled":
      return "Revocada";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** Etiqueta legible de la vigencia de la cuenta en la plataforma. */
export function staffAccountStatusLabel(status: AccountStatus): string {
  switch (status) {
    case "active":
      return "Vigente";
    case "inactive":
      return "No vigente";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** Verdadero cuando la cuenta admite habilitación (no está habilitada). */
export function canEnableStaffAccount(status: string): boolean {
  return status !== "enabled";
}

/** Verdadero cuando la cuenta admite revocación (está habilitada). */
export function canRevokeStaffAccount(status: string): boolean {
  return status === "enabled";
}
