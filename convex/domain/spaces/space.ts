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

/** Campos editables del catálogo, sin identidad ni versión. */
export interface SpaceFields {
  readonly campus: string;
  readonly building: string;
  readonly floor: string;
  readonly room: string;
  readonly accessConditions: string;
  readonly arrivalInstructions: string;
}

/**
 * Normaliza los campos del catálogo recortando espacios. No valida: usar
 * `validateSpaceFields` antes para mensajes en español.
 */
export function normalizeSpaceFields(fields: SpaceFields): SpaceFields {
  return {
    campus: fields.campus.trim(),
    building: fields.building.trim(),
    floor: fields.floor.trim(),
    room: fields.room.trim(),
    accessConditions: fields.accessConditions.trim(),
    arrivalInstructions: fields.arrivalInstructions.trim(),
  };
}

/**
 * Valida los campos del catálogo (TI2-148). Devuelve el mensaje en español
 * del primer campo vacío o `null` cuando son legibles. No mira duplicados:
 * esa comprobación vive en Infraestructura con el índice de ubicación.
 */
export function validateSpaceFields(fields: SpaceFields): string | null {
  if (fields.campus.trim() === "") return "Indica el campus del espacio.";
  if (fields.building.trim() === "") return "Indica el edificio del espacio.";
  if (fields.floor.trim() === "") return "Indica el piso del espacio.";
  if (fields.room.trim() === "") return "Indica la sala del espacio.";
  if (fields.accessConditions.trim() === "")
    return "Describe las condiciones de acceso del espacio.";
  if (fields.arrivalInstructions.trim() === "")
    return "Describe las instrucciones de llegada al espacio.";
  return null;
}
