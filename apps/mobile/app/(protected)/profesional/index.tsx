import { RoleHome } from "../../../src/presentation/components/role-home";
import { RoleGuard } from "../../../src/presentation/navigation/role-guard";

export default function ProfessionalHome() {
  return (
    <RoleGuard requiredRole="profesional">
      <RoleHome
        title="Inicio de Profesional"
        description="Aquí podrás revisar solicitudes y gestionar acompañamientos. Esta sección está en preparación."
      />
    </RoleGuard>
  );
}
