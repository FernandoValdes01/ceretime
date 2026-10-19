import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Lecturas del acompañamiento propio del Estudiante (TI2-90).
 *
 * Cableado delgado sobre la query pública ya existente (`getAccompaniment`):
 * responde `undefined` mientras carga y la autorización vive en Convex, que
 * deniega con un error genérico cuando el acompañamiento es ajeno o no
 * existe. Nunca llama a `getInternalNotes`: las notas internas no pertenecen
 * al Estudiante.
 */
export function useOwnAccompanimentDetail(accompanimentId: string) {
  return useQuery(api.presentation.accompaniments.getAccompaniment, {
    // El formato y la existencia los valida el Backend; un id inválido o
    // ajeno responde denegación genérica sin filtrar existencia.
    accompanimentId: accompanimentId as Id<"accompaniments">,
  });
}

/** Detalle del acompañamiento propio, derivado del contrato generado (sin duplicar formas). */
export type OwnAccompanimentDetail = NonNullable<
  FunctionReturnType<typeof api.presentation.accompaniments.getAccompaniment>
>;
