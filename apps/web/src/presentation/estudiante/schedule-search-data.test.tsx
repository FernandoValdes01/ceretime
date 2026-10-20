// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SlotModalityFilter, SlotSearchResult } from "../../application/agenda/agenda-port.ts";
import { useSlotSearch } from "./schedule-search-data.ts";

/**
 * Lectura de horarios (TI2-101): cada búsqueda vuelve a carga.
 *
 * Se controla el adaptador con promesas pendientes para observar las
 * transiciones sin depender del tiempo real. Los datos son ficticios.
 */

type Busqueda = { resolve: (value: SlotSearchResult) => void };

const mocks = vi.hoisted(() => ({
  searchSlots: (_filter: { modality: string }) =>
    Promise.resolve({ status: "empty" } as SlotSearchResult),
}));

vi.mock("../../infrastructure/agenda/fictitious-agenda-adapter.ts", () => ({
  createFictitiousAgendaAdapter: () => ({
    searchSlots: (filter: { modality: string }) => mocks.searchSlots(filter),
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
  test("cambiar de modalidad vuelve a carga antes de la respuesta nueva", async () => {
    const pendientes = respuestasControladas();
    const { result, rerender } = renderHook(
      ({ modality }: { modality: SlotModalityFilter }) => useSlotSearch(modality, 0),
      { initialProps: { modality: "all" } },
    );

    expect(result.current).toBeUndefined();

    await act(async () => {
      pendientes[0].resolve({ status: "ok", slots: [] });
    });
    expect(result.current).toEqual({ status: "ok", slots: [] });

    rerender({ modality: "inPerson" });

    expect(result.current).toBeUndefined();

    await act(async () => {
      pendientes[1].resolve({ status: "empty" });
    });
    expect(result.current).toEqual({ status: "empty" });
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
