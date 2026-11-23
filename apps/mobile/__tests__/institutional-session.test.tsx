import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import type { InstitutionalAuthPort } from "../src/application/auth-port";
import { UserFacingError } from "../src/application/user-facing-error";
import type { AuthSession } from "../src/domain/auth-models";
import { demoAuthCredentials } from "../src/infrastructure/demo-auth-adapter";
import { LoginScreen } from "../src/presentation/auth/login-screen";
import {
  NavigationSessionProvider,
  useNavigationSession,
} from "../src/presentation/navigation/session";

const professionalSession: AuthSession = {
  user: {
    id: "sam@uct.cl",
    displayName: "Sam Profesional",
    email: "sam@uct.cl",
    role: "profesional",
    assignedAccompaniments: [],
  },
};

function createPort(overrides: Partial<InstitutionalAuthPort> = {}) {
  const port = {
    restoreSession: jest.fn(async () => null),
    signInInstitutional: jest.fn(async () => professionalSession),
    logout: jest.fn(async () => undefined),
    ...overrides,
  } satisfies InstitutionalAuthPort;
  return port;
}

function renderSession(port: InstitutionalAuthPort) {
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <NavigationSessionProvider authPort={port} demoCredentials={demoAuthCredentials}>
        {children}
      </NavigationSessionProvider>
    );
  }
  return renderHook(() => useNavigationSession(), { wrapper: Wrapper });
}

describe("sesión institucional", () => {
  test("recupera la sesión guardada y entrega el rol que decidió el servidor", async () => {
    const port = createPort({ restoreSession: jest.fn(async () => professionalSession) });
    const { result } = renderSession(port);

    expect(result.current.isRestoring).toBe(true);
    expect(result.current.session).toBeNull();

    await waitFor(() => expect(result.current.isRestoring).toBe(false));
    expect(result.current.status).toBe("authenticated");
    expect(result.current.role).toBe("profesional");
  });

  test("sin sesión guardada queda en el acceso sin mostrar un error", async () => {
    const { result } = renderSession(createPort());

    await waitFor(() => expect(result.current.isRestoring).toBe(false));
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.error).toBeNull();
    expect(result.current.session).toBeNull();
  });

  test("si no puede verificar la sesión muestra el motivo y deja reintentar el ingreso", async () => {
    const port = createPort({
      restoreSession: jest.fn(async () => {
        throw new UserFacingError("No pudimos verificar tu sesión.");
      }),
    });
    const { result } = renderSession(port);

    await waitFor(() => expect(result.current.isRestoring).toBe(false));
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("No pudimos verificar tu sesión.");

    await act(async () => {
      await result.current.signInInstitutional("personal");
    });
    expect(result.current.status).toBe("authenticated");
  });

  test("no deja ingresar mientras verifica la sesión guardada", async () => {
    let finishRestore!: (session: AuthSession | null) => void;
    const port = createPort({
      restoreSession: jest.fn(() => new Promise<AuthSession | null>((r) => (finishRestore = r))),
    });
    const { result } = renderSession(port);

    await act(async () => {
      await expect(result.current.signInInstitutional("estudiante")).resolves.toBe(false);
    });
    expect(port.signInInstitutional).not.toHaveBeenCalled();

    await act(async () => finishRestore(null));
    expect(result.current.isRestoring).toBe(false);
  });

  test("cancelar el ingreso informa que no se completó y permite reintentar", async () => {
    const signInInstitutional = jest
      .fn<Promise<AuthSession | null>, ["estudiante" | "personal"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(professionalSession);
    const { result } = renderSession(createPort({ signInInstitutional }));
    await waitFor(() => expect(result.current.isRestoring).toBe(false));

    await act(async () => {
      await expect(result.current.signInInstitutional("estudiante")).resolves.toBe(false);
    });
    expect(result.current.session).toBeNull();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/No se completó el ingreso/);

    await act(async () => {
      await expect(result.current.signInInstitutional("estudiante")).resolves.toBe(true);
    });
    expect(result.current.status).toBe("authenticated");
    expect(result.current.error).toBeNull();
  });

  test("un rechazo del proveedor conserva el mensaje del puerto y no abre sesión", async () => {
    const port = createPort({
      signInInstitutional: jest.fn(async () => {
        throw new UserFacingError("No pudimos iniciar sesión con tu cuenta institucional.");
      }),
    });
    const { result } = renderSession(port);
    await waitFor(() => expect(result.current.isRestoring).toBe(false));

    await act(async () => {
      await result.current.signInInstitutional("personal");
    });
    expect(result.current.session).toBeNull();
    expect(result.current.error).toBe("No pudimos iniciar sesión con tu cuenta institucional.");
  });

  test("las credenciales de demostración nunca abren una cuenta ficticia", async () => {
    const { result } = renderSession(createPort());
    await waitFor(() => expect(result.current.isRestoring).toBe(false));

    await act(async () => {
      await expect(result.current.signIn(demoAuthCredentials.administrador)).resolves.toBe(false);
      await expect(result.current.selectRole("administrador")).resolves.toBe(false);
    });
    expect(result.current.session).toBeNull();
  });

  test("cerrar sesión llama al puerto y no conserva datos de la cuenta", async () => {
    const port = createPort({ restoreSession: jest.fn(async () => professionalSession) });
    const { result } = renderSession(port);
    await waitFor(() => expect(result.current.status).toBe("authenticated"));

    await act(async () => {
      await result.current.signOut();
    });
    expect(port.logout).toHaveBeenCalledWith(professionalSession);
    expect(result.current.session).toBeNull();
    expect(result.current.role).toBeNull();
    expect(result.current.status).toBe("unauthenticated");
  });
});

describe("pantalla de ingreso institucional", () => {
  function renderLogin(port: InstitutionalAuthPort) {
    return render(
      <NavigationSessionProvider authPort={port} demoCredentials={demoAuthCredentials}>
        <LoginScreen
          mode="institutional"
          unassignedInternCredentials={demoAuthCredentials.practicante}
        />
      </NavigationSessionProvider>,
    );
  }

  test("ofrece solo las dos cuentas institucionales, sin roles de demostración", async () => {
    renderLogin(createPort());

    expect(
      await screen.findByRole("button", { name: "Continuar con cuenta @alu.uct.cl" }),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Continuar con cuenta @uct.cl" })).toBeOnTheScreen();
    expect(screen.queryByText(/Entrar como/)).not.toBeOnTheScreen();
    expect(screen.queryByText("Reiniciar demostración")).not.toBeOnTheScreen();
  });

  test("cada botón inicia la cuenta de su población y anuncia el resultado cancelado", async () => {
    const port = createPort({ signInInstitutional: jest.fn(async () => null) });
    renderLogin(port);

    fireEvent.press(await screen.findByRole("button", { name: "Continuar con cuenta @uct.cl" }));

    await waitFor(() => expect(port.signInInstitutional).toHaveBeenCalledWith("personal"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No se completó el ingreso/);
    expect(screen.getByRole("button", { name: "Continuar con cuenta @alu.uct.cl" })).toBeEnabled();
  });
});
