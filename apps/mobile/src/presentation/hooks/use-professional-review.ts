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

const loadingActionState: ProfessionalReviewActionState = {
  status: "loading",
  message: null,
  error: null,
};
const loadErrorMessage = "No pudimos cargar las solicitudes del Profesional. Intenta nuevamente.";

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

// Mantiene lectura y acciones separadas: una acción puede terminar después de cambiar el port.
export function useProfessionalReview(port: ProfessionalReviewPort): ProfessionalReviewState {
  const [load, setLoad] = useState<ReviewLoad>(() => loadingLoad(port));
  const [reloadVersion, setReloadVersion] = useState(0);
  const [feedback, setFeedback] = useState<{
    port: ProfessionalReviewPort;
    actions: Readonly<Record<string, ProfessionalReviewActionState>>;
    requests: Readonly<Record<string, ProfessionalReviewActionState>>;
    pending: ReadonlySet<string>;
  }>({ port, actions: {}, requests: {}, pending: new Set() });
  if (feedback.port !== port) {
    // Conserva los pendientes para impedir duplicar una operación que aún sigue ejecutándose.
    setFeedback({ port, actions: {}, requests: {}, pending: feedback.pending });
  }
  const activePort = useRef<ProfessionalReviewPort | null>(port);
  const actionEpoch = useRef(0);
  const pendingRequests = useRef(new Set<string>());
  useEffect(() => {
    activePort.current = port;
    actionEpoch.current += 1;
    return () => {
      activePort.current = null;
      actionEpoch.current += 1;
    };
  }, [port]);
  const requestId = useRef(0);

  const reload = useCallback(() => {
    // Invalida lecturas anteriores antes de que React ejecute el siguiente efecto.
    requestId.current += 1;
    setLoad(loadingLoad(port));
    setFeedback((current) => ({ port, actions: {}, requests: {}, pending: current.pending }));
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
        setLoad(errorLoad(port, toMobileOperationError(error, loadErrorMessage)));
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
          setLoad(errorLoad(port, toMobileOperationError(error, loadErrorMessage)));
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
      const pending = pendingRequests.current;
      // Una operación por solicitud evita escrituras simultáneas sobre el mismo registro.
      if (activePort.current !== port || pending.has(requestIdToUpdate)) return;
      pending.add(requestIdToUpdate);
      const epoch = actionEpoch.current;
      // La época descarta resultados de acciones iniciadas por un port ya reemplazado.
      const key = actionKey(requestIdToUpdate, action);
      const publishFeedback = (state: ProfessionalReviewActionState) => {
        // También protege los estados de carga y error, no solo la respuesta exitosa.
        if (activePort.current !== port || actionEpoch.current !== epoch) return;
        setFeedback((current) => ({
          port,
          pending:
            state.status === "loading"
              ? new Set(current.pending).add(requestIdToUpdate)
              : current.pending,
          actions: { ...(current.port === port ? current.actions : {}), [key]: state },
          requests: {
            ...(current.port === port ? current.requests : {}),
            [requestIdToUpdate]: state,
          },
        }));
      };
      publishFeedback({ status: "loading", message: null, error: null });

      try {
        const receipt = await port.performProfessionalRequestAction(
          requestIdToUpdate,
          action,
          details,
        );
        if (activePort.current === port && actionEpoch.current === epoch) {
          setLoad((current) => ({
            ...current,
            requests: current.requests.map((request) =>
              request.id === requestIdToUpdate ? receipt.request : request,
            ),
          }));
          publishFeedback({ status: "success", message: receipt.message, error: null });
        }
      } catch (error) {
        const safeError = toMobileOperationError(
          error,
          "No pudimos actualizar la solicitud. Intenta nuevamente.",
        );
        publishFeedback({ status: "error", message: null, error: safeError });
      } finally {
        pending.delete(requestIdToUpdate);
        if (activePort.current)
          setFeedback((current) => {
            const nextPending = new Set(current.pending);
            nextPending.delete(requestIdToUpdate);
            return { ...current, pending: nextPending };
          });
      }
    },
    [port],
  );

  const getActionState = useCallback(
    (requestIdToRead: string, action: ProfessionalRequestAction) => {
      if (feedback.pending.has(requestIdToRead)) return loadingActionState;
      return feedback.port === port
        ? (feedback.actions[actionKey(requestIdToRead, action)] ?? idleActionState)
        : idleActionState;
    },
    [feedback, port],
  );

  const getRequestFeedback = useCallback(
    (requestIdToRead: string) => {
      if (feedback.pending.has(requestIdToRead)) return loadingActionState;
      return feedback.port === port
        ? (feedback.requests[requestIdToRead] ?? idleActionState)
        : idleActionState;
    },
    [feedback, port],
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
