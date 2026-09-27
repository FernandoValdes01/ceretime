import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ProfessionalRequest,
  ProfessionalRequestAction,
  ProfessionalActionDetails,
} from "../../application/professional-review-models";
import type { ProfessionalReviewPort } from "../../application/professional-review-port";
import { toMobileOperationError } from "../to-mobile-operation-error";

export type ProfessionalReviewLoadStatus = "loading" | "success" | "empty" | "error";
export type ProfessionalReviewActionStatus = "idle" | "loading" | "success" | "error";

export interface ProfessionalReviewActionState {
  readonly status: ProfessionalReviewActionStatus;
  readonly message: string | null;
  readonly error: unknown | null;
}

export interface ProfessionalReviewState {
  readonly status: ProfessionalReviewLoadStatus;
  readonly requests: readonly ProfessionalRequest[];
  readonly error: unknown | null;
  readonly reload: () => void;
  readonly performAction: (
    requestId: string,
    action: ProfessionalRequestAction,
    details?: ProfessionalActionDetails,
  ) => Promise<void>;
  readonly getActionState: (
    requestId: string,
    action: ProfessionalRequestAction,
  ) => ProfessionalReviewActionState;
  readonly getRequestFeedback: (requestId: string) => ProfessionalReviewActionState;
}

interface ReviewLoad {
  readonly port: ProfessionalReviewPort;
  readonly status: Exclude<ProfessionalReviewLoadStatus, "empty">;
  readonly requests: readonly ProfessionalRequest[];
  readonly error: unknown | null;
}

const idleActionState: ProfessionalReviewActionState = {
  status: "idle",
  message: null,
  error: null,
};

function actionKey(requestId: string, action: ProfessionalRequestAction) {
  return `${requestId}:${action}`;
}

function loadingLoad(port: ProfessionalReviewPort): ReviewLoad {
  return { port, status: "loading", requests: [], error: null };
}

function errorLoad(port: ProfessionalReviewPort, error: unknown): ReviewLoad {
  return { port, status: "error", requests: [], error };
}

function successLoad(
  port: ProfessionalReviewPort,
  requests: readonly ProfessionalRequest[],
): ReviewLoad {
  return { port, status: "success", requests, error: null };
}

export function useProfessionalReview(port: ProfessionalReviewPort): ProfessionalReviewState {
  const [load, setLoad] = useState<ReviewLoad>(() => loadingLoad(port));
  const [reloadVersion, setReloadVersion] = useState(0);
  const [actionStates, setActionStates] = useState<
    Readonly<Record<string, ProfessionalReviewActionState>>
  >({});
  const [requestFeedback, setRequestFeedback] = useState<
    Readonly<Record<string, ProfessionalReviewActionState>>
  >({});
  const requestId = useRef(0);

  const reload = useCallback(() => {
    requestId.current += 1;
    setLoad(loadingLoad(port));
    setActionStates({});
    setRequestFeedback({});
    setReloadVersion((version) => version + 1);
  }, [port]);

  useEffect(() => {
    let disposed = false;
    const currentRequestId = ++requestId.current;
    const isCurrent = () => !disposed && requestId.current === currentRequestId;
    let pending: Promise<readonly ProfessionalRequest[]>;

    try {
      pending = port.readProfessionalRequests();
    } catch (error) {
      if (isCurrent()) {
        setLoad(
          errorLoad(
            port,
            toMobileOperationError(
              error,
              "No pudimos cargar las solicitudes del Profesional. Intenta nuevamente.",
            ),
          ),
        );
      }
      return () => {
        disposed = true;
      };
    }

    Promise.resolve(pending).then(
      (requests) => {
        if (isCurrent()) setLoad(successLoad(port, requests));
      },
      (error: unknown) => {
        if (isCurrent()) {
          setLoad(
            errorLoad(
              port,
              toMobileOperationError(
                error,
                "No pudimos cargar las solicitudes del Profesional. Intenta nuevamente.",
              ),
            ),
          );
        }
      },
    );

    return () => {
      disposed = true;
    };
  }, [port, reloadVersion]);

  const visibleLoad = load.port === port ? load : loadingLoad(port);

  const performAction = useCallback(
    async (
      requestIdToUpdate: string,
      action: ProfessionalRequestAction,
      details?: ProfessionalActionDetails,
    ) => {
      const key = actionKey(requestIdToUpdate, action);
      setActionStates((current) => ({
        ...current,
        [key]: { status: "loading", message: null, error: null },
      }));

      try {
        const receipt = await port.performProfessionalRequestAction(
          requestIdToUpdate,
          action,
          details,
        );
        setLoad((current) => ({
          ...current,
          requests: current.requests.map((request) =>
            request.id === requestIdToUpdate ? receipt.request : request,
          ),
        }));
        setActionStates((current) => ({
          ...current,
          [key]: { status: "success", message: receipt.message, error: null },
        }));
        setRequestFeedback((current) => ({
          ...current,
          [requestIdToUpdate]: { status: "success", message: receipt.message, error: null },
        }));
      } catch (error) {
        const safeError = toMobileOperationError(
          error,
          "No pudimos actualizar la solicitud. Intenta nuevamente.",
        );
        setActionStates((current) => ({
          ...current,
          [key]: { status: "error", message: null, error: safeError },
        }));
        setRequestFeedback((current) => ({
          ...current,
          [requestIdToUpdate]: { status: "error", message: null, error: safeError },
        }));
      }
    },
    [port],
  );

  const getActionState = useCallback(
    (requestIdToRead: string, action: ProfessionalRequestAction) =>
      actionStates[actionKey(requestIdToRead, action)] ?? idleActionState,
    [actionStates],
  );

  const getRequestFeedback = useCallback(
    (requestIdToRead: string) => requestFeedback[requestIdToRead] ?? idleActionState,
    [requestFeedback],
  );

  return {
    status:
      visibleLoad.status === "success" && visibleLoad.requests.length === 0
        ? "empty"
        : visibleLoad.status,
    requests: visibleLoad.requests,
    error: visibleLoad.error,
    reload,
    performAction,
    getActionState,
    getRequestFeedback,
  };
}
