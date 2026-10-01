import { useQuery } from "convex/react";
// Provisorio (TI2-87): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";

/**
 * Lecturas de agenda de la Web (TI2-87).
 *
 * Cableado delgado: la versión del contrato sale directo de la API pública
 * sin duplicarla (`undefined` mientras carga y la autorización vive en
 * Convex). El catálogo y la disponibilidad siguen en adaptadores ficticios
 * hasta las tareas de conexión, que los reemplazan por
 * `api.presentation.agenda.*` sin cambiar la forma `v1`.
 */
export function useAgendaContractVersion() {
  return useQuery(api.presentation.agenda.getAgendaContractVersion);
}

/** Forma de la versión del contrato para props y pruebas. */
export type WebAgendaContractVersion = ReturnType<typeof useAgendaContractVersion>;

export function useSpaceCatalogPage(limit: number) {
  return useQuery(api.presentation.agenda.listSpaceCatalog, { limit });
}

/** Forma de la página del catálogo para props y pruebas. */
export type WebSpaceCatalogPage = ReturnType<typeof useSpaceCatalogPage>;
