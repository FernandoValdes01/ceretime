import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { FOLLOW_UP_CONTRACT_VERSION } from "../../../../../../convex/domain/index.ts";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../../convex/_generated/api";

/**
 * Seguimiento desde la Web del Profesional (TI2-165) y del Estudiante (TI2-166).
 *
 * Cableado delgado sobre `api.presentation.follow_up`
 * (`docs/contratos-sprint-3/seguimiento.md`). Cada query responde `undefined`
 * mientras carga; la autorización y la vista de cada rol las decide el
 * Backend, que entrega la nota interna solo en la vista `professional`.
 */

/** Atenciones que recorre cada página del historial; el contrato admite de 1 a 20. */
export const FOLLOW_UP_HISTORY_PAGE_SIZE = 20;

/** Página del historial de un acompañamiento; `cursor` es `null` en la primera. */
export function useFollowUpHistory(accompanimentId: string, cursor: string | null) {
  return useQuery(api.presentation.follow_up.listAccompanimentFollowUpRecords, {
    accompanimentId,
    limit: FOLLOW_UP_HISTORY_PAGE_SIZE,
    ...(cursor === null ? {} : { cursor }),
    version: FOLLOW_UP_CONTRACT_VERSION,
  });
}

/** Seguimiento de una atención, o `null` si todavía no tiene. */
export function useFollowUpRecord(appointmentId: string) {
  return useQuery(api.presentation.follow_up.getFollowUpRecord, {
    appointmentId,
    version: FOLLOW_UP_CONTRACT_VERSION,
  });
}

export function useSaveFollowUpRecord() {
  return useMutation(api.presentation.follow_up.saveFollowUpRecord);
}

/** Página del historial, derivada del contrato generado. */
export type FollowUpHistoryPage = NonNullable<
  FunctionReturnType<typeof api.presentation.follow_up.listAccompanimentFollowUpRecords>
>;

/** Un seguimiento confirmado con la vista que el Backend entrega al rol. */
export type FollowUpRecordView = FollowUpHistoryPage["items"][number];
