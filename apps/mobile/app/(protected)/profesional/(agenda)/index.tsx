import { RoleGuard } from "../../../../src/presentation/navigation/role-guard";
import { ProfessionalAgendaScreen } from "../../../../src/presentation/profesional/professional-agenda-screen";

export default function ProfessionalAgendaRoute() {
  return (
    <RoleGuard requiredRole="profesional">
      <ProfessionalAgendaScreen />
    </RoleGuard>
  );
}
