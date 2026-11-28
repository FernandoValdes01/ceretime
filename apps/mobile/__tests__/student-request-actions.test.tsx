import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import {
  StudentRequestActionError,
  type StudentRequestActions,
} from "@/application/student-area-port";
import type { StudentRequest } from "@/domain/student-area-models";
import { createDemoStudentAreaStore } from "@/infrastructure/demo-student-area-store";
import { createDemoStudentAreaReader } from "@/infrastructure/demo-student-area-reader";
import { createDemoStudentRequestActions } from "@/infrastructure/demo-student-request-actions";
import { StudentRequestActionsPanel } from "@/presentation/estudiante/student-request-actions";

const request: StudentRequest = {
  id: "SOL-DEMO-004",
  status: "awaitingInformationOrAcceptance",
  accessNeeds: "Información anticipada",
  createdAt: "2026-09-08T09:50:00.000Z",
};

function open(actions: StudentRequestActions, source = request) {
  return render(
    <StudentRequestActionsPanel request={source} actions={actions} onReload={jest.fn()} />,
  );
}

test("responde con datos ficticios y el lector devuelve una sola solicitud en revisión", async () => {
  const store = createDemoStudentAreaStore();
  const actions = createDemoStudentRequestActions({ store, delayMs: 0 });
  open(actions);
  fireEvent.press(screen.getByRole("button", { name: "Responder información" }));
  fireEvent.press(screen.getByRole("button", { name: "Enviar respuesta de prueba" }));
  expect(screen.getByText("Escribe tu respuesta.")).toBeOnTheScreen();
  fireEvent.changeText(
    screen.getByLabelText(/^Respuesta a la información solicitada/),
    "Material en texto accesible.",
  );
  fireEvent.press(screen.getByRole("button", { name: "Enviar respuesta de prueba" }));
  expect(
    await screen.findByText(
      "Respuesta enviada en la demostración. La solicitud vuelve a revisión.",
    ),
  ).toBeOnTheScreen();
  const snapshot = await createDemoStudentAreaReader({ store }).readStudentArea();
  expect(snapshot.requests.filter((item) => item.id === request.id)).toEqual([
    expect.objectContaining({
      status: "underReview",
      informationResponse: "Material en texto accesible.",
    }),
  ]);
  expect(snapshot.accompaniments).toHaveLength(2);
});

test("cancelar exige motivo y confirmación; volver conserva el texto sin escribir", async () => {
  const store = createDemoStudentAreaStore();
  const adapter = createDemoStudentRequestActions({ store, delayMs: 0 });
  const execute = jest.fn(adapter.execute);
  open({ execute });
  fireEvent.press(screen.getByRole("button", { name: "Cancelar solicitud" }));
  fireEvent.press(screen.getByRole("button", { name: "Confirmar cancelación de prueba" }));
  expect(screen.getByText("Indica el motivo de cancelación.")).toBeOnTheScreen();
  fireEvent.changeText(screen.getByLabelText(/^Motivo de cancelación/), "Ya no necesito el apoyo.");
  fireEvent.press(screen.getByRole("button", { name: "Volver sin confirmar" }));
  expect(execute).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: "Cancelar solicitud" }));
  expect(screen.getByDisplayValue("Ya no necesito el apoyo.")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Confirmar cancelación de prueba" }));
  expect(await screen.findByText("Solicitud cancelada en la demostración.")).toBeOnTheScreen();
  expect(store.readRequests()[0]).toMatchObject({
    status: "cancelled",
    closureReason: "Ya no necesito el apoyo.",
  });
});

test("conserva la respuesta al fallar y bloquea los envíos simultáneos", async () => {
  let resolve!: (value: StudentRequest) => void;
  const pending = new Promise<StudentRequest>((done) => {
    resolve = done;
  });
  const execute = jest
    .fn()
    .mockRejectedValueOnce(new Error("detalle privado"))
    .mockReturnValueOnce(pending);
  open({ execute });
  fireEvent.press(screen.getByRole("button", { name: "Responder información" }));
  fireEvent.changeText(
    screen.getByLabelText("Respuesta a la información solicitada"),
    "Texto accesible.",
  );
  fireEvent.press(screen.getByRole("button", { name: "Enviar respuesta de prueba" }));
  expect(
    await screen.findByText("No pudimos completar la acción. Conservamos lo que escribiste."),
  ).toBeOnTheScreen();
  expect(screen.queryByText("detalle privado")).toBeNull();
  expect(screen.getByDisplayValue("Texto accesible.")).toBeOnTheScreen();
  const retry = screen.getByRole("button", { name: "Reintentar acción" });
  act(() => {
    fireEvent.press(retry);
    fireEvent.press(retry);
  });
  expect(execute).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "Procesando acción…" })).toBeDisabled();
  expect(screen.getByLabelText("Respuesta a la información solicitada")).toHaveProp(
    "editable",
    false,
  );
  await act(async () => resolve({ ...request, status: "underReview" }));
  expect(await screen.findByText(/Respuesta enviada en la demostración/)).toBeOnTheScreen();
});

test.each(["unauthorized", "conflict"] as const)(
  "distingue %s sin éxito ni reintento automático",
  async (code) => {
    const execute = jest
      .fn()
      .mockRejectedValue(
        new StudentRequestActionError(
          code,
          "La solicitud cambió y ya no admite esta acción. Actualiza el detalle.",
        ),
      );
    open({ execute });
    fireEvent.press(screen.getByRole("button", { name: "Cancelar solicitud" }));
    fireEvent.changeText(screen.getByLabelText("Motivo de cancelación"), "Necesidad resuelta.");
    fireEvent.press(screen.getByRole("button", { name: "Confirmar cancelación de prueba" }));
    await screen.findByRole("button", { name: "Actualizar detalle" });
    expect(screen.getByDisplayValue("Necesidad resuelta.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Reintentar acción" })).toBeNull();
    expect(screen.queryByText("Solicitud cancelada en la demostración.")).toBeNull();
    expect(
      screen.getByText(
        code === "unauthorized"
          ? "No tienes permiso para realizar esta acción."
          : "La solicitud cambió y ya no admite esta acción. Actualiza el detalle.",
      ),
    ).toBeOnTheScreen();
  },
);

test("rechaza respuestas largas, estados finales y solicitudes inexistentes sin escribir", async () => {
  const store = createDemoStudentAreaStore();
  const actions = createDemoStudentRequestActions({ store, delayMs: 0 });
  open(actions);
  fireEvent.press(screen.getByRole("button", { name: "Responder información" }));
  fireEvent.changeText(
    screen.getByLabelText("Respuesta a la información solicitada"),
    "a".repeat(2001),
  );
  fireEvent.press(screen.getByRole("button", { name: "Enviar respuesta de prueba" }));
  expect(screen.getByText("Usa como máximo 2000 caracteres.")).toBeOnTheScreen();
  await expect(
    actions.execute({
      kind: "respondToInformationRequest",
      requestId: request.id,
      response: "a".repeat(2001),
    }),
  ).rejects.toMatchObject({ code: "invalid" });
  await expect(
    actions.execute({
      kind: "cancelRequest",
      requestId: "SOL-DEMO-001",
      reason: "No corresponde.",
    }),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    actions.execute({ kind: "cancelRequest", requestId: "ajena", reason: "No corresponde." }),
  ).rejects.toMatchObject({ code: "unauthorized" });
  expect(store.readRequests()).toEqual([]);
});

test.each(["accepted", "cancelled", "closedWithoutAccompaniment", "referred"] as const)(
  "no ofrece acciones sobre una solicitud %s",
  (status) => {
    open({ execute: jest.fn() }, { ...request, status });
    expect(screen.queryByRole("button", { name: "Responder información" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar solicitud" })).toBeNull();
  },
);

test("descarta un resultado de un adaptador anterior", async () => {
  let resolve!: (value: StudentRequest) => void;
  const execute = jest.fn(
    () =>
      new Promise<StudentRequest>((done) => {
        resolve = done;
      }),
  );
  const view = open({ execute });
  fireEvent.press(screen.getByRole("button", { name: "Cancelar solicitud" }));
  fireEvent.changeText(screen.getByLabelText("Motivo de cancelación"), "Necesidad resuelta.");
  fireEvent.press(screen.getByRole("button", { name: "Confirmar cancelación de prueba" }));
  view.rerender(
    <StudentRequestActionsPanel
      request={request}
      actions={{ execute: jest.fn() }}
      onReload={jest.fn()}
    />,
  );
  await act(async () => resolve({ ...request, status: "cancelled" }));
  await waitFor(() =>
    expect(screen.queryByText("Solicitud cancelada en la demostración.")).toBeNull(),
  );
});

test("permite operar con el nuevo adaptador sin que el anterior libere su bloqueo", async () => {
  let resolveA!: (value: StudentRequest) => void;
  let resolveB!: (value: StudentRequest) => void;
  const executeA = jest.fn(
    () =>
      new Promise<StudentRequest>((done) => {
        resolveA = done;
      }),
  );
  const executeB = jest.fn(
    () =>
      new Promise<StudentRequest>((done) => {
        resolveB = done;
      }),
  );
  const view = open({ execute: executeA });
  fireEvent.press(screen.getByRole("button", { name: "Cancelar solicitud" }));
  fireEvent.changeText(screen.getByLabelText("Motivo de cancelación"), "Motivo anterior.");
  fireEvent.press(screen.getByRole("button", { name: "Confirmar cancelación de prueba" }));
  view.rerender(
    <StudentRequestActionsPanel
      request={request}
      actions={{ execute: executeB }}
      onReload={jest.fn()}
    />,
  );
  fireEvent.press(screen.getByRole("button", { name: "Responder información" }));
  fireEvent.changeText(
    screen.getByLabelText("Respuesta a la información solicitada"),
    "Respuesta nueva.",
  );
  const submitB = screen.getByRole("button", { name: "Enviar respuesta de prueba" });
  fireEvent.press(submitB);
  expect(executeB).toHaveBeenCalledTimes(1);
  await act(async () => resolveA({ ...request, status: "cancelled" }));
  expect(screen.queryByText("Solicitud cancelada en la demostración.")).toBeNull();
  expect(screen.getByRole("button", { name: "Procesando acción…" })).toBeDisabled();
  fireEvent.press(submitB);
  expect(executeB).toHaveBeenCalledTimes(1);
  await act(async () => resolveB({ ...request, status: "underReview" }));
  expect(screen.getByText(/Respuesta enviada en la demostración/)).toBeOnTheScreen();
});

test("con acciones reales no se presentan como prueba ni como demostración", async () => {
  const execute = jest.fn(async (): Promise<StudentRequest> => ({
    ...request,
    status: "cancelled",
  }));
  open({ execute, persistsToServer: true });
  expect(screen.queryByText(/Acciones de prueba/)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Cancelar solicitud" }));
  fireEvent.changeText(screen.getByLabelText(/^Motivo de cancelación/), "Ya no necesito el apoyo.");
  fireEvent.press(screen.getByRole("button", { name: "Confirmar cancelación" }));
  expect(await screen.findByText("Solicitud cancelada.")).toBeOnTheScreen();
  expect(screen.queryByText(/demostración/)).toBeNull();
});
