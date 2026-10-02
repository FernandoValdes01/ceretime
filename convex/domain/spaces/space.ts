/**
 * Espacios de atención: contratos públicos compartidos v1 (TI2-87).
 *
 * Dominio puro: no importa Convex, React ni Expo, para que Web y Mobile
 * consuman la misma forma sin levantar el backend. Fija el espacio
 * presencial (campus, edificio, piso, sala, condiciones de acceso e
 * instrucciones de llegada compatibles con lector de pantalla) con
 * identificadores genéricos (`string` plano, sin `Id`/`Doc` de Convex).
 *
 * La ocupación de salas y la compatibilidad con necesidades de acceso
 * pertenecen a TI2-82; acá solo hay forma versionada y paginación, sin
 * políticas propias.
 */

/** Versión del contrato público del catálogo de espacios. */
export const SPACE_CATALOG_CONTRACT_VERSION = "v1" as const;

export type SpaceCatalogContractVersion = typeof SPACE_CATALOG_CONTRACT_VERSION;

/** Espacio presencial del catálogo, con acceso e instrucciones. */
export interface Space {
  readonly id: string;
  readonly campus: string;
  readonly building: string;
  readonly floor: string;
  readonly room: string;
  /** Condiciones de acceso necesarias para llegar y usar la sala. */
  readonly accessConditions: string;
  /** Instrucciones de llegada compatibles con lector de pantalla. */
  readonly arrivalInstructions: string;
  readonly version: SpaceCatalogContractVersion;
}

/** Entrada mínima para la lectura propia del catálogo: solo paginación. */
export interface ListSpacesInput {
  readonly limit: number;
  readonly cursor?: string;
  readonly version: SpaceCatalogContractVersion;
}

/** Página del catálogo con paginación keyset sobre el identificador. */
export interface SpaceCatalogPage {
  readonly items: readonly Space[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly version: SpaceCatalogContractVersion;
}

/** Resumen legible de un espacio para listados de Web y Mobile. */
export function toSpaceLabel(space: Space): string {
  return `${space.campus} · ${space.building} · ${space.floor} · ${space.room}`;
}
