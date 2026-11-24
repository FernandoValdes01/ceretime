import { render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import type { InstitutionalAuthPort } from "../src/application/auth-port";
import { demoAuthCredentials } from "../src/infrastructure/demo-auth-adapter";
import { RootNavigator } from "../src/presentation/navigation/root-navigator";
import { NavigationSessionProvider } from "../src/presentation/navigation/session";

jest.mock("expo-router", () => {
  const { Text } = jest.requireActual("react-native");
  const Stack = () => <Text>Navegación lista</Text>;
  Stack.Screen = () => null;
  Stack.Protected = () => null;
  return { Stack };
});

function renderNavigator(restoreSession: InstitutionalAuthPort["restoreSession"]) {
  const port: InstitutionalAuthPort = {
    restoreSession,
    signInInstitutional: jest.fn(async () => null),
    logout: jest.fn(async () => undefined),
  };
  return render(
    <NavigationSessionProvider authPort={port} demoCredentials={demoAuthCredentials}>
      <RootNavigator />
    </NavigationSessionProvider>,
  );
}

test("mientras se recupera la sesión anuncia la carga una sola vez y luego muestra la navegación", async () => {
  const announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => undefined);
  let finishRestoring!: () => void;
  const restoring = new Promise<null>((resolve) => {
    finishRestoring = () => resolve(null);
  });

  renderNavigator(() => restoring);

  expect(screen.getByText("Cargando CERETI…")).toBeTruthy();
  expect(screen.getByText("Recuperando tu sesión.")).toBeTruthy();
  expect(announce).toHaveBeenCalledTimes(1);
  expect(announce).toHaveBeenCalledWith("Cargando CERETI… Recuperando tu sesión.");

  finishRestoring();

  await waitFor(() => expect(screen.getByText("Navegación lista")).toBeTruthy());
  expect(screen.queryByText("Cargando CERETI…")).toBeNull();
  expect(announce).toHaveBeenCalledTimes(1);
});
