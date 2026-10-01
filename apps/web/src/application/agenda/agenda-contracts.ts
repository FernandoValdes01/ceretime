import type { FunctionArgs, FunctionReturnType } from "convex/server";
// Provisorio (TI2-87): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import type { api } from "../../../../../convex/_generated/api";

/**
 * Contratos canónicos de agenda para la Web (TI2-87).
 *
 * La Web consume la API pública sin duplicarla: cada forma sale de
 * `api.presentation.agenda.*` y de los tipos generados. Ningún archivo Web
 * importa `convex/domain` ni copia funciones del backend; los valores
 * documentados (versión `v1`, tope 50) se declaran acá solo como espejo
 * tipado hasta que exista un paquete compartido. Un cambio incompatible
 * sumaría `v2` sin alterar `v1`.
 */

/** Versión del contrato de agenda que la Web sabe leer. */
export const AGENDA_CONTRACT_VERSION = "v1" as const;

/** Tope documentado de lectura propia del catálogo, sin duplicar el número. */
export const SPACE_CATALOG_MAX_ITEMS = 50;

/** Versión vigente de los contratos según el backend. */
export type CanonicalAgendaContract = FunctionReturnType<
  typeof api.presentation.agenda.getAgendaContractVersion
>;

/** Página del catálogo propio tal como la devuelve el backend. */
export type CanonicalSpaceCatalogPage = FunctionReturnType<
  typeof api.presentation.agenda.listSpaceCatalog
>;

/** Espacio del catálogo propio tal como lo lee la Web. */
export type CanonicalSpaceCatalogItem = CanonicalSpaceCatalogPage["items"][number];

/** Argumentos de la lectura propia del catálogo. */
export type ListSpaceCatalogArgs = FunctionArgs<typeof api.presentation.agenda.listSpaceCatalog>;

/**
 * Bloque recurrente ficticio para la lectura temporal de disponibilidad.
 *
 * Forma espejo del contrato `v1` del backend, usada solo por el adaptador
 * temporal hasta que `api.presentation.agenda.*` exponga la lectura real en
 * las tareas de conexión. No inventa endpoint ni estado.
 */
export interface FictitiousAvailabilityBlock {
  readonly id: string;
  readonly professionalId: string;
  readonly weekday: number;
  readonly from: string;
  readonly to: string;
  readonly durationMinutes: number;
  readonly modality: "inPerson" | "online";
  readonly spaceId?: string;
  readonly version: typeof AGENDA_CONTRACT_VERSION;
}
