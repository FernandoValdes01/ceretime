import { RoleHome } from "../../../src/presentation/components/role-home";
import { RoleGuard } from "../../../src/presentation/navigation/role-guard";

export default function PractitionerProfile() {
  return (
    <RoleGuard requiredRole="practicante">
      <RoleHome
        title="Perfil"
        description="La configuración de tu perfil estará disponible próximamente."
      />
    </RoleGuard>
  );
}
