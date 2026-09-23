import { useCallback, useEffect, useRef, useState } from "react";

import type { PractitionerAccount } from "../../application/administrator-account-models";
import type { AdministratorAccountsPort } from "../../application/administrator-accounts-port";

export type AdministratorAccountsLoadStatus = "loading" | "success" | "empty" | "error";
export type AccountEnablementStatus = "idle" | "loading" | "success" | "error";

export interface AccountEnablementState {
  readonly status: AccountEnablementStatus;
  readonly message: string | null;
  readonly error: unknown | null;
}

export interface AdministratorAccountsState {
  readonly status: AdministratorAccountsLoadStatus;
  readonly accounts: readonly PractitionerAccount[];
  readonly error: unknown | null;
  readonly reload: () => void;
  readonly enableAccount: (accountId: string) => Promise<void>;
  readonly getEnablementState: (accountId: string) => AccountEnablementState;
}

interface AccountsLoad {
  readonly port: AdministratorAccountsPort;
  readonly status: Exclude<AdministratorAccountsLoadStatus, "empty">;
  readonly accounts: readonly PractitionerAccount[];
  readonly error: unknown | null;
}

const idleEnablementState: AccountEnablementState = {
  status: "idle",
  message: null,
  error: null,
};

function loadingLoad(port: AdministratorAccountsPort): AccountsLoad {
  return { port, status: "loading", accounts: [], error: null };
}

export function useAdministratorAccounts(
  port: AdministratorAccountsPort,
): AdministratorAccountsState {
  const [load, setLoad] = useState<AccountsLoad>(() => loadingLoad(port));
  const [reloadVersion, setReloadVersion] = useState(0);
  const [enablementStates, setEnablementStates] = useState<
    Readonly<Record<string, AccountEnablementState>>
  >({});
  const readId = useRef(0);
  const pendingAccounts = useRef(new Set<string>());

  const reload = useCallback(() => {
    readId.current += 1;
    setLoad(loadingLoad(port));
    setReloadVersion((version) => version + 1);
  }, [port]);

  useEffect(() => {
    let disposed = false;
    const currentReadId = ++readId.current;
    const isCurrent = () => !disposed && readId.current === currentReadId;

    Promise.resolve()
      .then(() => port.readPractitionerAccounts())
      .then(
        (accounts) => {
          if (isCurrent()) {
            setLoad({ port, status: "success", accounts, error: null });
          }
        },
        (error: unknown) => {
          if (isCurrent()) {
            setLoad({ port, status: "error", accounts: [], error });
          }
        },
      );

    return () => {
      disposed = true;
    };
  }, [port, reloadVersion]);

  const visibleLoad = load.port === port ? load : loadingLoad(port);

  const enableAccount = useCallback(
    async (accountId: string) => {
      if (pendingAccounts.current.has(accountId)) return;
      pendingAccounts.current.add(accountId);
      setEnablementStates((current) => ({
        ...current,
        [accountId]: { status: "loading", message: null, error: null },
      }));

      try {
        const receipt = await port.enablePractitionerAccount(accountId);
        setLoad((current) => ({
          ...current,
          accounts: current.accounts.map((account) =>
            account.id === accountId ? receipt.account : account,
          ),
        }));
        setEnablementStates((current) => ({
          ...current,
          [accountId]: { status: "success", message: receipt.message, error: null },
        }));
      } catch (error) {
        setEnablementStates((current) => ({
          ...current,
          [accountId]: { status: "error", message: null, error },
        }));
      } finally {
        pendingAccounts.current.delete(accountId);
      }
    },
    [port],
  );

  const getEnablementState = useCallback(
    (accountId: string) => enablementStates[accountId] ?? idleEnablementState,
    [enablementStates],
  );

  return {
    status:
      visibleLoad.status === "success" && visibleLoad.accounts.length === 0
        ? "empty"
        : visibleLoad.status,
    accounts: visibleLoad.accounts,
    error: visibleLoad.error,
    reload,
    enableAccount,
    getEnablementState,
  };
}
