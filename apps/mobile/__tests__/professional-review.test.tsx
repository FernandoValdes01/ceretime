import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { router } from "expo-router";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import path from "node:path";

import { createMockProfessionalReviewAdapter } from "../src/infrastructure/mock-professional-review-adapter";
import type { ProfessionalRequest } from "../src/application/professional-review-models";
import type { ProfessionalReviewPort } from "../src/application/professional-review-port";
import {
  useProfessionalReview,
  type ProfessionalReviewState,
} from "../src/presentation/hooks/use-professional-review";
import { getNoActionMessage } from "../src/presentation/profesional/professional-requests-screen";

const appDirectory = path.resolve(__dirname, "../app");

function ProbeOutput({ value: _value }: { readonly value: unknown }): null {
  return null;
}

function readProbeValue<T>(renderer: ReactTestRenderer): T {
  return renderer.root.findByType(ProbeOutput).props.value as T;
}

function mountReview(port: ProfessionalReviewPort): {
  readonly renderer: ReactTestRenderer;
  readonly getState: () => ProfessionalReviewState;
} {
  function Probe() {
    return React.createElement(ProbeOutput, {
      value: useProfessionalReview(port),
    });
  }

  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Probe));
  });
  return {
    renderer,
    getState: () => readProbeValue<ProfessionalReviewState>(renderer),
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("adaptador de revisión profesional", () => {
  it("expone solo las acciones permitidas y actualiza el estado", async () => {
    const adapter = createMockProfessionalReviewAdapter();

    const requests = await adapter.readProfessionalRequests();
    expect(requests[0]?.availableActions).toEqual(["startReview"]);
    expect(requests[1]?.availableActions).toEqual(["requestInformation"]);
    expect(requests[2]?.availableActions).toEqual([]);

    const reviewReceipt = await adapter.performProfessionalRequestAction(
      "SOL-PRO-001",
      "startReview",
    );
    expect(reviewReceipt.request.status).toBe("underReview");
    expect(reviewReceipt.message).toBe("La solicitud quedó en revisión.");

    const informationReceipt = await adapter.performProfessionalRequestAction(
      "SOL-PRO-002",
      "requestInformation",
    );
    expect(informationReceipt.request.status).toBe("awaitingInformationOrAcceptance");
  });

  it("rechaza una acción que no corresponde al estado actual", async () => {
    const adapter = createMockProfessionalReviewAdapter();

    await expect(
      adapter.performProfessionalRequestAction("SOL-PRO-003", "startReview"),
    ).rejects.toThrow("Esta acción no está disponible");
  });

  it("permite simular errores de carga y de acción", async () => {
    const readErrorAdapter = createMockProfessionalReviewAdapter({
      readMode: "error",
    });
    const actionErrorAdapter = createMockProfessionalReviewAdapter({
      actionMode: "error",
    });

    await expect(readErrorAdapter.readProfessionalRequests()).rejects.toThrow(
      "No pudimos cargar las solicitudes",
    );
    await expect(
      actionErrorAdapter.performProfessionalRequestAction("SOL-PRO-001", "startReview"),
    ).rejects.toThrow("No pudimos actualizar la solicitud");
  });
});

describe("hook y vista de revisión profesional", () => {
  test("expone carga, vacío y feedback de acción", async () => {
    let resolveRead!: (requests: readonly ProfessionalRequest[]) => void;
    const pendingRead = new Promise<readonly ProfessionalRequest[]>((resolve) => {
      resolveRead = resolve;
    });
    const adapter = createMockProfessionalReviewAdapter();
    const port: ProfessionalReviewPort = {
      readProfessionalRequests: () => pendingRead,
      performProfessionalRequestAction: adapter.performProfessionalRequestAction,
    };
    const mounted = mountReview(port);

    expect(mounted.getState().status).toBe("loading");
    await act(async () => {
      resolveRead(await adapter.readProfessionalRequests());
      await pendingRead;
    });
    expect(mounted.getState().status).toBe("success");

    await act(async () => {
      await mounted.getState().performAction("SOL-PRO-001", "startReview");
    });
    expect(mounted.getState().getRequestFeedback("SOL-PRO-001").status).toBe("success");
    act(() => mounted.renderer.unmount());

    const emptyPort: ProfessionalReviewPort = {
      readProfessionalRequests: async () => [],
      performProfessionalRequestAction: adapter.performProfessionalRequestAction,
    };
    const emptyMounted = mountReview(emptyPort);
    await settle();
    expect(emptyMounted.getState().status).toBe("empty");
    act(() => emptyMounted.renderer.unmount());
  });

  test("muestra error de lectura y permite reintentar", async () => {
    let attempts = 0;
    const failure = new Error("Falla de lectura");
    const adapter = createMockProfessionalReviewAdapter();
    const port: ProfessionalReviewPort = {
      readProfessionalRequests: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(failure) : adapter.readProfessionalRequests();
      },
      performProfessionalRequestAction: adapter.performProfessionalRequestAction,
    };
    const mounted = mountReview(port);

    await act(async () => {
      await Promise.resolve();
    });
    expect(mounted.getState().status).toBe("error");
    expect(mounted.getState().error).toBe(failure);

    act(() => mounted.getState().reload());
    expect(mounted.getState().status).toBe("loading");
    await settle();
    expect(mounted.getState().status).toBe("success");
    act(() => mounted.renderer.unmount());
  });

  test("presenta acciones permitidas y confirma el cambio en la ruta del Profesional", async () => {
    const navigation = renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Profesional" }));
    await waitFor(() => expect(screen.getByText("Jueves, 24 de Octubre")).toBeOnTheScreen());
    await act(async () => {
      router.push("/profesional/estudiantes");
      await Promise.resolve();
    });

    expect(await screen.findByText("Solicitudes asignadas")).toBeOnTheScreen();
    expect(screen.queryByText("Acciones disponibles")).not.toBeOnTheScreen();

    expect(screen.getByRole("button", { name: "Poner en revisión" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Esperar información" })).toBeOnTheScreen();
    expect(
      screen.getByText("Esperando información o aceptación del estudiante."),
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Poner en revisión" }));
    expect(await screen.findByText("La solicitud quedó en revisión.")).toBeOnTheScreen();
    expect(screen.getAllByLabelText("Estado: En revisión")).toHaveLength(2);
    expect(navigation.getPathname()).toBe("/profesional/estudiantes");
  });

  test.each([
    ["accepted", "Solicitud aceptada; el acompañamiento puede continuar."],
    ["referred", "Solicitud derivada; queda pendiente del contacto y aceptación del estudiante."],
    ["closedWithoutAccompaniment", "Solicitud cerrada sin acompañamiento."],
    ["cancelled", "Solicitud cancelada."],
  ] as const)("describe correctamente el estado %s sin acciones", (status, message) => {
    expect(getNoActionMessage(status)).toBe(message);
  });
});
