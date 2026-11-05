import { StrictMode } from "react";
import { ConvexError } from "convex/values";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ProfessionalAgendaDayViewModel } from "@/application/professional-agenda-view-models";
import type { ProfessionalAccompaniment } from "@/application/professional-accompaniment-models";
import type { ProfessionalAccompanimentReader } from "@/application/professional-accompaniment-port";
import type { InternAccompaniment } from "@/application/intern-accompaniment-models";
import type { InternAccompanimentReader } from "@/application/intern-accompaniment-port";
import { InternAccompanimentAccessDeniedError } from "@/application/intern-accompaniment-port";
import { createDemoProfessionalAccompanimentReader } from "@/infrastructure/demo-professional-accompaniment-reader";
import { createDemoInternAccompanimentReader } from "@/infrastructure/demo-intern-accompaniment-reader";
import { demoProfessionalAgenda } from "@/infrastructure/demo-professional-agenda-data";
import { useProfessionalAgenda } from "@/presentation/hooks/use-professional-agenda";
import { useProfessionalAccompaniments } from "@/presentation/hooks/use-professional-accompaniments";
import { useProfessionalAccompaniment } from "@/presentation/hooks/use-professional-accompaniment";
import { useInternAccompaniments } from "@/presentation/hooks/use-intern-accompaniments";
import { useInternAccompaniment } from "@/presentation/hooks/use-intern-accompaniment";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("una recarga descarta la respuesta anterior y un reemplazo oculta los datos profesionales", async () => {
  const first = deferred<readonly ProfessionalAccompaniment[]>();
  const retry = deferred<readonly ProfessionalAccompaniment[]>();
  const adapter = createDemoProfessionalAccompanimentReader();
  const rows = await adapter.readAccompaniments();
  const reader: ProfessionalAccompanimentReader = {
    ...adapter,
    readAccompaniments: jest.fn().mockReturnValueOnce(first.promise).mockReturnValue(retry.promise),
  };
  const { result, rerender } = renderHook(
    ({ source }: { source: ProfessionalAccompanimentReader }) =>
      useProfessionalAccompaniments(source),
    { initialProps: { source: reader } },
  );
  act(() => result.current.reload());
  await act(async () => {
    retry.resolve(rows);
    await retry.promise;
  });
  expect(result.current.data).toEqual(rows);
  await act(async () => {
    first.resolve([]);
    await first.promise;
  });
  expect(result.current.data).toEqual(rows);
  const replacement = deferred<readonly ProfessionalAccompaniment[]>();
  rerender({ source: { ...adapter, readAccompaniments: () => replacement.promise } });
  expect(result.current.status).toBe("loading");
  expect(result.current.data).toEqual([]);
  await act(async () => {
    replacement.reject(new Error("SDK privado"));
    await replacement.promise.catch(() => undefined);
  });
  expect(result.current.error).toEqual(
    new Error("No pudimos cargar los acompañamientos. Intenta nuevamente."),
  );
});

test("el cambio de Practicante descarta tanto resultados como errores antiguos y no consulta sin identidad", async () => {
  const first = deferred<readonly InternAccompaniment[]>();
  const second = deferred<readonly InternAccompaniment[]>();
  const reader: InternAccompanimentReader = {
    readAssignedAccompaniments: jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue([]),
    readAssignedAccompaniment: jest.fn(),
  };
  const { result, rerender } = renderHook(
    ({ id }: { id: string | null }) => useInternAccompaniments(reader, id),
    { initialProps: { id: "first" } },
  );
  rerender({ id: "second" });
  await act(async () => {
    first.reject(new Error("Error de otra cuenta"));
    await first.promise.catch(() => undefined);
  });
  expect(result.current.status).toBe("loading");
  expect(result.current.error).toBeNull();
  await act(async () => {
    second.resolve([]);
    await second.promise;
  });
  expect(result.current.status).toBe("empty");
  rerender({ id: null });
  act(() => result.current.reload());
  expect(reader.readAssignedAccompaniments).toHaveBeenCalledTimes(2);
});

test("dos avances de agenda en el mismo evento acumulan días y descartan la lectura anterior", async () => {
  const first = deferred<ProfessionalAgendaDayViewModel>();
  const second = deferred<ProfessionalAgendaDayViewModel>();
  const reader = {
    readProfessionalAgenda: jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValue(second.promise),
  };
  const { result } = renderHook(() => useProfessionalAgenda(reader));
  act(() => {
    result.current.goToNextDay();
    result.current.goToNextDay();
  });
  expect(reader.readProfessionalAgenda).toHaveBeenLastCalledWith(2);
  await act(async () => {
    second.resolve({ ...demoProfessionalAgenda, id: "current" });
    await second.promise;
  });
  await act(async () => {
    first.resolve({ ...demoProfessionalAgenda, id: "obsolete" });
    await first.promise;
  });
  expect(result.current.data?.id).toBe("current");
});

test("el detalle profesional oculta el recurso anterior y tolera un fallo síncrono con reintento", async () => {
  const adapter = createDemoProfessionalAccompanimentReader();
  const [row] = await adapter.readAccompaniments();
  const old = deferred<ProfessionalAccompaniment>();
  const reader: ProfessionalAccompanimentReader = {
    ...adapter,
    readAccompaniment: jest
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockImplementationOnce(() => {
        throw new Error("SDK privado");
      })
      .mockResolvedValue(row),
  };
  const { result, rerender } = renderHook(
    ({ id }: { id: string }) => useProfessionalAccompaniment(reader, id),
    { initialProps: { id: "old" } },
  );
  rerender({ id: "current" });
  expect(result.current.status).toBe("error");
  expect(result.current.data).toBeNull();
  expect(result.current.error).toEqual(
    new Error("No pudimos cargar el acompañamiento. Intenta nuevamente."),
  );
  await act(async () => {
    old.resolve(row);
    await old.promise;
  });
  expect(result.current.status).toBe("error");
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.status).toBe("success"));
  expect(result.current.data).toEqual(row);
});

test("el detalle asignado conserva la denegación y completa sin publicar después del desmontaje", async () => {
  const adapter = createDemoInternAccompanimentReader();
  const [row] = await adapter.readAssignedAccompaniments("demo-intern-assigned-1");
  const pending = deferred<InternAccompaniment>();
  const readAssignedAccompaniment = jest
    .fn()
    .mockRejectedValue(new InternAccompanimentAccessDeniedError());
  const reader: InternAccompanimentReader = { ...adapter, readAssignedAccompaniment };
  const { result, unmount } = renderHook(
    () => useInternAccompaniment(reader, "demo-intern-assigned-1", row.id),
    { wrapper: StrictMode },
  );
  await waitFor(() => expect(result.current.status).toBe("access-denied"));
  readAssignedAccompaniment.mockReturnValue(pending.promise);
  act(() => result.current.reload());
  expect(result.current.status).toBe("loading");
  unmount();
  await act(async () => {
    pending.resolve(row);
    await pending.promise;
  });
  expect(result.current.status).toBe("loading");
});

test("el detalle interpreta el código de acceso denegado sin depender de su redacción", async () => {
  const reader = {
    readAccompaniments: jest.fn(),
    readAccompaniment: jest
      .fn()
      .mockRejectedValue(new ConvexError({ code: "unauthorized", message: "Otra redacción" })),
  };
  const { result } = renderHook(() => useProfessionalAccompaniment(reader, "foreign"));
  await waitFor(() => expect(result.current.status).toBe("access-denied"));
  expect(result.current.data).toBeNull();
});
