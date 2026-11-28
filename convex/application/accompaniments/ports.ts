import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { ProfessionalAssignmentHolder } from "../../domain/accompaniments/accompaniment";

/**
 * Puertos de los casos de uso de acompañamientos (S2, TI2-28, TI2-140).
 *
 * Capa de Aplicación: fija lo que los casos de uso leen y escriben, sin
 * importar repositorios concretos. Infraestructura los cumple con
 * `accompanimentReadStore(ctx)` y `accompanimentAssignmentStore(ctx)`, que
 * Presentación y las vías internas crean con el `ctx` de la función, así cada
 * operación sigue siendo una sola transacción. Las lecturas de asignaciones
 * ya descartan las filas fuera de su ventana de vigencia (TI2-140).
 */

/** Acompañamiento, usuario y rol de una asignación. */
export type AssignmentTriple = {
  readonly accompanimentId: Id<"accompaniments">;
  readonly userId: Id<"users">;
  readonly assignedRole: "professional" | "intern";
};

/** Lecturas que comparten las consultas y los comandos. */
export interface AccompanimentProfileReader {
  /** Perfil vinculado a la identidad, o `null`. */
  findProfileByTokenIdentifier(tokenIdentifier: string): Promise<Doc<"users"> | null>;
  getAccompanimentById(
    accompanimentId: Id<"accompaniments">,
  ): Promise<Doc<"accompaniments"> | null>;
}

/** Lecturas de las consultas de acompañamientos. */
export interface AccompanimentReadStore extends AccompanimentProfileReader {
  /** Asignaciones activas y vigentes del usuario sobre el acompañamiento. */
  findActiveAssignmentsForUser(
    accompanimentId: Id<"accompaniments">,
    userId: Id<"users">,
  ): Promise<Doc<"accompanimentAssignments">[]>;
  paginateOwnedAccompaniments(
    studentId: Id<"users">,
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<Doc<"accompaniments">>>;
  /**
   * Filas activas y vigentes del usuario con ese rol, ordenadas por
   * acompañamiento y posteriores al cursor.
   */
  queryAssignedRowsAfter(input: {
    readonly userId: Id<"users">;
    readonly assignedRole: "professional" | "intern";
    readonly cursor: Id<"accompaniments"> | undefined;
    readonly take: number;
  }): Promise<Doc<"accompanimentAssignments">[]>;
  paginateInternalNotes(
    accompanimentId: Id<"accompaniments">,
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<Doc<"followUpNotes">>>;
}

/** Lecturas y escrituras de las asignaciones de un acompañamiento. */
export interface AccompanimentAssignmentStore extends AccompanimentProfileReader {
  getUserById(userId: Id<"users">): Promise<Doc<"users"> | null>;
  getAssignmentById(
    assignmentId: Id<"accompanimentAssignments">,
  ): Promise<Doc<"accompanimentAssignments"> | null>;
  /** Fila activa exacta de la terna, si existe. */
  findExistingActiveAssignment(
    triple: AssignmentTriple,
  ): Promise<Doc<"accompanimentAssignments"> | null>;
  /** Si el usuario tiene una asignación profesional activa y vigente. */
  hasActiveProfessionalAssignment(input: {
    readonly accompanimentId: Id<"accompaniments">;
    readonly userId: Id<"users">;
  }): Promise<boolean>;
  /**
   * Titulares de las asignaciones profesionales vigentes; `null` cuando se
   * supera el tope de filas leídas.
   */
  listProfessionalAssignmentHolders(
    accompanimentId: Id<"accompaniments">,
  ): Promise<ProfessionalAssignmentHolder[] | null>;
  /** Lote de filas activas de la terna. */
  takeActiveTripleRows(
    triple: AssignmentTriple,
    take: number,
  ): Promise<Doc<"accompanimentAssignments">[]>;
  /** Crea la fila activa con quién concede y cuándo, y la vigencia si llega. */
  insertActiveAssignment(
    triple: AssignmentTriple,
    grantedBy: Id<"users">,
    validity?: { readonly validFrom?: number; readonly validUntil?: number },
  ): Promise<Id<"accompanimentAssignments">>;
  /** Reescribe la ventana; `null` quita el extremo y `undefined` lo conserva. */
  patchAssignmentValidity(
    assignmentId: Id<"accompanimentAssignments">,
    validity: { readonly validFrom?: number | null; readonly validUntil?: number | null },
  ): Promise<void>;
  /** Revoca la fila con quién revoca y cuándo. */
  revokeAssignmentRow(
    assignmentId: Id<"accompanimentAssignments">,
    revokedBy: Id<"users">,
  ): Promise<void>;
  /** Cierra la fila como `expired` al vencer su ventana, sin actor (TI4-84). */
  expireAssignmentRow(assignmentId: Id<"accompanimentAssignments">): Promise<void>;
}
