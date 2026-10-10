import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import StudentHome from "../app/(protected)/estudiante";
import { LoginScreen } from "@/presentation/auth/login-screen";
import {
  createMockAuthenticationPort,
  mockAuthCredentials,
  unassignedPractitionerCredentials,
} from "@/infrastructure/mock-authentication";
import { NavigationSessionProvider, useNavigationSession } from "@/presentation/navigation/session";

import {
  studentLayoutScreenOptions,
  studentRequestScreenOptions,
} from "@/presentation/navigation/student-layout";

test("mantiene visible el header de las pantallas del estudiante", () => {
  expect(studentLayoutScreenOptions).toMatchObject({
    headerShown: true,
    headerTitle: "CERETIME",
    headerBackVisible: false,
  });
});

test("habilita el retorno nativo en nueva solicitud sin título duplicado", () => {
  expect(studentRequestScreenOptions).toMatchObject({
    headerShown: true,
    headerTitle: "CERETIME",
    headerBackTitle: "Volver",
    headerBackButtonDisplayMode: "minimal",
    headerBackVisible: true,
  });
});

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock("expo-font", () => ({ useFonts: () => [true, null] }));

function StudentSession() {
  const { session } = useNavigationSession();
  return session ? (
    <StudentHome />
  ) : (
    <LoginScreen unassignedPractitionerCredentials={unassignedPractitionerCredentials} />
  );
}

test("el inicio impide navegar durante el cierre de sesión y recupera las acciones tras un fallo", async () => {
  let rejectLogout!: (reason: Error) => void;
  const logoutResult = new Promise<void>((_resolve, reject) => {
    rejectLogout = reject;
  });
  const authPort = { ...createMockAuthenticationPort(), logout: () => logoutResult };
  render(
    <NavigationSessionProvider authPort={authPort} demoCredentials={mockAuthCredentials}>
      <StudentSession />
    </NavigationSessionProvider>,
  );
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Entrar como Estudiante" }));
  });
  for (const [label, destination] of [
    ["Nueva solicitud", "/estudiante/nueva-solicitud"],
    ["Mis solicitudes", "/estudiante/solicitudes"],
  ]) {
    fireEvent.press(screen.getByRole("button", { name: label }));
    expect(router.push).toHaveBeenLastCalledWith(destination);
  }
  jest.mocked(router.push).mockClear();
  fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
  expect(screen.getByRole("progressbar", { name: "Cerrando sesión" })).toBeOnTheScreen();
  for (const label of ["Nueva solicitud", "Mis solicitudes"]) {
    const action = screen.getByRole("button", { name: label });
    expect(action).toBeDisabled();
    fireEvent.press(action);
  }
  expect(router.push).not.toHaveBeenCalled();
  await act(async () => {
    rejectLogout(new Error("No fue posible cerrar sesión."));
  });
  expect(screen.getByText("Inicio de Estudiante")).toBeOnTheScreen();
  expect(screen.getByText("No fue posible cerrar sesión.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
  for (const label of ["Nueva solicitud", "Mis solicitudes"]) {
    expect(screen.getByRole("button", { name: label })).toBeEnabled();
  }
});
