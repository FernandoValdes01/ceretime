import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Gestión de practicantes desde la Web del Profesional (TI2-170).
 *
 * Cableado delgado sobre la API real de TI2-140 (`enableIntern`,
 * `assignAccompanimentAccess`, `updateAccompanimentAccess`,
 * `revokeAccompanimentAccess`) más las lecturas de TI2-170
 * (`listInternAccounts`, `listAccompanimentInterns`). La autorización vive en
 * Convex y la denegación llega como error genérico sin motivo. Habilitar no
 * concede acompañamientos y jamás expone notas internas.
 */

/** Tamaño de página del listado; el Backend acota entre 1 y 100. */
export const INTERN_ACCOUNTS_PAGE_SIZE = 10;

export function useInternAccounts(cursor: string | null) {
  return useQuery(api.presentation.accounts.listInternAccounts, {
    paginationOpts: { numItems: INTERN_ACCOUNTS_PAGE_SIZE, cursor },
  });
}

/** Habilita una cuenta practicante pendiente. */
export function useEnableIntern() {
  return useMutation(api.presentation.accounts.enableIntern);
}

/**
 * Practicantes asignados al acompañamiento y los que se le pueden asignar,
 * con su nombre y su vigencia (TI2-170). Responde `undefined` mientras carga.
 */
export function useAccompanimentInterns(accompanimentId: Id<"accompaniments">) {
  return useQuery(api.presentation.accompaniments.listAccompanimentInterns, {
    accompanimentId,
  });
}

/** Asignar, modificar la vigencia y retirar usan las operaciones de TI2-140. */
export function useAssignInternAccess() {
  return useMutation(api.presentation.accompaniments.assignAccompanimentAccess);
}

export function useUpdateInternAccess() {
  return useMutation(api.presentation.accompaniments.updateAccompanimentAccess);
}

export function useRevokeInternAccess() {
  return useMutation(api.presentation.accompaniments.revokeAccompanimentAccess);
}

/** Página paginada de cuentas practicantes, derivada del contrato generado. */
export type InternAccountsPage = NonNullable<
  FunctionReturnType<typeof api.presentation.accounts.listInternAccounts>
>;

/** Cuenta practicante tal como la entrega el Backend: detalle mínimo. */
export type InternAccountItem = InternAccountsPage["page"][number];

/** Practicantes del acompañamiento, derivados del contrato generado. */
export type AccompanimentInterns = NonNullable<ReturnType<typeof useAccompanimentInterns>>;

/** Verdadero cuando la cuenta admite habilitación (no está habilitada). */
export function canEnableIntern(status: string): boolean {
  return status !== "enabled";
}
