export const practitionerRoutes = {
  assigned: "/practicante/asignaciones",
  unassigned: "/practicante/sin-asignacion",
} as const;

export function getPractitionerRoute(hasAssignments: boolean) {
  return hasAssignments ? practitionerRoutes.assigned : practitionerRoutes.unassigned;
}
