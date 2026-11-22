import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

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

/** Etiqueta legible del rol de una cuenta de personal. */
export function staffRoleLabel(role: string): string {
  if (role === "professional") {
    return "Profesional";
  }
  if (role === "admin") {
    return "Administrador";
  }
  return role;
}

/** Etiqueta legible de la habilitación institucional de la cuenta. */
export function staffInstitutionalStatusLabel(status: string): string {
  if (status === "enabled") {
    return "Habilitada";
  }
  if (status === "pending") {
    return "Pendiente";
  }
  if (status === "disabled") {
    return "Revocada";
  }
  return status;
}

/** Etiqueta legible de la vigencia de la cuenta en la plataforma. */
export function staffAccountStatusLabel(status: string): string {
  if (status === "active") {
    return "Vigente";
  }
  if (status === "inactive") {
    return "No vigente";
  }
  return status;
}

/** Verdadero cuando la cuenta admite habilitación (no está habilitada). */
export function canEnableStaffAccount(status: string): boolean {
  return status !== "enabled";
}

/** Verdadero cuando la cuenta admite revocación (está habilitada). */
export function canRevokeStaffAccount(status: string): boolean {
  return status === "enabled";
}
