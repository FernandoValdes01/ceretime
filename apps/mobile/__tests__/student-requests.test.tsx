import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { render } from "@testing-library/react-native";
import path from "node:path";
import { StrictMode } from "react";
import { AccessibilityInfo } from "react-native";

import type { StudentAreaSnapshot } from "@/application/student-area-models";
import type { StudentAreaReader } from "@/application/student-area-port";
import { createMockStudentAreaReader } from "@/infrastructure/mock-student-area-reader";
import {
  createMockStudentAreaStore,
  mockStudentAreaStore,
} from "@/infrastructure/mock-student-area-store";
import { StudentAreaProvider } from "@/presentation/estudiante/student-area-provider";
import StudentRequestsScreen from "@/presentation/estudiante/student-requests-screen";
import { fillRequiredStudentRequestFields } from "./student-request-test-helpers";

const appDirectory = path.resolve(__dirname, "../app");

afterEach(() => {
  jest.clearAllMocks();
  mockStudentAreaStore.reset();
  jest.restoreAllMocks();
});

function snapshotWith(requests: StudentAreaSnapshot["requests"]): Promise<StudentAreaSnapshot> {
  return createMockStudentAreaReader()
    .readStudentArea()
    .then((snapshot) => ({
      ...snapshot,
      requests,
      accompaniments: [],
    }));
}

describe("Solicitudes del estudiante", () => {
  test("muestra carga y luego las solicitudes del snapshot del estudiante", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    let resolveRead!: (snapshot: StudentAreaSnapshot) => void;
    const pending = new Promise<StudentAreaSnapshot>((resolve) => {
      resolveRead = resolve;
    });
    const reader: StudentAreaReader = { readStudentArea: () => pending };

    const view = render(
      <StrictMode>
        <StudentAreaProvider reader={reader}>
          <StudentRequestsScreen />
        </StudentAreaProvider>
      </StrictMode>,
    );

    expect(screen.getByText("Cargando solicitudes…")).toBeOnTheScreen();
    expect(announce.mock.calls).toEqual([["Cargando solicitudes."]]);
    await act(async () => resolveRead(await snapshotWith([])));
    expect(await screen.findByText("Aún no tienes solicitudes")).toBeOnTheScreen();
    view.rerender(
      <StrictMode>
        <StudentAreaProvider reader={reader}>
          <StudentRequestsScreen />
        </StudentAreaProvider>
      </StrictMode>,
    );
    expect(announce.mock.calls).toEqual([
      ["Cargando solicitudes."],
      ["Aún no tienes solicitudes."],
    ]);
  });

  test("muestra el estado vacío y permite iniciar una nueva solicitud", async () => {
    render(
      <StudentAreaProvider reader={createMockStudentAreaReader({ mode: "empty" })}>
        <StudentRequestsScreen />
      </StudentAreaProvider>,
    );

    expect(await screen.findByText("Aún no tienes solicitudes")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Crear nueva solicitud" })).toBeOnTheScreen();
  });

  test("muestra el error y permite reintentar la lectura", async () => {
    let attempts = 0;
    const reader: StudentAreaReader = {
      readStudentArea: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error("Falla de prueba")) : snapshotWith([]);
      },
    };

    render(
      <StudentAreaProvider reader={reader}>
        <StudentRequestsScreen />
      </StudentAreaProvider>,
    );

    expect(await screen.findByText("No pudimos cargar tus solicitudes")).toBeOnTheScreen();
    expect(
      screen.queryByText(
        "Ocurrió un problema al consultar tus solicitudes. Puedes intentarlo nuevamente.",
      ),
    ).not.toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Aún no tienes solicitudes")).toBeOnTheScreen();
    expect(attempts).toBe(2);
  });

  test("recorre Inicio → Mis solicitudes → Detalle", async () => {
    const navigation = renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
    fireEvent.press(await screen.findByRole("button", { name: "Mis solicitudes" }));

    const requestCard = await screen.findByRole("button", {
      name: "Solicitud enviada el 10 de agosto de 2026. Solicitud de acompañamiento",
    });
    expect(screen.queryByText("Mis solicitudes")).not.toBeOnTheScreen();
    expect(
      screen.queryByText("Revisa las solicitudes de acompañamiento que has enviado a CERETI."),
    ).not.toBeOnTheScreen();
    expect(screen.queryByText("SOL-DEMO-001")).not.toBeOnTheScreen();
    expect(screen.getAllByText("Ver detalle")).toHaveLength(5);
    fireEvent(requestCard, "focus");
    expect(requestCard).toHaveStyle({
      outlineColor: "#2563eb",
      outlineStyle: "solid",
      outlineWidth: 3,
    });
    fireEvent(requestCard, "blur");
    expect(requestCard).not.toHaveStyle({ outlineWidth: 3 });
    fireEvent.press(requestCard);

    expect(await screen.findByText("SOL-DEMO-001")).toBeOnTheScreen();
    expect(screen.getByText("Aceptada")).toBeOnTheScreen();
    expect(screen.getByLabelText("Estado de la solicitud: Aceptada")).toBeOnTheScreen();
    expect(screen.queryByText("Detalle de solicitud")).not.toBeOnTheScreen();
    expect(screen.getByText("Necesidades de acceso")).toBeOnTheScreen();
    expect(screen.getByText("Material digital accesible")).toBeOnTheScreen();
    expect(screen.queryByText("Medio preferido para recibir información")).not.toBeOnTheScreen();
    expect(screen.queryByText("Días disponibles")).not.toBeOnTheScreen();
    expect(screen.queryByText("Franja horaria")).not.toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/estudiante/solicitudes/SOL-DEMO-001");
  });

  test("incluye en listado y detalle una solicitud enviada durante la sesión", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const navigation = renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
    fireEvent.press(await screen.findByRole("button", { name: "Mis solicitudes" }));
    expect(
      await screen.findByRole("button", {
        name: "Solicitud enviada el 10 de agosto de 2026. Solicitud de acompañamiento",
      }),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: /^Inicio(?:, tab.*)?$/ }));
    fireEvent.press(await screen.findByRole("button", { name: "Nueva solicitud" }));
    fillRequiredStudentRequestFields();
    announce.mockClear();
    fireEvent.press(screen.getByRole("button", { name: "Enviar solicitud" }));

    expect(await screen.findByText(/SOL-DEMO-006/)).toBeOnTheScreen();
    expect(announce.mock.calls).toEqual([
      ["Enviando solicitud ficticia."],
      ["Solicitud ficticia enviada."],
    ]);
    fireEvent.press(screen.getByRole("button", { name: "Solicitudes, pestaña, 2 de 3" }));
    await waitFor(() => expect(navigation.getPathname()).toBe("/estudiante/solicitudes"));

    const createdRequest = await screen.findByRole("button", {
      name: /Me cuesta leer los materiales del curso\./,
    });
    fireEvent.press(createdRequest);

    expect(await screen.findByText(/SOL-DEMO-006/)).toBeOnTheScreen();
    expect(screen.getByText("Recibida")).toBeOnTheScreen();
    expect(screen.getByText("Me cuesta leer los materiales del curso.")).toBeOnTheScreen();
    expect(screen.getByText("Comunicación escrita")).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/estudiante/solicitudes/SOL-DEMO-006");
  });

  test("un detalle desconocido no expone datos fuera del snapshot", async () => {
    const navigation = renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
    await screen.findByText("Inicio de Estudiante");
    await act(async () => router.push("/estudiante/solicitudes/other-student-request"));
    await waitFor(() =>
      expect(navigation.getPathname()).toBe("/estudiante/solicitudes/other-student-request"),
    );

    expect(await screen.findByText("Solicitud no encontrada")).toBeOnTheScreen();
    expect(screen.getByText("No aparece en tu listado.")).toBeOnTheScreen();
    expect(
      screen.queryByText("Organizar apoyos para participar en actividades académicas."),
    ).not.toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Volver a mis solicitudes" }));
    expect(navigation.getPathname()).toBe("/estudiante/solicitudes");
  });

  test("abre el acompañamiento de una solicitud aceptada y vuelve al detalle", async () => {
    const navigation = renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
    fireEvent.press(await screen.findByRole("button", { name: "Mis solicitudes" }));
    fireEvent.press(
      await screen.findByRole("button", {
        name: "Solicitud enviada el 10 de agosto de 2026. Solicitud de acompañamiento",
      }),
    );

    expect(await screen.findByRole("button", { name: "Ver acompañamiento" })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Ver acompañamiento" }));

    expect(await screen.findByRole("header", { name: "Mi acompañamiento" })).toBeOnTheScreen();
    expect(screen.getByText("accompaniments:accompaniment-demo-1")).toBeOnTheScreen();
    expect(screen.getByText("SOL-DEMO-001")).toBeOnTheScreen();
    expect(screen.getByText("Activo")).toBeOnTheScreen();
    expect(screen.getByText("12 de agosto de 2026")).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/estudiante/solicitudes/SOL-DEMO-001/acompanamiento");

    fireEvent.press(screen.getByRole("button", { name: "Volver a la solicitud" }));
    expect(await screen.findByText("Necesidades de acceso")).toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/estudiante/solicitudes/SOL-DEMO-001");
  });

  test("vincula cada solicitud aceptada con su propio acompañamiento", async () => {
    const navigation = renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
    await screen.findByText("Inicio de Estudiante");
    await act(async () => router.push("/estudiante/solicitudes/SOL-DEMO-005"));

    fireEvent.press(await screen.findByRole("button", { name: "Ver acompañamiento" }));

    expect(await screen.findByText("accompaniments:accompaniment-demo-2")).toBeOnTheScreen();
    expect(screen.getByText("SOL-DEMO-005")).toBeOnTheScreen();
    expect(screen.getByText("Pausado")).toBeOnTheScreen();
    expect(screen.queryByText("accompaniments:accompaniment-demo-1")).not.toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/estudiante/solicitudes/SOL-DEMO-005/acompanamiento");
  });

  test("una solicitud sin aceptación no ofrece un acompañamiento", async () => {
    const navigation = renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
    await screen.findByText("Inicio de Estudiante");
    await act(async () => router.push("/estudiante/solicitudes/SOL-DEMO-002"));

    expect(await screen.findByText("SOL-DEMO-002")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Ver acompañamiento" })).not.toBeOnTheScreen();

    await act(async () => router.push("/estudiante/solicitudes/SOL-DEMO-002/acompanamiento"));
    expect(await screen.findByText("Acompañamiento no disponible")).toBeOnTheScreen();
    expect(screen.queryByText("accompaniments:accompaniment-demo-1")).not.toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/estudiante/solicitudes/SOL-DEMO-002/acompanamiento");
  });

  test("un vínculo directo desconocido no revela acompañamientos", async () => {
    const navigation = renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
    await screen.findByText("Inicio de Estudiante");
    await act(async () =>
      router.push("/estudiante/solicitudes/other-student-request/acompanamiento"),
    );

    expect(await screen.findByText("Acompañamiento no disponible")).toBeOnTheScreen();
    expect(screen.queryByText("accompaniments:accompaniment-demo-1")).not.toBeOnTheScreen();
    expect(navigation.getPathname()).toBe(
      "/estudiante/solicitudes/other-student-request/acompanamiento",
    );
  });

  test.each([
    ["Profesional", "/profesional", "Jueves, 24 de Octubre"],
    ["Practicante", "/practicante/asignaciones", "Acompañamientos asignados"],
    ["Administrador", "/administrador", "Inicio de Administrador"],
  ] as const)(
    "%s no puede acceder a las solicitudes del estudiante",
    async (role, expectedPath, expectedTitle) => {
      const navigation = renderRouter(appDirectory);
      fireEvent.press(await screen.findByRole("button", { name: `Entrar como ${role}` }));
      await screen.findByText(expectedTitle);
      await act(async () => router.push("/estudiante/solicitudes"));
      await waitFor(() => expect(navigation.getPathname()).toBe(expectedPath));
      expect(screen.queryByText("Mis solicitudes")).not.toBeOnTheScreen();
    },
  );
});

describe("Adaptador mock de solicitudes", () => {
  test.each([
    ["success", "SOL-DEMO-001"],
    ["empty", undefined],
  ] as const)("devuelve el escenario %s", async (mode, requestId) => {
    const snapshot = await createMockStudentAreaReader({ mode }).readStudentArea();
    expect(snapshot.requests[0]?.id).toBe(requestId);
  });

  test("devuelve un error controlado en modo error", async () => {
    await expect(createMockStudentAreaReader({ mode: "error" }).readStudentArea()).rejects.toThrow(
      "Falla simulada al cargar las solicitudes",
    );
  });

  test("muestra envíos de la sesión en el modo de ejemplos vacíos", async () => {
    const store = createMockStudentAreaStore();
    store.addRequest({
      id: "SOL-DEMO-006",
      status: "received",
      createdAt: "2026-09-28T12:00:00.000Z",
      accessNeeds: "Comunicación escrita",
    });

    const snapshot = await createMockStudentAreaReader({ mode: "empty", store }).readStudentArea();

    expect(snapshot.requests).toMatchObject([{ id: "SOL-DEMO-006", status: "received" }]);
    expect(snapshot.accompaniments).toEqual([]);
  });
});
