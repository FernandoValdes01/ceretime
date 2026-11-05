import type { InternAccount } from "../domain/administrator-account-models";
import type { AdministratorAccountsPort } from "../application/administrator-accounts-port";
import { LocalOperationError } from "../domain/operation-error";

const demoInternAccounts: readonly InternAccount[] = [
  {
    id: "intern-account-1",
    displayName: "Camila Soto",
    email: "camila.soto@alu.uct.cl",
    status: "pending",
  },
  {
    id: "intern-account-2",
    displayName: "Alex Rojas",
    email: "alex.rojas@uct.cl",
    status: "pending",
  },
  {
    id: "intern-account-3",
    displayName: "Matías Vera",
    email: "matias.vera@example.com",
    status: "pending",
  },
  {
    id: "intern-account-4",
    displayName: "Valentina Rojas",
    email: "valentina.rojas@uct.cl",
    status: "enabled",
  },
];

function hasInstitutionalInternEmail(email: string): boolean {
  return /^[^@\s]+@(?:alu\.)?uct\.cl$/i.test(email);
}

export function createDemoAdministratorAccountsAdapter(): AdministratorAccountsPort {
  let accounts = demoInternAccounts.map((account) => ({ ...account }));

  return {
    async readInternAccounts() {
      return accounts.map((account) => ({ ...account }));
    },
    async enableInternAccount(accountId) {
      const account = accounts.find((candidate) => candidate.id === accountId);
      if (!account) {
        throw new LocalOperationError("No encontramos la cuenta institucional seleccionada.");
      }
      if (account.status !== "pending") {
        throw new LocalOperationError("La cuenta institucional ya está habilitada.");
      }
      if (!hasInstitutionalInternEmail(account.email)) {
        throw new LocalOperationError(
          "Solo puedes habilitar cuentas institucionales @alu.uct.cl o @uct.cl.",
        );
      }

      const enabledAccount: InternAccount = { ...account, status: "enabled" };
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
