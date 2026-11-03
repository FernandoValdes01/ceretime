import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Lecturas de acompañamientos asignados al Practicante (TI2-116).
 *
 * Cableado delgado sobre las queries públicas ya existentes
 * (`listAssignedAccompaniments` y `getAccompaniment`): responden `undefined`
 * mientras cargan y la autorización vive en Convex, que entrega al
 * Practicante solo la vista minimizada de los acompañamientos con
 * asignación vigente y deniega con un error genérico en cualquier otro caso
 * (sin asignación, asignación revocada, cuenta inhabilitada o inexistente).
 * Nunca llama a `getInternalNotes`: las notas internas no pertenecen al
 * Practicante.
 */

/** Tamaño de página del listado asignado; el Backend acota entre 1 y 100. */
export const ASSIGNED_PAGE_SIZE = 10;

/**
 * Página del listado asignado con cursor keyset: `after` es el último
 * acompañamiento de la página anterior (`lastId`), `undefined` en la primera.
 */
export function useAssignedAccompaniments(after: string | undefined) {
  return useQuery(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: ASSIGNED_PAGE_SIZE,
    after: after as Id<"accompaniments"> | undefined,
  });
}

export function useAssignedAccompanimentDetail(accompanimentId: string) {
  return useQuery(api.presentation.accompaniments.getAccompaniment, {
    // El formato y la existencia los valida el Backend; un id inválido o
    // ajeno responde denegación genérica sin filtrar existencia.
    accompanimentId: accompanimentId as Id<"accompaniments">,
  });
}

/** Página del listado asignado, derivada del contrato generado (sin duplicar formas). */
export type AssignedAccompanimentsPage = NonNullable<
  FunctionReturnType<typeof api.presentation.accompaniments.listAssignedAccompaniments>
>;

type AccompanimentView = AssignedAccompanimentsPage["items"][number];

/** Vista minimizada del contrato: `_id`, `status`, `objective` y `view`. */
export type MinimizedAccompaniment = Extract<AccompanimentView, { view: "minimized" }>;

/**
 * Proyección a la vista minimizada (TI2-116).
 *
 * El Backend ya minimiza para el Practicante; esta proyección solo fija que
 * la superficie renderiza exclusivamente los campos minimizados, de modo que
 * un cambio de contrato no exponga `studentId` ni `accessNeeds` por
 * accidente al propagar el objeto completo.
 */
export function toMinimizedAccompaniment(view: AccompanimentView): MinimizedAccompaniment {
  return { _id: view._id, status: view.status, objective: view.objective, view: "minimized" };
}
