import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  Accompaniment,
  StudentAreaSnapshot,
  StudentIdentity,
  StudentRequest,
} from '../../application/student-area-models';
import type { StudentAreaReader } from '../../application/student-area-port';

export type StudentAreaLoadStatus = 'loading' | 'success' | 'error';
export type StudentAreaCollectionStatus = StudentAreaLoadStatus | 'empty';

export interface StudentAreaSnapshotState {
  readonly status: StudentAreaLoadStatus;
  readonly snapshot: StudentAreaSnapshot | null;
  readonly error: unknown | null;
  readonly reload: () => void;
}

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

export interface StudentAreaState extends StudentAreaSnapshotState {
  /** Identity is required by the snapshot and therefore has no `empty` state. */
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
  return { reader, status: 'loading', snapshot: null, error: null };
}

function errorLoad(reader: StudentAreaReader, error: unknown): StudentAreaLoad {
  return { reader, status: 'error', snapshot: null, error };
}

function successLoad(
  reader: StudentAreaReader,
  snapshot: StudentAreaSnapshot,
): StudentAreaLoad {
  return { reader, status: 'success', snapshot, error: null };
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

  const reload = useCallback(() => {
    // Invalidate the previous Promise before React runs the next effect.
    requestId.current += 1;
    setLoad(loadingLoad(reader));
    setReloadVersion((version) => version + 1);
  }, [reader]);

  useEffect(() => {
    let disposed = false;
    const currentRequestId = ++requestId.current;

    setLoad(loadingLoad(reader));

    const isCurrent = () =>
      !disposed && requestId.current === currentRequestId;
    let pending: Promise<StudentAreaSnapshot>;

    try {
      // The try/catch intentionally surrounds invocation as well as awaiting:
      // an adapter can fail synchronously before returning its Promise.
      pending = reader.readStudentArea();
    } catch (error) {
      if (isCurrent()) {
        setLoad(errorLoad(reader, error));
      }
      return () => {
        disposed = true;
      };
    }

    Promise.resolve(pending).then(
      (snapshot) => {
        if (isCurrent()) {
          setLoad(successLoad(reader, snapshot));
        }
      },
      (error: unknown) => {
        if (isCurrent()) {
          setLoad(errorLoad(reader, error));
        }
      },
    );

    return () => {
      disposed = true;
    };
  }, [reader, reloadVersion]);

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
      visibleLoad.status === 'success'
        ? requestData.length === 0
          ? 'empty'
          : 'success'
        : visibleLoad.status,
    data: requestData,
    error,
    reload,
  };
  const accompaniments: StudentAccompanimentsState = {
    status:
      visibleLoad.status === 'success'
        ? accompanimentData.length === 0
          ? 'empty'
          : 'success'
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
    identity,
    requests,
    accompaniments,
  };
}

/** Snapshot-only view; it still performs exactly one read for this instance. */
export function useStudentAreaSnapshot(
  reader: StudentAreaReader,
): StudentAreaSnapshotState {
  const area = useStudentArea(reader);
  return {
    status: area.status,
    snapshot: area.snapshot,
    error: area.error,
    reload: area.reload,
  };
}

/** Optional aggregate view. Prefer `useStudentArea` when several are needed. */
export function useStudentIdentity(
  reader: StudentAreaReader,
): StudentIdentityState {
  return useStudentArea(reader).identity;
}

/** Optional aggregate view. Prefer `useStudentArea` when several are needed. */
export function useStudentRequests(
  reader: StudentAreaReader,
): StudentRequestsState {
  return useStudentArea(reader).requests;
}

/** Optional aggregate view. Prefer `useStudentArea` when several are needed. */
export function useStudentAccompaniments(
  reader: StudentAreaReader,
): StudentAccompanimentsState {
  return useStudentArea(reader).accompaniments;
}
