import { RoleGuard } from "../../../src/presentation/navigation/role-guard";
import { RoleHome } from "../../../src/presentation/components/role-home";
import { useNavigationSession } from "../../../src/presentation/navigation/session";

export default function PractitionerHome() {
  const { session } = useNavigationSession();
  const hasAssignments = (session?.user.assignedAccompaniments.length ?? 0) > 0;

  return (
    <RoleGuard requiredRole="practicante">
      <RoleHome
        title="Inicio de Practicante"
        description={
          hasAssignments
            ? "Tienes acompañamientos asignados para revisar. Esta sección de solo lectura está en preparación."
            : "Acceso restringido: todavía no tienes acompañamientos asignados. Te avisaremos cuando exista uno."
        }
      />
    </RoleGuard>
  );
}
