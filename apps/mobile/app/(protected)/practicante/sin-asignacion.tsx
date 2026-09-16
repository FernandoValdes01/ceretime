import { RoleHome } from "../../../src/presentation/components/role-home";
import { PractitionerAssignmentGuard } from "../../../src/presentation/navigation/practitioner-assignment-guard";

export default function UnassignedPractitionerHome() {
  return (
    <PractitionerAssignmentGuard state="unassigned">
      <RoleHome
        title="Sin asignaciones"
        description="Todavía no tienes acompañamientos asignados. Te avisaremos cuando exista uno."
      />
    </PractitionerAssignmentGuard>
  );
}
