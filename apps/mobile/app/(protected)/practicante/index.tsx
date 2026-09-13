import { Redirect } from "expo-router";

import { RoleGuard } from "../../../src/presentation/navigation/role-guard";
import { useNavigationSession } from "../../../src/presentation/navigation/session";
import { getPractitionerRoute } from "../../../src/presentation/navigation/practitioner-routes";

export default function PractitionerHome() {
  const { session } = useNavigationSession();
  const hasAssignments = (session?.user.assignedAccompaniments.length ?? 0) > 0;

  return (
    <RoleGuard requiredRole="practicante">
      <Redirect href={getPractitionerRoute(hasAssignments)} />
    </RoleGuard>
  );
}
