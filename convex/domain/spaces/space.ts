/**
 * Catálogo de espacios de atención: contratos públicos versionados (TI2-87).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. Fija la forma del
 * espacio presencial (campus, edificio, piso, sala, condiciones de acceso e
 * instrucciones de llegada compatibles con lector de pantalla) con versión
 * explícita `v1`, sin duplicar la API Convex: la lectura propia del catálogo
 * sale por `api.presentation.agenda.*` y este módulo solo fija la forma.
 *
 * No implementa reglas de negocio: la compatibilidad con necesidades de
 * acceso, la ocupación de salas y la prevención de cruces pertenecen a los
 * casos de uso de otros módulos. Acá solo hay forma, topes y resúmenes.
 */

import type { ApiResult } from "../errors/api_error";

/** Versión del catálogo de espacios que devuelve cada proyección. */
export const SPACE_CATALOG_CONTRACT_VERSION = "v1" as const;

export type SpaceCatalogContractVersion = typeof SPACE_CATALOG_CONTRACT_VERSION;

/** Tope de lectura propia del catálogo para no devolver listados ilimitados. */
export const SPACE_CATALOG_MAX_ITEMS = 50;

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

/** Resumen legible de un espacio para listados de Web y Mobile. */
export function toSpaceLabel(space: Space): string {
  return `${space.campus} · ${space.building} · ${space.floor} · ${space.room}`;
}

/** Verdadero cuando el límite pedido cabe en el tope del catálogo. */
export function isSpaceLimitWithinCatalog(limit: number): boolean {
  return Number.isInteger(limit) && limit >= 1 && limit <= SPACE_CATALOG_MAX_ITEMS;
}

/**
 * Valida la forma de un espacio sin decidir compatibilidad ni ocupación.
 * Devuelve la misma forma versionada o un error público estable con código.
 */
export function toVersionedSpace(space: Omit<Space, "version">): ApiResult<Space> {
  const fields = [
    space.campus.trim(),
    space.building.trim(),
    space.floor.trim(),
    space.room.trim(),
    space.accessConditions.trim(),
    space.arrivalInstructions.trim(),
  ];
  if (fields.some((field) => field.length === 0)) {
    return {
      status: "error",
      error: {
        code: "space_invalid_field",
        message: "El espacio debe traer campus, edificio, piso, sala, acceso e instrucciones.",
      },
    };
  }
  return { status: "ok", data: { ...space, version: SPACE_CATALOG_CONTRACT_VERSION } };
}
