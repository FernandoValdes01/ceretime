import { mobileDependencies } from "../src/composition/mobile-dependencies";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { render } from "@testing-library/react-native";
import path from "node:path";
import { StrictMode } from "react";
import { AccessibilityInfo } from "react-native";

import type { StudentAreaSnapshot } from "@/domain/student-area-models";
import { StudentOperationError, type StudentAreaReader } from "@/application/student-area-port";
import { createDemoStudentAreaReader } from "@/infrastructure/demo-student-area-reader";
import { createDemoStudentAreaStore } from "@/infrastructure/demo-student-area-store";
import { StudentAreaProvider } from "@/presentation/estudiante/student-area-provider";
import StudentRequestsScreen from "@/presentation/estudiante/student-requests-screen";
import StudentRequestDetailScreen from "@/presentation/estudiante/student-request-detail-screen";
import StudentAccompanimentScreen from "@/presentation/estudiante/student-accompaniment-screen";
import { fillRequiredStudentRequestFields } from "./student-request-test-helpers";

const appDirectory = path.resolve(__dirname, "../app");

afterEach(() => {
  jest.clearAllMocks();
  mobileDependencies.resetDemo();
  jest.restoreAllMocks();
});

function snapshotWith(requests: StudentAreaSnapshot["requests"]): Promise<StudentAreaSnapshot> {
  return createDemoStudentAreaReader()
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
      <StudentAreaProvider reader={createDemoStudentAreaReader({ mode: "empty" })}>
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

  test.each([
    ["error tipado", new StudentOperationError("listOwnRequests", "unauthorized", "No autorizado")],
    ["código público", { data: { code: "unauthorized" } }],
    ["respuesta anterior", { data: "No autorizado" }],
  ])("distingue acceso denegado de un fallo recuperable: %s", async (_case, error) => {
    const reader: StudentAreaReader = { readStudentArea: () => Promise.reject(error) };
    render(
      <StudentAreaProvider reader={reader}>
        <StudentRequestsScreen />
      </StudentAreaProvider>,
    );

    expect(await screen.findByText("No tienes acceso a estas solicitudes")).toBeOnTheScreen();
    expect(screen.queryByText("No pudimos cargar tus solicitudes")).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeOnTheScreen();
    expect(screen.queryByText("SOL-DEMO-001")).not.toBeOnTheScreen();
  });

  test("oculta las solicitudes anteriores al denegar una actualización", async () => {
    let refresh = () => {};
    let denied = false;
    const reader: StudentAreaReader = {
      readStudentArea: () =>
        denied
          ? Promise.reject({ data: { code: "unauthorized" } })
          : createDemoStudentAreaReader().readStudentArea(),
      subscribe: (onChange) => {
        refresh = onChange;
        return () => {};
      },
    };
    render(
      <StudentAreaProvider reader={reader}>
        <StudentRequestsScreen />
      </StudentAreaProvider>,
    );

    expect((await screen.findAllByText("Estado: Aceptada")).length).toBeGreaterThan(0);
    denied = true;
    await act(async () => refresh());
    expect(await screen.findByText("No tienes acceso a estas solicitudes")).toBeOnTheScreen();
    expect(screen.queryByText("Estado: Aceptada")).not.toBeOnTheScreen();
  });

  test.each([
    [StudentRequestDetailScreen, "No tienes acceso a esta solicitud"],
    [StudentAccompanimentScreen, "No tienes acceso a este acompañamiento"],
  ])("la pantalla de detalle distingue la denegación", async (Component, message) => {
    const reader: StudentAreaReader = {
      readStudentArea: () =>
        Promise.reject(new StudentOperationError("getRequest", "unauthorized", "No autorizado")),
    };
    render(
      <StudentAreaProvider reader={reader}>
        <Component />
      </StudentAreaProvider>,
    );

    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Volver a mis solicitudes" })).toBeOnTheScreen();
    expect(screen.queryByText(/no encontrad|no disponible/i)).not.toBeOnTheScreen();
  });

  test("recorre Inicio → Mis solicitudes → Detalle", async () => {
    const navigation = renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
    fireEvent.press(await screen.findByRole("button", { name: "Mis solicitudes" }));

    const requestCard = await screen.findByRole("button", {
      name: "Solicitud enviada el 10 de agosto de 2026. Solicitud de acompañamiento. Estado: Aceptada",
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

  test("al volver a una pantalla muestra lo que cambió el profesional sin reiniciar la app", async () => {
    const base = await createDemoStudentAreaReader().readStudentArea();
    const received = { ...base.requests[0]!, status: "received" as const };
    const withRequest = (request: StudentAreaSnapshot["requests"][number]) => ({
      ...base,
      requests: [request],
      accompaniments: [],
    });
    let current: StudentAreaSnapshot = withRequest(received);
    const read = jest
      .spyOn(mobileDependencies.studentAreaReader, "readStudentArea")
      .mockImplementation(async () => current);

    renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
    fireEvent.press(await screen.findByRole("button", { name: "Mis solicitudes" }));
    const card = await screen.findByRole("button", { name: /Estado: Recibida/ });
    // El primer foco coincide con la carga inicial y no la repite.
    expect(read).toHaveBeenCalledTimes(1);

    // El profesional pide información mientras la lista ya está cargada: abrir el detalle la trae.
    current = withRequest({
      ...received,
      status: "awaitingInformationOrAcceptance",
      informationRequest: "¿Qué horario te acomoda?",
    });
    fireEvent.press(card);
    expect(await screen.findByText("¿Qué horario te acomoda?")).toBeOnTheScreen();

    // Vuelve a cambiar mientras está en otra pestaña: al regresar se ve el estado vigente.
    fireEvent.press(screen.getByLabelText("Inicio, pestaña, 1 de 3"));
    await screen.findByRole("button", { name: "Mis solicitudes" });
    current = withRequest({ ...received, status: "underReview" });
    fireEvent.press(screen.getByLabelText("Solicitudes, pestaña, 2 de 3"));
    expect(await screen.findByLabelText("Estado de la solicitud: En revisión")).toBeOnTheScreen();
  });

  test("incluye en listado y detalle una solicitud enviada durante la sesión", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const navigation = renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
    fireEvent.press(await screen.findByRole("button", { name: "Mis solicitudes" }));
    expect(
      await screen.findByRole("button", {
        name: "Solicitud enviada el 10 de agosto de 2026. Solicitud de acompañamiento. Estado: Aceptada",
      }),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText("Inicio, pestaña, 1 de 3"));
    fireEvent.press(await screen.findByRole("button", { name: "Nueva solicitud" }));
    fillRequiredStudentRequestFields();
    announce.mockClear();
    fireEvent.press(screen.getByRole("button", { name: "Confirmar y enviar solicitud" }));

    expect(await screen.findByText(/SOL-DEMO-006/)).toBeOnTheScreen();
    expect(announce.mock.calls).toEqual([
      ["Enviando solicitud ficticia."],
      ["Solicitud ficticia enviada."],
    ]);
    fireEvent.press(screen.getByLabelText("Solicitudes, pestaña, 2 de 3"));
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
    // La lista recupera el foco y vuelve a leer: la prueba espera a que termine.
    await act(async () => undefined);
  });

  test("abre el acompañamiento de una solicitud aceptada y vuelve al detalle", async () => {
    const navigation = renderRouter(appDirectory);
    fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
    fireEvent.press(await screen.findByRole("button", { name: "Mis solicitudes" }));
    fireEvent.press(
      await screen.findByRole("button", {
        name: "Solicitud enviada el 10 de agosto de 2026. Solicitud de acompañamiento. Estado: Aceptada",
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
    ["Profesional", "/profesional", "Jueves, 5 de noviembre"],
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
    const snapshot = await createDemoStudentAreaReader({ mode }).readStudentArea();
    expect(snapshot.requests[0]?.id).toBe(requestId);
  });

  test("devuelve un error controlado en modo error", async () => {
    await expect(createDemoStudentAreaReader({ mode: "error" }).readStudentArea()).rejects.toThrow(
      "Falla simulada al cargar las solicitudes",
    );
  });

  test("muestra envíos de la sesión en el modo de ejemplos vacíos", async () => {
    const store = createDemoStudentAreaStore();
    store.addRequest({
      id: "SOL-DEMO-006",
      status: "received",
      createdAt: "2026-09-28T12:00:00.000Z",
      accessNeeds: "Comunicación escrita",
    });

    const snapshot = await createDemoStudentAreaReader({ mode: "empty", store }).readStudentArea();

    expect(snapshot.requests).toMatchObject([{ id: "SOL-DEMO-006", status: "received" }]);
    expect(snapshot.accompaniments).toEqual([]);
  });
});
