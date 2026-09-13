import { RoleHome } from "../../../src/presentation/components/role-home";
import { PractitionerAssignmentGuard } from "../../../src/presentation/navigation/practitioner-assignment-guard";

export default function AssignedPractitionerHome() {
  return (
    <PractitionerAssignmentGuard state="assigned">
      <RoleHome
        title="Acompañamientos asignados"
        description="Tienes acompañamientos asignados para revisar. Esta sección de solo lectura está en preparación."
      />
    </PractitionerAssignmentGuard>
  );
}
