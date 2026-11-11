import { RoleGuard } from "../../../../src/presentation/navigation/role-guard";
import { ProfessionalAgendaDetailScreen } from "../../../../src/presentation/profesional/professional-agenda-detail-screen";

export default function ProfessionalAgendaDetailRoute() {
  return (
    <RoleGuard requiredRole="profesional">
      <ProfessionalAgendaDetailScreen />
    </RoleGuard>
  );
}
