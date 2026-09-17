/**
 * Asignación de acceso a un acompañamiento (TI2-8).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. Alineada con la
 * tabla `accompanimentAssignments` del schema actual. Invariante de
 * persistencia (ver `schema.ts`): como máximo una fila activa por cada
 * combinación de acompañamiento, usuario y rol asignado.
 *
 * Trazabilidad mínima: la fila registra quién concedió (`grantedBy`), cuándo
 * (`grantedAt`) y, si se revoca, quién y cuándo (fecha de revocación), sin
 * borrar el historial. La vigencia del acceso es el intervalo entre
 * `grantedAt` y `revokedAt`: mientras `status` sea `"active"` no hay fecha
 * de revocación.
 */

/** Rol con el que una persona queda asignada al acompañamiento. */
export const ASSIGNMENT_ROLE_VALUES = ["professional", "intern"] as const;

export type AssignmentRole = (typeof ASSIGNMENT_ROLE_VALUES)[number];

/** Vigencia de la asignación: activa o revocada. */
export const ASSIGNMENT_STATUS_VALUES = ["active", "revoked"] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUS_VALUES)[number];

/**
 * Fila de asignación con trazabilidad, no una entidad que se borra.
 * `grantedBy` es el perfil del Profesional que concedió; `revokedBy` y
 * `revokedAt` son `null` mientras la asignación esté activa.
 */
export interface PractitionerAssignment {
  _id: string;
  accompanimentId: string;
  userId: string;
  assignedRole: AssignmentRole;
  status: AssignmentStatus;
  grantedBy: string;
  grantedAt: number;
  revokedBy: string | null;
  revokedAt: number | null;
}

/**
 * Permiso de lectura que la asignación concede sobre el acompañamiento
 * mientras esté activa. `view` es `"full"` para el Profesional y
 * `"minimized"` para el Practicante, que no recibe `accessNeeds`.
 */
export interface AssignmentReadPermission {
  accompanimentId: string;
  userId: string;
  role: AssignmentRole;
  view: "full" | "minimized";
  grantedAt: number;
}

/** Vista que concede cada rol asignado (`practitioner-assignment.ts`). */
export const ASSIGNMENT_VIEW_BY_ROLE: Record<AssignmentRole, "full" | "minimized"> = {
  professional: "full",
  intern: "minimized",
};

/**
 * Permiso de lectura de una asignación, o `null` si está revocada.
 * Mantiene explícito que una fila revocada no autoriza (RNF-08, RN-26).
 */
export function toAssignmentReadPermission(
  assignment: PractitionerAssignment,
): AssignmentReadPermission | null {
  if (assignment.status !== "active") return null;
  return {
    accompanimentId: assignment.accompanimentId,
    userId: assignment.userId,
    role: assignment.assignedRole,
    view: ASSIGNMENT_VIEW_BY_ROLE[assignment.assignedRole],
    grantedAt: assignment.grantedAt,
  };
}
