import { useCallback, useEffect, useRef, useState } from "react";

type ResourceResult<T> =
  | { readonly status: "loading"; readonly data: null; readonly error: null }
  | { readonly status: "success"; readonly data: T; readonly error: null }
  | { readonly status: "error"; readonly data: null; readonly error: unknown };

interface ResourceLoad<T> {
  readonly read: () => Promise<T>;
  readonly version: number;
  readonly result: ResourceResult<T>;
}

/** El callback estable identifica el recurso. Reemplazarlo oculta y descarta la lectura anterior. */
export function useAsyncResource<T>(read: () => Promise<T>, enabled = true) {
  const [version, setVersion] = useState(0);
  const [load, setLoad] = useState<ResourceLoad<T> | null>(null);
  const requestId = useRef(0);
  const reload = useCallback(() => {
    // Invalidar de inmediato también protege una recarga anterior al próximo efecto.
    requestId.current += 1;
    setVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const currentRequest = ++requestId.current;
    const publish = (result: ResourceResult<T>) => {
      if (!disposed && requestId.current === currentRequest) {
        setLoad({ read, version, result });
      }
    };
    try {
      Promise.resolve(read()).then(
        (data) => publish({ status: "success", data, error: null }),
        (error: unknown) => publish({ status: "error", data: null, error }),
      );
    } catch (error) {
      publish({ status: "error", data: null, error });
    }
    return () => {
      disposed = true;
    };
  }, [read, enabled, version]);

  const result: ResourceResult<T> =
    enabled && load?.read === read && load.version === version
      ? load.result
      : { status: "loading", data: null, error: null };
  return { ...result, reload };
}
