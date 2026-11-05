import { Redirect } from "expo-router";

import { RoleGuard } from "../../../src/presentation/navigation/role-guard";
import { useNavigationSession } from "../../../src/presentation/navigation/session";
import {
  getInternRoute,
  hasValidInternAssignments,
} from "../../../src/presentation/navigation/intern-routes";

export default function InternHome() {
  const { session } = useNavigationSession();
  const hasAssignments = hasValidInternAssignments(session?.user.assignedAccompaniments ?? []);

  return (
    <RoleGuard requiredRole="practicante">
      <Redirect href={getInternRoute(hasAssignments)} />
    </RoleGuard>
  );
}
