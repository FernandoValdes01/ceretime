import { Redirect } from "expo-router";
import { type PropsWithChildren } from "react";

import { useNavigationSession } from "./session";
import { practitionerRoutes } from "./practitioner-routes";
import { RoleGuard } from "./role-guard";

type PractitionerAssignmentState = "assigned" | "unassigned";

export function PractitionerAssignmentGuard({
  state,
  children,
}: PropsWithChildren<{ readonly state: PractitionerAssignmentState }>) {
  const { session } = useNavigationSession();
  const hasAssignments = (session?.user.assignedAccompaniments.length ?? 0) > 0;
  const expectedAssignments = state === "assigned";
  const destination = hasAssignments ? practitionerRoutes.assigned : practitionerRoutes.unassigned;

  return (
    <RoleGuard requiredRole="practicante">
      {hasAssignments === expectedAssignments ? children : <Redirect href={destination} />}
    </RoleGuard>
  );
}
