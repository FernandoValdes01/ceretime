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
import { formatAvailability } from "../src/presentation/profesional/professional-request-detail-screen";
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
  it("expone respuestas reducidas del contrato y permite tomar una solicitud recibida", async () => {
    const adapter = createMockProfessionalReviewAdapter();

    const requests = await adapter.readProfessionalRequests();
    expect(requests).toHaveLength(7);
    expect(requests.map(({ status }) => status)).toEqual([
      "received",
      "received",
      "underReview",
      "awaitingInformationOrAcceptance",
      "underReview",
      "accepted",
      "awaitingInformationOrAcceptance",
    ]);
    expect(requests[0]?.availableActions).toEqual(["startReview"]);
    expect(requests[1]?.availableActions).toEqual(["startReview"]);
    expect(requests[2]?.availableActions).toEqual(["requestInformation", "accept"]);
    expect(requests[3]?.availableActions).toEqual(["accept"]);
    expect(requests[0]?.studentName).toBeUndefined();
    expect(requests[0]?.needSummary).toBeUndefined();

    const reviewReceipt = await adapter.performProfessionalRequestAction(
      "SOL-PRO-001",
      "startReview",
    );
    expect(reviewReceipt.request.status).toBe("underReview");
    expect(reviewReceipt.request.availableActions).toEqual(["requestInformation", "accept"]);
    expect(reviewReceipt.message).toBe("La solicitud quedó en revisión.");

    await expect(
      adapter.performProfessionalRequestAction("SOL-PRO-002", "requestInformation"),
    ).rejects.toThrow("Indica el motivo para pedir información");
    const informationReceipt = await adapter.performProfessionalRequestAction(
      "SOL-PRO-002",
      "requestInformation",
      { reason: "Falta un dato de acceso" },
    );
    expect(informationReceipt.request.status).toBe("awaitingInformationOrAcceptance");
    const acceptanceReceipt = await adapter.performProfessionalRequestAction(
      "SOL-PRO-003",
      "accept",
      { objective: "Acordar apoyos accesibles" },
    );
    expect(acceptanceReceipt.request.status).toBe("accepted");
    expect(acceptanceReceipt.request.accompaniment).toMatchObject({
      id: "ACO-SOL-PRO-003",
      objective: "Acordar apoyos accesibles",
      status: "active",
    });
  });

  it("rechaza una acción que no corresponde al estado actual", async () => {
    const adapter = createMockProfessionalReviewAdapter();

    await expect(
      adapter.performProfessionalRequestAction("SOL-PRO-003", "startReview"),
    ).rejects.toThrow("Esta acción todavía no está disponible en el contrato Mobile");
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
  test("presenta los días y el rango horario de disponibilidad", () => {
    expect(
      formatAvailability({
        preferredWeekdays: [2, 4],
        preferredTimeRange: { from: "10:00", to: "13:00" },
      }),
    ).toBe("Martes, Jueves · 10:00 a 13:00");
  });

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
    expect(mounted.getState().error).toEqual(
      new Error("No pudimos cargar las solicitudes del Profesional. Intenta nuevamente."),
    );

    act(() => mounted.getState().reload());
    expect(mounted.getState().status).toBe("loading");
    await settle();
    expect(mounted.getState().status).toBe("success");
    act(() => mounted.renderer.unmount());
  });

  test("abre el detalle de una solicitud recibida y registra que comienza la revisión", async () => {
    const navigation = renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Profesional" }));
    await waitFor(() => expect(screen.getByText("Jueves, 24 de Octubre")).toBeOnTheScreen());
    await act(async () => {
      router.push("/profesional/estudiantes");
      await Promise.resolve();
    });

    expect(await screen.findByRole("header", { name: "Solicitudes" })).toBeOnTheScreen();
    expect(screen.queryByText("Solicitudes asignadas")).not.toBeOnTheScreen();
    expect(
      screen.queryByText("Revisa las solicitudes asignadas y registra el siguiente paso."),
    ).not.toBeOnTheScreen();
    expect(screen.queryByText("Acciones disponibles")).not.toBeOnTheScreen();

    const requestCard = screen.getByRole("button", {
      name: "Solicitud SOL-PRO-001 de Estudiante. Estado: Recibida.",
    });
    expect(screen.queryByText("Ver detalle")).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Poner en revisión" })).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Aceptar solicitud" })).not.toBeOnTheScreen();

    fireEvent.press(requestCard);
    expect(await screen.findByRole("header", { name: "Detalle de solicitud" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Poner en revisión" })).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/profesional/estudiantes/SOL-PRO-001");

    fireEvent.press(screen.getByRole("button", { name: "Poner en revisión" }));
    expect(await screen.findByText("En revisión")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Esperar información" })).toBeDisabled();
    expect(screen.getByText("Motivo para pedir información")).toHaveStyle({ fontSize: 16 });
    expect(screen.getByLabelText("Motivo para pedir información")).toHaveStyle({
      borderColor: "#5A5A5A",
      borderWidth: 1,
      fontSize: 16,
    });
    fireEvent.changeText(
      screen.getByLabelText("Motivo para pedir información"),
      "Necesitamos un dato de acceso",
    );
    expect(screen.getByText("Motivo para pedir información")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Esperar información" }));
    expect(await screen.findByText("Esperando información o aceptación")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Aceptar solicitud" })).toBeDisabled();
    expect(screen.getByText("Objetivo del acompañamiento")).toBeOnTheScreen();
    fireEvent.changeText(
      screen.getByLabelText("Objetivo del acompañamiento"),
      "Acordar apoyos accesibles",
    );
    expect(screen.getByText("Objetivo del acompañamiento")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Aceptar solicitud" }));
    expect(await screen.findByText("Acompañamiento abierto")).toBeOnTheScreen();
    expect(screen.getByText("ACO-SOL-PRO-001")).toBeOnTheScreen();
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
