/**
 * Asignación de acceso a un acompañamiento (TI2-8).
 *
 * Alineada con la tabla `accompanimentAssignments` del schema actual.
 * Invariante de persistencia (ver `schema.ts`): como máximo una fila activa
 * por cada combinación de acompañamiento, usuario y rol asignado.
 */
import type { Id } from "../../_generated/dataModel";
import type { Infer } from "convex/values";
import type { assignmentRoleUnion, assignmentStatusUnion } from "../../validators";

/** Rol con el que una persona queda asignada al acompañamiento. */
export type AssignmentRole = Infer<typeof assignmentRoleUnion>;

/** Vigencia de la asignación: activa o revocada. */
export type AssignmentStatus = Infer<typeof assignmentStatusUnion>;

/**
 * Concede a `userId` acceso de lectura sobre `accompanimentId` con el rol
 * `assignedRole`, mientras `status` sea `"active"`. Revocar cambia el
 * `status`, no borra la fila (trazabilidad mínima de Sprint 1).
 */
export interface PractitionerAssignment {
  id: Id<"accompanimentAssignments">;
  accompanimentId: Id<"accompaniments">;
  userId: Id<"users">;
  assignedRole: AssignmentRole;
  status: AssignmentStatus;
}
