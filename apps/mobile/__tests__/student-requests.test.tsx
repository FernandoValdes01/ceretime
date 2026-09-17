import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { render } from "@testing-library/react-native";
import path from "node:path";

import type { StudentAreaSnapshot } from "@/application/student-area-models";
import type { StudentAreaReader } from "@/application/student-area-port";
import { createMockStudentAreaReader } from "@/infrastructure/mock-student-area-reader";
import { StudentAreaProvider } from "@/presentation/estudiante/student-area-provider";
import StudentRequestsScreen from "@/presentation/estudiante/student-requests-screen";
import { router } from "expo-router";

const appDirectory = path.resolve(__dirname, "../app");

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
    let resolveRead!: (snapshot: StudentAreaSnapshot) => void;
    const pending = new Promise<StudentAreaSnapshot>((resolve) => {
      resolveRead = resolve;
    });
    const reader: StudentAreaReader = { readStudentArea: () => pending };

    render(
      <StudentAreaProvider reader={reader}>
        <StudentRequestsScreen />
      </StudentAreaProvider>,
    );

    expect(screen.getByText("Cargando solicitudes…")).toBeOnTheScreen();
    await act(async () => resolveRead(await snapshotWith([])));
    expect(await screen.findByText("Aún no tienes solicitudes")).toBeOnTheScreen();
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
      name: "Solicitud enviada el 10 de agosto de 2026. Organizar apoyos para participar en actividades académicas.",
    });
    expect(screen.queryByText("Mis solicitudes")).not.toBeOnTheScreen();
    expect(
      screen.queryByText("Revisa las solicitudes de acompañamiento que has enviado a CERETI."),
    ).not.toBeOnTheScreen();
    expect(screen.queryByText("SOL-DEMO-001")).not.toBeOnTheScreen();
    expect(screen.getAllByText("Ver detalle")).toHaveLength(2);
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
    expect(screen.getByText("Medio preferido para recibir información")).toBeOnTheScreen();
    expect(screen.getByText("Correo institucional con texto accesible")).toBeOnTheScreen();
    expect(
      screen.getByText("Organizar apoyos para participar en actividades académicas."),
    ).toBeOnTheScreen();
    expect(screen.queryByText("Días disponibles")).not.toBeOnTheScreen();
    expect(screen.queryByText("Franja horaria")).not.toBeOnTheScreen();
    expect(navigation.getPathname()).toBe("/estudiante/solicitudes/SOL-DEMO-001");
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

  test.each([
    ["Profesional", "/profesional", "Inicio de Profesional"],
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
});
