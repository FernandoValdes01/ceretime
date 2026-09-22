export type PractitionerAccountStatus = "pending" | "enabled";

export interface PractitionerAccount {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly status: PractitionerAccountStatus;
}

export interface PractitionerAccountEnablementReceipt {
  readonly account: PractitionerAccount;
  readonly message: string;
}
