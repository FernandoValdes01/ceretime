import path from "node:path";
import { mobileDependencies } from "@/composition/mobile-dependencies";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { fillRequiredStudentRequestFields } from "./student-request-test-helpers";

const originalDemoMode = process.env.EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE;
afterEach(() => {
  if (originalDemoMode === undefined) delete process.env.EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE;
  else process.env.EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE = originalDemoMode;
  mobileDependencies.resetDemo();
});

const appDirectory = path.resolve(__dirname, "../app");

test("el modo fail-once muestra el error y confirma el reintento en la ruta real", async () => {
  process.env.EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE = "fail-once";
  mobileDependencies.resetDemo();
  renderRouter(appDirectory, { initialUrl: "/login" });
  fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
  fireEvent.press(await screen.findByRole("button", { name: "Nueva solicitud" }));
  fillRequiredStudentRequestFields();

  fireEvent.press(screen.getByRole("button", { name: "Confirmar y enviar solicitud" }));

  expect(await screen.findByText("No pudimos enviar la solicitud ficticia.")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Reintentar envío" }));
  expect(await screen.findByText("Solicitud enviada")).toBeOnTheScreen();
});

test("responde y cancela una solicitud de ejemplo desde su detalle y actualiza el listado", async () => {
  process.env.EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE = "success";
  mobileDependencies.resetDemo();
  renderRouter(appDirectory, { initialUrl: "/login" });
  fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
  fireEvent.press(await screen.findByRole("button", { name: "Mis solicitudes" }));
  fireEvent.press(
    await screen.findByRole("button", { name: /Estado: Esperando información o aceptación/ }),
  );
  expect(
    await screen.findByText("Indica en qué formato prefieres recibir el material del curso."),
  ).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Responder información" }));
  fireEvent.changeText(
    screen.getByLabelText("Respuesta a la información solicitada"),
    "Texto accesible para lector de pantalla.",
  );
  fireEvent.press(screen.getByRole("button", { name: "Enviar respuesta de prueba" }));
  expect(
    await screen.findByText(
      "Respuesta enviada en la demostración. La solicitud vuelve a revisión.",
    ),
  ).toBeOnTheScreen();
  expect(await screen.findByText("Texto accesible para lector de pantalla.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Responder información" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Cancelar solicitud" }));
  fireEvent.changeText(
    screen.getByLabelText("Motivo de cancelación"),
    "El apoyo ya fue coordinado.",
  );
  fireEvent.press(screen.getByRole("button", { name: "Confirmar cancelación de prueba" }));
  expect(await screen.findByText("Solicitud cancelada en la demostración.")).toBeOnTheScreen();
  expect(await screen.findByText("Cancelada")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Cancelar solicitud" })).toBeNull();
});
