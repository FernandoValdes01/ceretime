import { RoleHome } from "../../../src/presentation/components/role-home";
import { RoleGuard } from "../../../src/presentation/navigation/role-guard";

export default function StudentProfile() {
  return (
    <RoleGuard requiredRole="estudiante">
      <RoleHome
        title="Perfil"
        description="Revisa y actualiza la información de tu cuenta cuando esta sección esté disponible."
      />
    </RoleGuard>
  );
}
