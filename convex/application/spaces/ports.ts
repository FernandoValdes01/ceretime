import type { Space } from "../../domain/spaces/space";

/**
 * Puerto de lectura técnica de espacios (TI2-95).
 *
 * Capa de Aplicación: fija lo que un caso de uso lee de una sala por id o por
 * ubicación, sin Convex. Infraestructura lo cumple por forma con
 * `spaceReader(ctx)` sin importar este archivo, y las pruebas de los casos de
 * uso pueden pasar un doble en memoria.
 *
 * Entrega el contrato `Space` de TI2-87 más su vigencia. El catálogo publicado
 * de TI2-99 solo trae salas vigentes; esta lectura también ve las retiradas,
 * para que quien valida una referencia distinga la retirada de la
 * inexistente. Las necesidades de acceso que una sala satisface
 * (`satisfiedNeeds` de TI2-82) no están en el esquema y no se entregan.
 */

export type StoredSpace = Space & { readonly isActive: boolean };

/**
 * Lecturas técnicas de salas, vigentes o retiradas. Un identificador
 * inexistente o de otra tabla responde igual que una sala inexistente.
 */
export interface SpaceReader {
  /** Sala por id, o `null`. */
  getSpace(spaceId: string): Promise<StoredSpace | null>;
  /** Sala en esa ubicación exacta (campus, edificio, piso y sala), o `null`. */
  findSpaceByLocation(
    location: Pick<Space, "campus" | "building" | "floor" | "room">,
  ): Promise<StoredSpace | null>;
}
