import type {
  PractitionerAccount,
  PractitionerAccountEnablementReceipt,
} from "./administrator-account-models";

export interface AdministratorAccountsPort {
  readPractitionerAccounts(): Promise<readonly PractitionerAccount[]>;
  enablePractitionerAccount(accountId: string): Promise<PractitionerAccountEnablementReceipt>;
}
