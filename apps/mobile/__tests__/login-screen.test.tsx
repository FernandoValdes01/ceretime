import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

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

test("anuncia la carga una vez, enfoca el error y permite reintentar", async () => {
  const announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => undefined);
  const sendAccessibilityEvent = jest
    .spyOn(AccessibilityInfo, "sendAccessibilityEvent")
    .mockImplementation(() => undefined);
  let rejectInitial!: (error: Error) => void;
  const initial = new Promise<AuthSession>((_resolve, reject) => {
    rejectInitial = reject;
  });
  let resolveRetry!: (session: AuthSession) => void;
  const retry = new Promise<AuthSession>((resolve) => {
    resolveRetry = resolve;
  });
  const authPort: AuthPort = {
    login: jest
      .fn<Promise<AuthSession>, [AuthCredentials]>()
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(retry),
    logout: jest.fn(async () => undefined),
  };

  render(
    <NavigationSessionProvider authPort={authPort} demoCredentials={demoCredentials}>
      <LoginScreen
        unassignedPractitionerCredentials={{
          email: "practicante-sin-asignacion@demo.test",
          password: "demo",
        }}
      />
    </NavigationSessionProvider>,
  );

  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Entrar como Estudiante" }));
    await Promise.resolve();
  });

  expect(screen.getByRole("progressbar")).toBeOnTheScreen();
  expect(announce).toHaveBeenCalledTimes(1);
  expect(announce).toHaveBeenCalledWith("Preparando la experiencia…");

  await act(async () => {
    rejectInitial(new Error("No fue posible iniciar sesión."));
    await Promise.resolve();
  });

  expect(
    await screen.findByRole("alert", { name: "No fue posible iniciar sesión." }),
  ).toBeOnTheScreen();
  expect(announce).toHaveBeenCalledTimes(1);
  expect(sendAccessibilityEvent).toHaveBeenCalledTimes(1);
  expect(sendAccessibilityEvent).toHaveBeenCalledWith(expect.anything(), "focus");
  expect(screen.getByRole("button", { name: "Entrar como Estudiante" })).toBeEnabled();

  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Entrar como Estudiante" }));
    await Promise.resolve();
  });

  expect(announce).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("progressbar")).toBeOnTheScreen();
  expect(sendAccessibilityEvent).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveRetry(fakeSession);
    await retry;
  });

  expect(authPort.login).toHaveBeenCalledTimes(2);
  expect(sendAccessibilityEvent).toHaveBeenCalledTimes(1);
  announce.mockRestore();
  sendAccessibilityEvent.mockRestore();
});
