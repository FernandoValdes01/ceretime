import { RoleHome } from "../../../src/presentation/components/role-home";
import { PractitionerAssignmentGuard } from "../../../src/presentation/navigation/practitioner-assignment-guard";
import { PractitionerAccessDeniedNotice } from "../../../src/presentation/practicante/practitioner-access-denied-notice";

export default function UnassignedPractitionerHome() {
  return (
    <PractitionerAssignmentGuard state="unassigned">
      <RoleHome
        title="Sin asignaciones"
        description="Tu cuenta de Practicante sólo puede consultar acompañamientos asignados."
      >
        <PractitionerAccessDeniedNotice />
      </RoleHome>
    </PractitionerAssignmentGuard>
  );
}
