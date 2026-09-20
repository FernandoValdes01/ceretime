import { createContext, useContext, type PropsWithChildren } from "react";

import type { AdministratorAccountsPort } from "@/application/administrator-accounts-port";
import {
  useAdministratorAccounts,
  type AdministratorAccountsState,
} from "@/presentation/hooks/use-administrator-accounts";

const AdministratorAccountsContext = createContext<AdministratorAccountsState | null>(null);

export function AdministratorAccountsProvider({
  port,
  children,
}: PropsWithChildren<{ readonly port: AdministratorAccountsPort }>) {
  const state = useAdministratorAccounts(port);
  return <AdministratorAccountsContext value={state}>{children}</AdministratorAccountsContext>;
}

export function useAdministratorAccountsContext(): AdministratorAccountsState {
  const state = useContext(AdministratorAccountsContext);
  if (!state) {
    throw new Error("Las pantallas administrativas necesitan AdministratorAccountsProvider.");
  }
  return state;
}
