// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GENERIC_AUTH_MESSAGES } from "../../application/session/institutional-login";
import { AuthScreen } from "./AuthScreen";

type ServerState =
  | { status: "authenticated"; email: string; name: string; population: "estudiante" | "personal" }
  | { status: "unauthenticated" }
  | undefined;

let mockedServerState: ServerState;
const signOutMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: () => mockedServerState,
}));

vi.mock("../../infrastructure/auth/auth-client", () => ({
  authClient: {
    useSession: () => ({ isPending: false }),
    signIn: { social: vi.fn() },
    signOut: (...args: unknown[]) => signOutMock(...args),
  },
}));

vi.mock("../../infrastructure/convex/convex-client", () => ({
  convexUrl: "https://test.convex.cloud",
  convexSiteUrl: "https://test.convex.site",
  isBackendConfigured: true,
  convexClient: {},
}));

const SESION_ESTUDIANTE: ServerState = {
  status: "authenticated",
  email: "estudiante@alu.uct.cl",
  name: "Estudiante Ficticio",
  population: "estudiante",
};

beforeEach(() => {
  mockedServerState = { status: "unauthenticated" };
  signOutMock.mockReset().mockResolvedValue({});
});

afterEach(() => {
  cleanup();
});

describe("cierre de sesión (TI2-15)", () => {
  test("vuelve al acceso cuando el cierre invalida la sesión observada", async () => {
    // El mock simula la invalidación de Better Auth: el propio `signOut`
    // deja de exponer la sesión y el test solo comprueba que la pantalla
    // reacciona a ese estado (el `rerender` suple la reactividad de Convex,
    // que el mock estático no empuja solo).
    signOutMock.mockImplementation(async () => {
      mockedServerState = { status: "unauthenticated" };
      return {};
    });
    mockedServerState = SESION_ESTUDIANTE;
    const view = render(<AuthScreen />);
    await screen.findByRole("heading", { name: "Sesión iniciada" });

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1));

    view.rerender(<AuthScreen />);
    await screen.findByRole("heading", { name: "Acceso institucional" });
  });

  test("muestra el mensaje genérico cuando el cierre responde error", async () => {
    mockedServerState = SESION_ESTUDIANTE;
    signOutMock.mockResolvedValue({ error: { message: "falla interna" } });
    render(<AuthScreen />);
    await screen.findByRole("heading", { name: "Sesión iniciada" });

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await screen.findByText(GENERIC_AUTH_MESSAGES.signOutError);
    expect(await screen.findByRole("heading", { name: "Sesión iniciada" })).toBeDefined();
  });

  test("muestra el mensaje genérico cuando el cierre rechaza", async () => {
    mockedServerState = SESION_ESTUDIANTE;
    signOutMock.mockRejectedValue(new Error("red caída"));
    render(<AuthScreen />);
    await screen.findByRole("heading", { name: "Sesión iniciada" });

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await screen.findByText(GENERIC_AUTH_MESSAGES.signOutError);
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });
});

describe("aviso de sesión expirada (TI2-15)", () => {
  test("anuncia el término cuando una sesión existente deja de ser reconocida", async () => {
    mockedServerState = SESION_ESTUDIANTE;
    const view = render(<AuthScreen />);
    await screen.findByRole("heading", { name: "Sesión iniciada" });

    mockedServerState = { status: "unauthenticated" };
    view.rerender(<AuthScreen />);
    await screen.findByText(GENERIC_AUTH_MESSAGES.sessionExpired);
    expect(await screen.findByRole("heading", { name: "Acceso institucional" })).toBeDefined();
  });
});
