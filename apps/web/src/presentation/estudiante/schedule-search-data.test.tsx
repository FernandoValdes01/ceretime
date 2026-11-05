// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
  AgendaSlot,
  SlotModalityFilter,
  SlotSearchResult,
} from "../../application/agenda/agenda-port.ts";
import { useSlotSearch } from "./schedule-search-data.ts";

/**
 * Lectura de horarios (TI2-101): reintentar vuelve a carga y cambiar la
 * modalidad filtra lo ya cargado.
 *
 * Se controla el adaptador con promesas pendientes para observar las
 * transiciones sin depender del tiempo real. Los datos son ficticios.
 */

type Busqueda = { resolve: (value: SlotSearchResult) => void };

const mocks = vi.hoisted(() => ({
  searchSlots: () => Promise.resolve({ status: "empty" } as SlotSearchResult),
}));

vi.mock("../../infrastructure/convex/convex-client", () => ({ convexClient: {} }));

vi.mock("../../infrastructure/agenda/convex-agenda-adapter.ts", () => ({
  createConvexAgendaAdapter: () => ({
    searchSlots: () => mocks.searchSlots(),
  }),
}));

function respuestasControladas() {
  const pendientes: Busqueda[] = [];
  mocks.searchSlots = () => {
    let resolve!: (value: SlotSearchResult) => void;
    const promise = new Promise<SlotSearchResult>((next) => {
      resolve = next;
    });
    pendientes.push({ resolve });
    return promise;
  };
  return pendientes;
}

beforeEach(() => {
  mocks.searchSlots = () => Promise.resolve({ status: "empty" });
});

afterEach(() => {
  cleanup();
});

describe("useSlotSearch (TI2-101)", () => {
  test("cambiar de modalidad filtra lo cargado sin volver a buscar", async () => {
    const enLinea: AgendaSlot = {
      id: "cupo-1",
      professionalId: "pro-1",
      date: "2026-11-09",
      startAt: 1,
      endAt: 2,
      modality: "online",
    };
    const pendientes = respuestasControladas();
    const { result, rerender } = renderHook(
      ({ modality }: { modality: SlotModalityFilter }) => useSlotSearch(modality, 0),
      { initialProps: { modality: "all" } },
    );

    expect(result.current).toBeUndefined();

    await act(async () => {
      pendientes[0].resolve({ status: "ok", slots: [enLinea] });
    });
    expect(result.current).toEqual({ status: "ok", slots: [enLinea] });

    rerender({ modality: "inPerson" });
    expect(result.current).toEqual({ status: "empty" });

    rerender({ modality: "online" });
    expect(result.current).toEqual({ status: "ok", slots: [enLinea] });

    expect(pendientes).toHaveLength(1);
  });

  test("reintentar vuelve a carga antes de la respuesta nueva", async () => {
    const pendientes = respuestasControladas();
    const { result, rerender } = renderHook(
      ({ attempt }: { attempt: number }) => useSlotSearch("all", attempt),
      { initialProps: { attempt: 0 } },
    );

    await act(async () => {
      pendientes[0].resolve({
        status: "error",
        message: "No pudimos cargar los horarios. Inténtalo de nuevo.",
      });
    });
    expect(result.current).toMatchObject({ status: "error" });

    rerender({ attempt: 1 });

    expect(result.current).toBeUndefined();

    await act(async () => {
      pendientes[1].resolve({ status: "ok", slots: [] });
    });
    expect(result.current).toEqual({ status: "ok", slots: [] });
  });
});
