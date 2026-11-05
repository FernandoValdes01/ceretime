import type { AssignedAccompanimentSummary } from "../../application/auth-models";

export const internRoutes = {
  assigned: "/practicante/asignaciones",
  unassigned: "/practicante/sin-asignacion",
} as const;

// Una asignación sin identificador o título no permite abrir el acompañamiento, así que no cuenta.
export function hasValidInternAssignments(
  assignments: readonly AssignedAccompanimentSummary[],
): boolean {
  return assignments.some(
    (accompaniment) => accompaniment.id.trim() !== "" && accompaniment.title.trim() !== "",
  );
}

export function getInternRoute(hasAssignments: boolean) {
  return hasAssignments ? internRoutes.assigned : internRoutes.unassigned;
}
