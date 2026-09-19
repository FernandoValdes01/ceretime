import { RoleHome } from "../../../src/presentation/components/role-home";
import { RoleGuard } from "../../../src/presentation/navigation/role-guard";

export default function AdministratorUsers() {
  return (
    <RoleGuard requiredRole="administrador">
      <RoleHome
        title="Usuarios"
        description="Aquí podrás gestionar la habilitación de cuentas. Esta sección está en preparación."
      />
    </RoleGuard>
  );
}
