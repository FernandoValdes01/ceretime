// Puerto con que el Administrador lista y habilita cuentas de Practicante.
import type { InternAccount, InternAccountEnablementReceipt } from "./administrator-account-models";

export interface AdministratorAccountsPort {
  readInternAccounts(): Promise<readonly InternAccount[]>;
  enableInternAccount(accountId: string): Promise<InternAccountEnablementReceipt>;
}
