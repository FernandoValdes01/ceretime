import path from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import type { AuthSession } from "../src/application/auth-models";
import type { AuthPort } from "../src/application/auth-port";
import {
  createMockAuthenticationPort,
  mockAuthCredentials,
} from "../src/infrastructure/mock-authentication";
import { RoleHome } from "../src/presentation/components/role-home";
import { LoginScreen as Login } from "../src/presentation/auth/login-screen";
import {
  NavigationSessionProvider,
  useNavigationSession,
} from "../src/presentation/navigation/session";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const fakeSession: AuthSession = {
  user: {
    id: "fake-user",
    displayName: "Usuario ficticio",
    email: "usuario@cereti.test",
    role: "estudiante",
    assignedAccompaniments: [],
  },
};

function SessionContent() {
  const { session } = useNavigationSession();
  return session ? <RoleHome title="Inicio ficticio" description="Sesión activa." /> : <Login />;
}

describe("autenticación mobile simulada", () => {
  test("expone loading mientras el adapter valida las credenciales", async () => {
    const result = deferred<AuthSession>();
    const authPort: AuthPort = {
      login: jest.fn(() => result.promise),
      logout: jest.fn(async () => undefined),
    };

    render(
      <NavigationSessionProvider authPort={authPort}>
        <Login />
      </NavigationSessionProvider>,
    );
    fireEvent.changeText(screen.getByLabelText("Correo electrónico"), "usuario@cereti.test");
    fireEvent.changeText(screen.getByLabelText("Contraseña"), "clave-ficticia");
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Iniciar sesión" }));
      await Promise.resolve();
    });
    expect(screen.getByText("Validando acceso…")).toBeOnTheScreen();
    fireEvent.changeText(screen.getByLabelText("Correo electrónico"), "otro@cereti.test");
    fireEvent.changeText(screen.getByLabelText("Contraseña"), "otra-clave");
    fireEvent(screen.getByLabelText("Contraseña"), "submitEditing");
    expect(authPort.login).toHaveBeenCalledTimes(1);
    await act(async () => {
      result.resolve(fakeSession);
      await result.promise;
    });
    expect(screen.queryByText("Validando acceso…")).not.toBeOnTheScreen();
  });

  test("muestra un error de autenticación y conserva el formulario", async () => {
    render(
      <NavigationSessionProvider>
        <Login />
      </NavigationSessionProvider>,
    );
    fireEvent.changeText(screen.getByLabelText("Correo electrónico"), "incorrecto@cereti.test");
    fireEvent.changeText(screen.getByLabelText("Contraseña"), "clave-incorrecta");
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Iniciar sesión" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Correo o contraseña incorrectos.");
    expect(screen.getByDisplayValue("incorrecto@cereti.test")).toBeOnTheScreen();
  });

  test.each([
    ["estudiante", "Estudiante"],
    ["profesional", "Profesional"],
    ["practicante", "Practicante"],
    ["administrador", "Administrador"],
  ] as const)("el mock permite iniciar sesión como %s", async (role, _label) => {
    const authPort = createMockAuthenticationPort();
    await expect(authPort.login(mockAuthCredentials[role])).resolves.toMatchObject({
      user: { role },
    });
  });

  test("logout usa el adapter y no limpia la sesión antes de que termine", async () => {
    const logoutResult = deferred<void>();
    const authPort: AuthPort = {
      login: jest.fn(async () => fakeSession),
      logout: jest.fn(() => logoutResult.promise),
    };

    render(
      <NavigationSessionProvider authPort={authPort}>
        <SessionContent />
      </NavigationSessionProvider>,
    );
    fireEvent.changeText(screen.getByLabelText("Correo electrónico"), fakeSession.user.email);
    fireEvent.changeText(screen.getByLabelText("Contraseña"), "clave-ficticia");
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Iniciar sesión" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("Inicio ficticio")).toBeOnTheScreen());

    const logoutButton = screen.getByRole("button", { name: "Cambiar de rol" });
    await act(async () => {
      fireEvent.press(logoutButton);
      fireEvent.press(logoutButton);
      await Promise.resolve();
    });
    expect(authPort.logout).toHaveBeenCalledWith(fakeSession);
    expect(authPort.logout).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("progressbar", { name: "Cerrando sesión" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Cerrando sesión…" })).toBeDisabled();
    expect(screen.getByText("Inicio ficticio")).toBeOnTheScreen();
    await act(async () => {
      logoutResult.resolve(undefined);
      await logoutResult.promise;
    });
    expect(await screen.findByText("Inicia sesión")).toBeOnTheScreen();
  });

  test("conserva la sesión, muestra el error y permite reintentar el logout", async () => {
    const retryResult = deferred<void>();
    const authPort: AuthPort = {
      login: jest.fn(async () => fakeSession),
      logout: jest
        .fn<Promise<void>, []>()
        .mockRejectedValueOnce(new Error("No se pudo cerrar sesión."))
        .mockReturnValueOnce(retryResult.promise),
    };

    render(
      <NavigationSessionProvider authPort={authPort}>
        <SessionContent />
      </NavigationSessionProvider>,
    );
    fireEvent.changeText(screen.getByLabelText("Correo electrónico"), fakeSession.user.email);
    fireEvent.changeText(screen.getByLabelText("Contraseña"), "clave-ficticia");
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Iniciar sesión" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("Inicio ficticio")).toBeOnTheScreen());

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Cambiar de rol" }));
      await Promise.resolve();
    });
    expect(screen.getByText("Inicio ficticio")).toBeOnTheScreen();
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cerrar sesión.");
    expect(screen.getByRole("button", { name: "Reintentar cierre de sesión" })).toBeEnabled();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Reintentar cierre de sesión" }));
      await Promise.resolve();
    });
    expect(authPort.logout).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Inicio ficticio")).toBeOnTheScreen();
    await act(async () => {
      retryResult.resolve(undefined);
      await retryResult.promise;
    });
    expect(await screen.findByText("Inicia sesión")).toBeOnTheScreen();
  });

  test("muestra los dos estados de asignación del practicante", async () => {
    const appDirectory = path.resolve(__dirname, "../app");
    renderRouter(appDirectory);
    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: "Entrar como Practicante sin asignación" }),
      );
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        screen.getByText(
          "Acceso restringido: todavía no tienes acompañamientos asignados. Te avisaremos cuando exista uno.",
        ),
      ).toBeOnTheScreen(),
    );
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Cambiar de rol" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("Inicia sesión")).toBeOnTheScreen());
    await act(async () => {
      fireEvent.press(await screen.findByRole("button", { name: "Entrar como Practicante" }));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByText(/Tienes acompañamientos asignados/)).toBeOnTheScreen(),
    );
  });
});
