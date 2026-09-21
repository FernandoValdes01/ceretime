import type { PractitionerAccount } from "../application/administrator-account-models";
import type { AdministratorAccountsPort } from "../application/administrator-accounts-port";

const fictionalPractitionerAccounts: readonly PractitionerAccount[] = [
  {
    id: "practitioner-account-1",
    displayName: "Camila Soto",
    email: "camila.soto@alu.uct.cl",
    status: "pending",
  },
  {
    id: "practitioner-account-2",
    displayName: "Alex Rojas",
    email: "alex.rojas@uct.cl",
    status: "pending",
  },
  {
    id: "practitioner-account-3",
    displayName: "Matías Vera",
    email: "matias.vera@example.com",
    status: "pending",
  },
];

function hasInstitutionalPractitionerEmail(email: string): boolean {
  return /^[^@\s]+@(?:alu\.)?uct\.cl$/i.test(email);
}

export function createMockAdministratorAccountsAdapter(): AdministratorAccountsPort {
  let accounts = fictionalPractitionerAccounts.map((account) => ({ ...account }));

  return {
    async readPractitionerAccounts() {
      return accounts.map((account) => ({ ...account }));
    },
    async enablePractitionerAccount(accountId) {
      const account = accounts.find((candidate) => candidate.id === accountId);
      if (!account) {
        throw new Error("No encontramos la cuenta institucional seleccionada.");
      }
      if (account.status !== "pending") {
        throw new Error("La cuenta institucional ya está habilitada.");
      }
      if (!hasInstitutionalPractitionerEmail(account.email)) {
        throw new Error("Solo puedes habilitar cuentas institucionales @alu.uct.cl o @uct.cl.");
      }

      const enabledAccount: PractitionerAccount = { ...account, status: "enabled" };
      accounts = accounts.map((candidate) =>
        candidate.id === accountId ? enabledAccount : candidate,
      );

      return {
        account: enabledAccount,
        message: "La cuenta institucional quedó habilitada.",
      };
    },
  };
}
