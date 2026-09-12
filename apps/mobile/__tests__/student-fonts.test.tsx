import { fireEvent, render, screen } from "@testing-library/react-native";
import { useFonts } from "expo-font";
import { createMockStudentRequestSubmitter } from "@/infrastructure/mock-student-request-submitter";
import { RequestForm } from "@/presentation/estudiante/request-form";
import { StudentScreen } from "@/presentation/estudiante/student-screen";

jest.mock("expo-font", () => ({ useFonts: jest.fn() }));

const submitter = createMockStudentRequestSubmitter({ delayMs: 0 });

const form = (
  <StudentScreen title="Solicitud" description="Prueba de fuentes">
    <RequestForm submitter={submitter} onRevealGroup={() => {}} />
  </StudentScreen>
);

test("cargar la tipografía no borra los valores ingresados", () => {
  jest.mocked(useFonts).mockReturnValue([false, null]);
  const { rerender } = render(form);
  fireEvent.changeText(
    screen.getByLabelText("¿Qué necesidad quieres abordar? *"),
    "Leer materiales accesibles.",
  );
  jest.mocked(useFonts).mockReturnValue([true, null]);
  rerender(
    <StudentScreen title="Solicitud" description="Prueba de fuentes">
      <RequestForm submitter={submitter} onRevealGroup={() => {}} />
    </StudentScreen>,
  );
  expect(screen.getByDisplayValue("Leer materiales accesibles.")).toHaveStyle({
    fontFamily: "FiraSans_400Regular",
  });
});

test("un fallo de la fuente no bloquea la revisión del formulario", () => {
  jest.mocked(useFonts).mockReturnValue([false, new Error("Fuente no disponible")]);
  render(form);
  fireEvent.press(screen.getByRole("button", { name: "Enviar solicitud" }));
  expect(screen.getByText("Describe la necesidad que quieres abordar.")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Solicitud" })).toHaveStyle({
    fontFamily: undefined,
  });
});
