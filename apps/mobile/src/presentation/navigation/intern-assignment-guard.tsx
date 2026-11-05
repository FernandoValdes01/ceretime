import { Redirect } from "expo-router";
import { type PropsWithChildren } from "react";

import { useNavigationSession } from "./session";
import { hasValidInternAssignments, getInternRoute } from "./intern-routes";
import { RoleGuard } from "./role-guard";

type InternAssignmentState = "assigned" | "unassigned";

// El Practicante con asignaciones ve sus acompañamientos; sin ellas, solo la pantalla de espera.
export function InternAssignmentGuard({
  state,
  children,
}: PropsWithChildren<{ readonly state: InternAssignmentState }>) {
  const { session } = useNavigationSession();
  const hasAssignments = hasValidInternAssignments(session?.user.assignedAccompaniments ?? []);
  const expectedAssignments = state === "assigned";
  const destination = getInternRoute(hasAssignments);

  return (
    <RoleGuard requiredRole="practicante">
      {hasAssignments === expectedAssignments ? children : <Redirect href={destination} />}
    </RoleGuard>
  );
}
