import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import type {
  StudentAreaSnapshot,
  StudentIdentity,
  StudentRequest,
} from "../../domain/student-area-models";
import type { Accompaniment } from "../../domain/request-models";
import type { StudentAreaReader } from "../../application/student-area-port";
import { isMobileAccessDenied } from "../../application/access-denied";
import { toMobileOperationError } from "../to-mobile-operation-error";

export type StudentAreaLoadStatus = "loading" | "success" | "error" | "access-denied";
export type StudentAreaCollectionStatus = StudentAreaLoadStatus | "empty";

export interface StudentIdentityState {
  readonly status: StudentAreaLoadStatus;
  readonly data: StudentIdentity | null;
  readonly error: unknown | null;
  readonly reload: () => void;
}

export interface StudentRequestsState {
  readonly status: StudentAreaCollectionStatus;
  readonly data: readonly StudentRequest[];
  readonly error: unknown | null;
  readonly reload: () => void;
}

export interface StudentAccompanimentsState {
  readonly status: StudentAreaCollectionStatus;
  readonly data: readonly Accompaniment[];
  readonly error: unknown | null;
  readonly reload: () => void;
}

export interface StudentAreaState {
  readonly status: StudentAreaLoadStatus;
  readonly snapshot: StudentAreaSnapshot | null;
  readonly error: unknown | null;
  readonly reload: () => void;
  /** Vuelve a leer sin vaciar la pantalla, para traer cambios hechos fuera de la app. */
  readonly refresh: () => void;
  // La identidad siempre viene en el snapshot, por eso no tiene estado `empty`.
  readonly identity: StudentIdentityState;
  readonly requests: StudentRequestsState;
  readonly accompaniments: StudentAccompanimentsState;
}

interface StudentAreaLoad {
  readonly reader: StudentAreaReader;
  readonly status: StudentAreaLoadStatus;
  readonly snapshot: StudentAreaSnapshot | null;
  readonly error: unknown | null;
}

function loadingLoad(reader: StudentAreaReader): StudentAreaLoad {
  return { reader, status: "loading", snapshot: null, error: null };
}

function errorLoad(reader: StudentAreaReader, error: unknown): StudentAreaLoad {
  return {
    reader,
    status: isMobileAccessDenied(error) ? "access-denied" : "error",
    snapshot: null,
    error: toMobileOperationError(error, "No pudimos cargar tus solicitudes. Intenta nuevamente."),
  };
}

// Un refresco que falla conserva lo ya leído; perder el acceso sí lo retira.
function failedLoad(
  previous: StudentAreaLoad,
  reader: StudentAreaReader,
  error: unknown,
): StudentAreaLoad {
  const failed = errorLoad(reader, error);
  const keepsPrevious =
    failed.status !== "access-denied" &&
    previous.reader === reader &&
    previous.status === "success";
  return keepsPrevious ? previous : failed;
}

function successLoad(reader: StudentAreaReader, snapshot: StudentAreaSnapshot): StudentAreaLoad {
  return { reader, status: "success", snapshot, error: null };
}

/**
 * Reads one complete student-area snapshot for this hook instance.
 *
 * The reader is an injected application port. Keep its object identity stable
 * while the source is unchanged; replacing it intentionally starts a fresh
 * read and hides the previous source's data.
 */
export function useStudentArea(reader: StudentAreaReader): StudentAreaState {
  const [load, setLoad] = useState<StudentAreaLoad>(() => loadingLoad(reader));
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestId = useRef(0);
  // Empieza en `true` porque el montaje siempre lee, incluso antes de que corra su efecto.
  const reading = useRef(true);

  const reload = useCallback(() => {
    // Invalidate the previous Promise before React runs the next effect.
    requestId.current += 1;
    reading.current = true;
    setLoad(loadingLoad(reader));
    setReloadVersion((version) => version + 1);
  }, [reader]);

  const refresh = useCallback(() => {
    if (reading.current) return;
    reading.current = true;
    setReloadVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    let disposed = false;
    const currentRequestId = ++requestId.current;

    const isCurrent = () => !disposed && requestId.current === currentRequestId;
    reading.current = true;
    const fail = (error: unknown) => {
      if (!isCurrent()) return;
      reading.current = false;
      setLoad((previous) => failedLoad(previous, reader, error));
    };
    let pending: Promise<StudentAreaSnapshot>;

    try {
      // The try/catch intentionally surrounds invocation as well as awaiting:
      // an adapter can fail synchronously before returning its Promise.
      pending = reader.readStudentArea();
    } catch (error) {
      fail(error);
      return () => {
        disposed = true;
      };
    }

    Promise.resolve(pending).then((snapshot) => {
      if (isCurrent()) {
        reading.current = false;
        setLoad(successLoad(reader, snapshot));
      }
    }, fail);

    return () => {
      disposed = true;
    };
  }, [reader, reloadVersion]);

  useEffect(() => reader.subscribe?.(reload), [reader, reload]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  // During the render in which a new reader is supplied, effects have not run
  // yet. Deriving visibility from the reader prevents one frame of stale data.
  const visibleLoad = load.reader === reader ? load : loadingLoad(reader);
  const snapshot = visibleLoad.snapshot;
  const error = visibleLoad.error;
  const requestData = snapshot?.requests ?? [];
  const accompanimentData = snapshot?.accompaniments ?? [];
  const identity: StudentIdentityState = {
    status: visibleLoad.status,
    data: snapshot?.student ?? null,
    error,
    reload,
  };
  const requests: StudentRequestsState = {
    status:
      visibleLoad.status === "success"
        ? requestData.length === 0
          ? "empty"
          : "success"
        : visibleLoad.status,
    data: requestData,
    error,
    reload,
  };
  const accompaniments: StudentAccompanimentsState = {
    status:
      visibleLoad.status === "success"
        ? accompanimentData.length === 0
          ? "empty"
          : "success"
        : visibleLoad.status,
    data: accompanimentData,
    error,
    reload,
  };

  return {
    status: visibleLoad.status,
    snapshot,
    error,
    reload,
    refresh,
    identity,
    requests,
    accompaniments,
  };
}
