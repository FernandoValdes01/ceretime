import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";

/**
 * Puerto de las lecturas de acompañamientos (revisión TI4-84).
 *
 * Capa de Aplicación: fija lo que leen `getAccompanimentDetail`, los dos
 * listados y las notas internas, sin conocer Convex. Infraestructura lo
 * cumple con `accompanimentReadStore(ctx)`, creado en Presentación con el
 * mismo `ctx` de la query, así cada lectura ocurre en una sola transacción.
 *
 * Las filas conservan su forma de documento: el caso de uso proyecta la vista
 * autorizada con Dominio y no expone campos que la vista no permita.
 */
export interface AccompanimentReadStore {
  /** Perfil vinculado a la identidad autenticada, o `null` si no existe. */
  findProfileByTokenIdentifier(tokenIdentifier: string): Promise<Doc<"users"> | null>;
  /** Acompañamiento por id, o `null` si no existe. */
  getAccompaniment(accompanimentId: Id<"accompaniments">): Promise<Doc<"accompaniments"> | null>;
  /** Asignaciones activas y vigentes del usuario sobre el acompañamiento. */
  findActiveAssignmentsForUser(
    accompanimentId: Id<"accompaniments">,
    userId: Id<"users">,
  ): Promise<Doc<"accompanimentAssignments">[]>;
  /** Acompañamientos propios del Estudiante, paginados. */
  paginateOwnedAccompaniments(
    studentId: Id<"users">,
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<Doc<"accompaniments">>>;
  /**
   * Ventana keyset de asignaciones vigentes del usuario en ese rol, ordenada
   * por acompañamiento y posterior a `cursor`.
   */
  queryAssignedRowsAfter(input: {
    readonly userId: Id<"users">;
    readonly assignedRole: "professional" | "intern";
    readonly cursor: Id<"accompaniments"> | undefined;
    readonly take: number;
  }): Promise<Doc<"accompanimentAssignments">[]>;
  /** Notas internas del acompañamiento, paginadas. */
  paginateInternalNotes(
    accompanimentId: Id<"accompaniments">,
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<Doc<"followUpNotes">>>;
}
