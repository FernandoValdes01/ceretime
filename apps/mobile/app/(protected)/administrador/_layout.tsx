import { mobileDependencies } from "../../../src/composition/mobile-dependencies";
import { AdministratorAccountsProvider } from "../../../src/presentation/administrador/administrator-accounts-provider";
import RoleLayout from "../../../src/presentation/navigation/role-layout";

export default function AdministratorLayout() {
  return (
    <AdministratorAccountsProvider port={mobileDependencies.administratorAccountsPort}>
      <RoleLayout />
    </AdministratorAccountsProvider>
  );
}
