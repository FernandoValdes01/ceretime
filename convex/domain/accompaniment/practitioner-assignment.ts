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
 * borrar el historial. Los cuatro campos son opcionales porque el schema los
 * declara así: las filas legacy (anteriores a TI2-16) no los tienen y las
 * filas activas nuevas todavía no tienen fecha de revocación. La vigencia
 * del acceso la decide `status`, no la presencia de estos campos.
 */

/** Rol con el que una persona queda asignada al acompañamiento. */
export const ASSIGNMENT_ROLE_VALUES = ["professional", "intern"] as const;

export type AssignmentRole = (typeof ASSIGNMENT_ROLE_VALUES)[number];

/** Vigencia de la asignación: activa o revocada. */
export const ASSIGNMENT_STATUS_VALUES = ["active", "revoked"] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUS_VALUES)[number];

/**
 * Fila de asignación con trazabilidad, no una entidad que se borra.
 * `grantedBy` es el perfil del Profesional que concedió. Los cuatro campos
 * de trazabilidad son opcionales como en el schema: una fila legacy válida
 * puede no traer ninguno, y una fila activa nueva no trae fecha de
 * revocación. `revokedBy`/`revokedAt` aceptan `null` explícito además de
 * ausencia, porque ambas formas significan "sin revocar".
 */
export interface PractitionerAssignment {
  _id: string;
  accompanimentId: string;
  userId: string;
  assignedRole: AssignmentRole;
  status: AssignmentStatus;
  grantedBy?: string;
  grantedAt?: number;
  revokedBy?: string | null;
  revokedAt?: number | null;
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
  /** Ausente cuando la fila legacy no registra fecha de concesión. */
  grantedAt?: number;
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
