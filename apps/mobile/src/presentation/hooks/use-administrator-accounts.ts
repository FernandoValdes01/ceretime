import { useCallback, useEffect, useRef, useState } from "react";

import type { PractitionerAccount } from "../../application/administrator-account-models";
import type { AdministratorAccountsPort } from "../../application/administrator-accounts-port";
import { toMobileOperationError } from "../to-mobile-operation-error";

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

const loadingEnablementState: AccountEnablementState = {
  status: "loading",
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
  const [enablement, setEnablement] = useState<{
    port: AdministratorAccountsPort;
    states: Readonly<Record<string, AccountEnablementState>>;
    pending: ReadonlySet<string>;
  }>({ port, states: {}, pending: new Set() });
  if (enablement.port !== port) setEnablement({ port, states: {}, pending: enablement.pending });
  const readId = useRef(0);
  const pendingAccounts = useRef(new Set<string>());
  const activePort = useRef<AdministratorAccountsPort | null>(port);
  const actionEpoch = useRef(0);
  useEffect(() => {
    activePort.current = port;
    actionEpoch.current += 1;
    return () => {
      activePort.current = null;
      actionEpoch.current += 1;
    };
  }, [port]);

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
            setLoad({
              port,
              status: "error",
              accounts: [],
              error: toMobileOperationError(
                error,
                "No pudimos cargar las cuentas institucionales.",
              ),
            });
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
      const pending = pendingAccounts.current;
      if (activePort.current !== port || pending.has(accountId)) return;
      pending.add(accountId);
      const epoch = actionEpoch.current;
      setEnablement((current) => ({
        port,
        pending: new Set(current.pending).add(accountId),
        states: {
          ...(current.port === port ? current.states : {}),
          [accountId]: { status: "loading", message: null, error: null },
        },
      }));

      try {
        const receipt = await port.enablePractitionerAccount(accountId);
        if (activePort.current === port && actionEpoch.current === epoch) {
          setLoad((current) => ({
            ...current,
            accounts: current.accounts.map((account) =>
              account.id === accountId ? receipt.account : account,
            ),
          }));
          setEnablement((current) => ({
            port,
            pending: current.pending,
            states: {
              ...(current.port === port ? current.states : {}),
              [accountId]: { status: "success", message: receipt.message, error: null },
            },
          }));
        }
      } catch (error) {
        if (activePort.current === port && actionEpoch.current === epoch) {
          setEnablement((current) => ({
            port,
            pending: current.pending,
            states: {
              ...(current.port === port ? current.states : {}),
              [accountId]: {
                status: "error",
                message: null,
                error: toMobileOperationError(
                  error,
                  "No pudimos habilitar la cuenta. Intenta nuevamente.",
                ),
              },
            },
          }));
        }
      } finally {
        pending.delete(accountId);
        if (activePort.current)
          setEnablement((current) => {
            const nextPending = new Set(current.pending);
            nextPending.delete(accountId);
            return { ...current, pending: nextPending };
          });
      }
    },
    [port],
  );

  const getEnablementState = useCallback(
    (accountId: string) =>
      enablement.pending.has(accountId)
        ? loadingEnablementState
        : ((enablement.port === port ? enablement.states[accountId] : undefined) ??
          idleEnablementState),
    [enablement, port],
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
