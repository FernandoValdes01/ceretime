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
import { practitionerRoutes } from "../src/presentation/navigation/practitioner-routes";

const loginProps = {
  unassignedPractitionerCredentials: {
    email: "practicante-sin-asignacion@cereti.test",
    password: "cereti-demo",
  },
} as const;

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
  return session ? (
    <RoleHome title="Inicio ficticio" description="Sesión activa." />
  ) : (
    <Login {...loginProps} />
  );
}

describe("autenticación mobile simulada", () => {
  test("expone loading mientras prepara el rol seleccionado", async () => {
    const result = deferred<AuthSession>();
    const authPort: AuthPort = {
      login: jest.fn(() => result.promise),
      logout: jest.fn(async () => undefined),
    };

    render(
      <NavigationSessionProvider authPort={authPort} demoCredentials={mockAuthCredentials}>
        <Login {...loginProps} />
      </NavigationSessionProvider>,
    );
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Entrar como Estudiante" }));
      await Promise.resolve();
    });
    expect(screen.getByText("Preparando la experiencia…")).toBeOnTheScreen();
    expect(authPort.login).toHaveBeenCalledTimes(1);
    await act(async () => {
      result.resolve(fakeSession);
      await result.promise;
    });
    expect(screen.queryByText("Preparando la experiencia…")).not.toBeOnTheScreen();
  });

  test("no muestra campos de credenciales en el selector de roles", async () => {
    render(
      <NavigationSessionProvider
        authPort={createMockAuthenticationPort()}
        demoCredentials={mockAuthCredentials}
      >
        <Login {...loginProps} />
      </NavigationSessionProvider>,
    );
    expect(screen.queryByLabelText("Correo electrónico")).not.toBeOnTheScreen();
    expect(screen.queryByLabelText("Contraseña")).not.toBeOnTheScreen();
    expect(screen.getByText("Elige un rol")).toBeOnTheScreen();
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
      <NavigationSessionProvider authPort={authPort} demoCredentials={mockAuthCredentials}>
        <SessionContent />
      </NavigationSessionProvider>,
    );
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Entrar como Estudiante" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("Inicio ficticio")).toBeOnTheScreen());

    const logoutButton = screen.getByRole("button", { name: "Cerrar sesión" });
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
    expect(await screen.findByText("Elige un rol")).toBeOnTheScreen();
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
      <NavigationSessionProvider authPort={authPort} demoCredentials={mockAuthCredentials}>
        <SessionContent />
      </NavigationSessionProvider>,
    );
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Entrar como Estudiante" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("Inicio ficticio")).toBeOnTheScreen());

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
      await Promise.resolve();
    });
    expect(screen.getByText("Inicio ficticio")).toBeOnTheScreen();
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cerrar sesión.");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
      await Promise.resolve();
    });
    expect(authPort.logout).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Inicio ficticio")).toBeOnTheScreen();
    await act(async () => {
      retryResult.resolve(undefined);
      await retryResult.promise;
    });
    expect(await screen.findByText("Elige un rol")).toBeOnTheScreen();
  });

  test("muestra los dos estados de asignación del practicante", async () => {
    const appDirectory = path.resolve(__dirname, "../app");
    const navigation = renderRouter(appDirectory);
    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: "Entrar como Practicante sin asignación" }),
      );
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        screen.getByText(
          "Todavía no tienes acompañamientos asignados. Te avisaremos cuando exista uno.",
        ),
      ).toBeOnTheScreen(),
    );
    expect(navigation.getPathname()).toBe(practitionerRoutes.unassigned);
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Cerrar sesión" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("Elige un rol")).toBeOnTheScreen());
    await act(async () => {
      fireEvent.press(await screen.findByRole("button", { name: "Entrar como Practicante" }));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByText(/Tienes acompañamientos asignados/)).toBeOnTheScreen(),
    );
    expect(navigation.getPathname()).toBe(practitionerRoutes.assigned);
  });
});
