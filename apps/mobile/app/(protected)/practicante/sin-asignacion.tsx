import { RoleHome } from "../../../src/presentation/components/role-home";
import { InternAssignmentGuard } from "../../../src/presentation/navigation/intern-assignment-guard";
import { InternAccessDeniedNotice } from "../../../src/presentation/practicante/intern-access-denied-notice";

export default function UnassignedInternHome() {
  return (
    <InternAssignmentGuard state="unassigned">
      <RoleHome
        title="Sin asignaciones"
        description="Tu cuenta de Practicante sólo puede consultar acompañamientos asignados."
      >
        <InternAccessDeniedNotice />
      </RoleHome>
    </InternAssignmentGuard>
  );
}
