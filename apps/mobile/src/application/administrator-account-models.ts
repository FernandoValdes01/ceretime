export type InternAccountStatus = "pending" | "enabled";

export interface InternAccount {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly status: InternAccountStatus;
}

export interface InternAccountEnablementReceipt {
  readonly account: InternAccount;
  readonly message: string;
}
