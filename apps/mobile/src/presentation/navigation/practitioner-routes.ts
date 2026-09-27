import type { AuthAccompaniment } from "../../application/auth-models";

export const practitionerRoutes = {
  assigned: "/practicante/asignaciones",
  unassigned: "/practicante/sin-asignacion",
} as const;

export function hasValidPractitionerAssignments(
  assignments: readonly AuthAccompaniment[],
): boolean {
  return assignments.some(
    (accompaniment) => accompaniment.id.trim() !== "" && accompaniment.title.trim() !== "",
  );
}

export function getPractitionerRoute(hasAssignments: boolean) {
  return hasAssignments ? practitionerRoutes.assigned : practitionerRoutes.unassigned;
}
