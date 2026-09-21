import { RoleGuard } from "../../../../src/presentation/navigation/role-guard";
import { ProfessionalRequestDetailScreen } from "../../../../src/presentation/profesional/professional-request-detail-screen";

export default function ProfessionalRequestDetailRoute() {
  return (
    <RoleGuard requiredRole="profesional">
      <ProfessionalRequestDetailScreen />
    </RoleGuard>
  );
}
