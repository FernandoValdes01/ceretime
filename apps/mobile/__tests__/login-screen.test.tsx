import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import type { AuthCredentials, AuthRole, AuthSession } from "../src/application/auth-models";
import type { AuthPort } from "../src/application/auth-port";
import { LoginScreen } from "../src/presentation/auth/login-screen";
import { NavigationSessionProvider } from "../src/presentation/navigation/session";

const demoCredentials = {
  estudiante: { email: "estudiante@demo.test", password: "demo" },
  profesional: { email: "profesional@demo.test", password: "demo" },
  practicante: { email: "practicante@demo.test", password: "demo" },
  administrador: { email: "administrador@demo.test", password: "demo" },
} as const satisfies Readonly<Record<AuthRole, AuthCredentials>>;

const fakeSession: AuthSession = {
  user: {
    id: "injected-user",
    displayName: "Usuario de prueba",
    email: "practicante-sin-asignacion@demo.test",
    role: "practicante",
    assignedAccompaniments: [],
  },
};

test("permite explorar el rol de practicante sin exponer credenciales", async () => {
  const unassignedCredentials: AuthCredentials = {
    email: "practicante-sin-asignacion@demo.test",
    password: "demo",
  };
  const authPort: AuthPort = {
    login: jest.fn(async () => fakeSession),
    logout: jest.fn(async () => undefined),
  };

  render(
    <NavigationSessionProvider authPort={authPort} demoCredentials={demoCredentials}>
      <LoginScreen unassignedPractitionerCredentials={unassignedCredentials} />
    </NavigationSessionProvider>,
  );
  expect(
    screen.getByRole("button", { name: "Entrar como Practicante sin asignación" }),
  ).toHaveStyle({
    minHeight: 52,
  });
  expect(screen.queryByLabelText("Correo electrónico")).not.toBeOnTheScreen();
  expect(screen.queryByLabelText("Contraseña")).not.toBeOnTheScreen();

  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Entrar como Practicante sin asignación" }));
    await Promise.resolve();
  });

  await waitFor(() => expect(authPort.login).toHaveBeenCalledWith(unassignedCredentials));
});
