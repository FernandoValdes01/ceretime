import path from "node:path";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { fillRequiredStudentRequestFields } from "./student-request-test-helpers";

const appDirectory = path.resolve(__dirname, "../app");

test("el modo fail-once muestra el error y confirma el reintento en la ruta real", async () => {
  process.env.EXPO_PUBLIC_STUDENT_REQUEST_DEMO_MODE = "fail-once";
  renderRouter(appDirectory, { initialUrl: "/login" });
  fireEvent.press(await screen.findByRole("button", { name: "Entrar como Estudiante" }));
  fireEvent.press(await screen.findByRole("button", { name: "Nueva solicitud" }));
  fillRequiredStudentRequestFields();

  fireEvent.press(screen.getByRole("button", { name: "Enviar solicitud" }));

  expect(await screen.findByText("No pudimos enviar la solicitud ficticia.")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole("button", { name: "Reintentar envío" }));
  expect(await screen.findByText("Solicitud enviada")).toBeOnTheScreen();
});
