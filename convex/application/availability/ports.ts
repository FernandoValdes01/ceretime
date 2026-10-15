import type {
  AvailabilityBlock,
  AvailabilityException,
} from "../../domain/availability/availability";
import type { ApiResult } from "../../domain/errors/api_error";
import type { AccessNeed } from "../../domain/requests/request";
import type { CompatibilitySpace } from "../../domain/spaces/compatibility";

/**
 * Puerto de persistencia de disponibilidad (TI2-95).
 *
 * Capa de Aplicación: fija lo que los casos de uso de TI2-97 leen y escriben
 * de bloques recurrentes y excepciones, sin Convex. Infraestructura lo cumple
 * por forma con `availabilityReader(ctx)` y `availabilityWriter(ctx)` sin
 * importar este archivo, y las pruebas de los casos de uso pueden pasar un
 * doble en memoria.
 *
 * Los tipos son los contratos de TI2-81/TI2-87 más lo que la persistencia
 * guarda y el contrato no trae: si el bloque sigue vigente y, en la
 * excepción, su identificador, su profesional y el motivo. Ese
 * `professionalId` guardado es el que recibe `authorizeAvailabilityEdit`
 * (TI2-86) al editar; nunca sale del cliente.
 */

export type StoredAvailabilityBlock = AvailabilityBlock & { readonly isActive: boolean };

export type StoredAvailabilityException = AvailabilityException & {
  readonly id: string;
  readonly professionalId: string;
  readonly reason?: string;
};

/** Rango civil inclusivo, con fechas `YYYY-MM-DD` y a lo más `MAX_EXPANSION_DAYS` días. */
export interface AvailabilityExceptionRange {
  readonly professionalId: string;
  readonly from: string;
  readonly to: string;
}

/**
 * Lecturas de disponibilidad. Un identificador inexistente o de otra tabla
 * responde igual que uno sin datos. Las listas fallan con `conflict` cuando
 * superan su tope de lectura o el rango es inválido, en vez de devolver una
 * lista cortada.
 */
export interface AvailabilityReader {
  /** Bloque vigente o retirado, o `null`. */
  getBlock(blockId: string): Promise<StoredAvailabilityBlock | null>;
  /** Bloques vigentes del profesional, ordenados por día de semana. */
  listActiveBlocks(professionalId: string): Promise<ApiResult<readonly StoredAvailabilityBlock[]>>;
  /** Excepción por id, o `null`. */
  getException(exceptionId: string): Promise<StoredAvailabilityException | null>;
  /** Excepciones del profesional en el rango, ordenadas por fecha. */
  listExceptions(
    range: AvailabilityExceptionRange,
  ): Promise<ApiResult<readonly StoredAvailabilityException[]>>;
}

/**
 * Escrituras de disponibilidad. Validan integridad, no autorización: el caso
 * de uso llama antes a TI2-86. Responden `conflict` sin escribir cuando una
 * referencia no existe (profesional, bloque, excepción o sala vigente), el
 * bloque cancelado es de otro profesional, la excepción trae más de una
 * ventana, lo guardado haría fallar la expansión de TI2-81 o superaría el
 * tope que después impide leerlo.
 */
export interface AvailabilityWriter {
  insertBlock(
    block: Omit<AvailabilityBlock, "id" | "version">,
  ): Promise<ApiResult<{ readonly blockId: string }>>;
  /** Reemplaza la ventana; el profesional guardado no cambia. */
  updateBlock(
    blockId: string,
    block: Omit<AvailabilityBlock, "id" | "professionalId" | "version">,
  ): Promise<ApiResult<null>>;
  /** Reactivar exige que la sala del bloque siga vigente. */
  setBlockActive(blockId: string, isActive: boolean): Promise<ApiResult<null>>;
  insertException(
    exception: Omit<StoredAvailabilityException, "id" | "version">,
  ): Promise<ApiResult<{ readonly exceptionId: string }>>;
  removeException(exceptionId: string): Promise<ApiResult<null>>;
}

/**
 * Necesidades vigentes del acompañamiento para la búsqueda (TI2-97), ya
 * resueltas a identificadores. La persistencia guarda el texto declarado;
 * la resolución a identificadores vive en Infraestructura junto al
 * catálogo, no en el caso de uso, para no inventar un mapeo en Aplicación.
 */
export interface AccompanimentNeeds {
  readonly _id: string;
  readonly needs: readonly AccessNeed[];
}

/**
 * Lectura mínima del acompañamiento para buscar cupos. La pertenencia, la
 * asignación y el estado activo ya los exige `authorizeAvailabilityRead`
 * (TI2-86); acá solo se resuelven las necesidades vigentes.
 */
export interface AccompanimentNeedsReader {
  findAccompanimentNeeds(accompanimentId: string): Promise<AccompanimentNeeds | null>;
}

/**
 * Ocupación mínima para la búsqueda (TI2-84, cruces de TI2-96). Informa si
 * el instante ya está ocupado por una atención no cancelada; la reserva
 * atómica sigue siendo la única vía que ocupa.
 */
export interface SlotOccupancyReader {
  isSlotOccupied(input: {
    readonly professionalId: string;
    readonly startAt: number;
  }): Promise<boolean>;
}

/**
 * Espacios para la compatibilidad de TI2-82. La sala retirada (`null`) no se
 * ofrece; los apoyos en línea cubren las necesidades de esa modalidad.
 */
export interface CompatibilitySpaceSource {
  findCompatibilitySpace(spaceId: string): Promise<CompatibilitySpace | null>;
  listOnlineSupports(): Promise<readonly AccessNeed[]>;
}
