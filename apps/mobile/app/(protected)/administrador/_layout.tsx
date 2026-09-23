import { mobileDependencies } from "../../../src/composition/mobile-dependencies";
import { AdministratorAccountsProvider } from "../../../src/presentation/administrador/administrator-accounts-provider";
import RoleLayout from "../../../src/presentation/navigation/role-layout";
import { RoleGuard } from "../../../src/presentation/navigation/role-guard";

export default function AdministratorLayout() {
  return (
    <RoleGuard requiredRole="administrador">
      <AdministratorAccountsProvider port={mobileDependencies.administratorAccountsPort}>
        <RoleLayout />
      </AdministratorAccountsProvider>
    </RoleGuard>
  );
}
