import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";

/**
 * Lecturas del panel del Estudiante (Presentación web).
 *
 * Cableado delgado, un hook por recurso: consume solo queries públicas ya
 * existentes. Cada query responde `undefined` mientras carga y la
 * autorización vive en Convex. Separarlas permite que cada sección del panel
 * cargue y falle por su cuenta.
 */
export function useStudentSession() {
  return useQuery(api.presentation.session.getSessionState);
}

export function useStudentRequests() {
  return useQuery(api.presentation.requests.listOwnRequests, {
    paginationOpts: { numItems: 5, cursor: null },
  });
}

export function useStudentAccompaniments() {
  return useQuery(api.presentation.accompaniments.listOwnedAccompaniments, {
    paginationOpts: { numItems: 5, cursor: null },
  });
}
