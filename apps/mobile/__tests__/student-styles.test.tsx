import { fireEvent, render, screen } from "@testing-library/react-native";
import { createMockStudentRequestSubmitter } from "@/infrastructure/mock-student-request-submitter";
import { Action } from "@/presentation/components/screen";
import { RequestForm } from "@/presentation/estudiante/request-form";
import { StudentScreen, StudentAction } from "@/presentation/estudiante/student-screen";

const submitter = createMockStudentRequestSubmitter({ delayMs: 0 });

test("la integración conserva los estilos de las acciones anteriores", () => {
  render(<Action label="Entrar como Estudiante" onPress={() => {}} />);
  expect(screen.getByRole("button", { name: "Entrar como Estudiante" })).toHaveStyle({
    minHeight: 52,
    paddingVertical: 14,
    backgroundColor: "#246259",
  });
});

jest.mock("expo-font", () => ({ useFonts: () => [true, null] }));

test("Tailwind conserva la tipografía y las medidas de los controles nativos", () => {
  render(
    <StudentScreen title="Solicitud" description="Prueba de estilos">
      <RequestForm submitter={submitter} onRevealGroup={() => {}} />
    </StudentScreen>,
  );
  expect(screen.getByRole("header", { name: "Solicitud" })).toHaveStyle({
    color: "#1b1c1c",
    fontSize: 28,
    lineHeight: 37,
  });
  expect(screen.getByLabelText("¿Qué necesidad quieres abordar? *")).toHaveStyle({
    minHeight: 112,
    padding: 16,
    borderWidth: 2,
    borderRadius: 8,
    borderCurve: "continuous",
    fontSize: 16,
    lineHeight: 26,
  });
  expect(screen.getByRole("button", { name: "Enviar solicitud" })).toHaveStyle({
    minHeight: 52,
    padding: 16,
    borderCurve: "continuous",
    backgroundColor: "#00695b",
  });
});

test("Tailwind distingue selección, foco y pulsación sin perder la selección", () => {
  render(<RequestForm submitter={submitter} onRevealGroup={() => {}} />);
  const choice = screen.getByRole("checkbox", { name: "Lunes" });
  fireEvent.press(choice);
  expect(choice).toBeChecked();
  expect(choice).toHaveStyle({
    borderColor: "#00695b",
    backgroundColor: "#f5f3f3",
    borderCurve: "continuous",
  });
  fireEvent(choice, "focus");
  expect(choice).toHaveStyle({ borderColor: "#2563eb" });
  fireEvent(choice, "pressIn");
  expect(choice).toHaveStyle({ opacity: 0.75 });
  fireEvent(choice, "pressOut");
  fireEvent(choice, "blur");
  expect(choice).toHaveStyle({ borderColor: "#00695b" });
  expect(choice).toBeChecked();
});

test("el foco del campo tiene prioridad sobre el borde de error", () => {
  render(<RequestForm submitter={submitter} onRevealGroup={() => {}} />);
  fireEvent.press(screen.getByRole("button", { name: "Enviar solicitud" }));
  const input = screen.getByLabelText("¿Qué necesidad quieres abordar? *");
  expect(input).toHaveStyle({ borderColor: "#ba1a1a" });
  fireEvent(input, "focus");
  expect(input).toHaveStyle({ borderColor: "#2563eb" });
  fireEvent(input, "blur");
  expect(input).toHaveStyle({ borderColor: "#ba1a1a" });
});

test("las variantes de acción conservan tamaños y colores distintos", () => {
  render(
    <>
      <StudentAction label="Nueva solicitud" description="Crear un borrador" onPress={() => {}} />
      <StudentAction label="Cambiar de rol" secondary onPress={() => {}} />
    </>,
  );
  expect(screen.getByRole("button", { name: "Nueva solicitud" })).toHaveStyle({
    minHeight: 96,
    borderRadius: 12,
    flexDirection: "row",
    rowGap: 16,
    columnGap: 16,
  });
  expect(screen.getByRole("button", { name: "Cambiar de rol" })).toHaveStyle({
    minHeight: 52,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderColor: "#bdc9c5",
  });
});
