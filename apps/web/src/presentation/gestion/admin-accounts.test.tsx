// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_ERROR_MESSAGE } from "../../../../../convex/domain/index.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { StaffAccountsPage } from "./admin-accounts-data.ts";

/**
 * Pruebas de cuentas de personal para Administración (TI2-169).
 *
 * Integración por el router real (incluye guards): la sesión simulada es de
 * Administrador, salvo los casos de denegación. Las lecturas de cuentas se
 * sustituyen por módulo porque `convex/react` no distingue referencias del `api`
 * generado; el cableado real query→referencia lo cubren `tsc`, el build y la
 * verificación manual. Todos los datos son ficticios.
 */

const enableMock = vi.fn();
const revokeMock = vi.fn();

let mockedSession: WebSessionState;
let mockedPair:
  | {
      session: WebSessionState;
      role: WebSessionRole;
    }
  | undefined;
let mockedBackendConfigured = true;

let professionalPage: StaffAccountsPage | undefined;
let adminPage: StaffAccountsPage | undefined;
let listThrows: Error | null = null;

vi.mock("convex/react", () => ({ useQuery: () => mockedSession }));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () => mockedPair,
}));

vi.mock("./admin-accounts-data.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./admin-accounts-data.ts")>();
  return {
    ...actual,
    useStaffAccounts: (role: "professional" | "admin") => {
      if (listThrows !== null) {
        throw listThrows;
      }
      return role === "professional" ? professionalPage : adminPage;
    },
    useEnableStaffAccount: () => enableMock,
    useRevokeStaffAccount: () => revokeMock,
  };
});

vi.mock("../../infrastructure/auth/auth-client", () => ({
  authClient: { useSession: () => ({ isPending: false }) },
}));

vi.mock("../../infrastructure/convex/convex-client", () => ({
  convexUrl: "https://test.convex.cloud",
  convexSiteUrl: "https://test.convex.site",
  get isBackendConfigured() {
    return mockedBackendConfigured;
  },
  convexClient: {},
}));

const SESION_ADMIN: WebSessionState = {
  status: "authenticated",
  email: "admin@uct.cl",
  name: "Administrador Ficticio",
  population: "personal",
};

const PAR_ADMIN: { session: WebSessionState; role: WebSessionRole } = {
  session: SESION_ADMIN,
  role: { status: "authenticated", role: "admin", email: "admin@uct.cl" },
};

const SIN_SESION: WebSessionState = { status: "unauthenticated" };

const PAR_SIN_SESION = {
  session: SIN_SESION,
  role: { status: "unauthenticated" },
} as const;

function cuenta(
  overrides: Partial<{
    _id: string;
    email: string;
    fullName: string;
    role: "professional" | "admin";
    institutionalStatus: "enabled" | "disabled" | "pending";
    accountStatus: "active" | "inactive";
  }> = {},
) {
  return {
    _id: (overrides._id ?? "user-1") as Id<"users">,
    email: overrides.email ?? "pro1@uct.cl",
    fullName: overrides.fullName ?? "Profesional Uno",
    role: overrides.role ?? ("professional" as const),
    institutionalStatus: overrides.institutionalStatus ?? ("pending" as const),
    accountStatus: overrides.accountStatus ?? ("active" as const),
  };
}

function pagina(items: ReturnType<typeof cuenta>[]): StaffAccountsPage {
  return { page: items, isDone: true, continueCursor: "" };
}

function comoAdministrador() {
  mockedSession = SESION_ADMIN;
  mockedPair = PAR_ADMIN;
}

function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(<RouterProvider router={router} />);
  return { router, unmount: view.unmount };
}

/** Abre el menú de tres puntos de la fila y devuelve la opción pedida. */
async function openRowMenu(accountName: string, itemName: string) {
  const menu = await screen.findByRole("button", { name: `Acciones para ${accountName}` });
  fireEvent.click(menu);
  return await screen.findByRole("menuitem", { name: itemName });
}

beforeEach(() => {
  vi.stubEnv("VITE_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("VITE_CONVEX_SITE_URL", "https://test.convex.site");
  sessionStorage.clear();
  mockedSession = undefined;
  mockedPair = undefined;
  mockedBackendConfigured = true;
  professionalPage = undefined;
  adminPage = undefined;
  listThrows = null;
  enableMock.mockReset();
  revokeMock.mockReset();
  enableMock.mockResolvedValue({ userId: "user-1" });
  revokeMock.mockResolvedValue({ userId: "user-1" });
});

afterEach(() => {
  cleanup();
});

describe("cuentas de personal (TI2-169)", () => {
  test("carga muestra estado y luego las cuentas con nombres legibles", async () => {
    comoAdministrador();
    renderAt("/administrador/cuentas");

    expect(await screen.findByText(/Cargando las cuentas profesionales/)).toBeDefined();

    professionalPage = pagina([
      cuenta({ _id: "user-1", fullName: "Profesional Uno", institutionalStatus: "pending" }),
    ]);
    adminPage = pagina([
      cuenta({
        _id: "user-2",
        email: "admin1@uct.cl",
        fullName: "Administradora Uno",
        role: "admin",
        institutionalStatus: "enabled",
      }),
    ]);
    cleanup();
    renderAt("/administrador/cuentas");

    expect(
      await screen.findByRole("button", { name: "Acciones para Profesional Uno" }),
    ).toBeDefined();
    const habilitar = await openRowMenu("Profesional Uno", "Habilitar cuenta");
    expect(habilitar).toBeDefined();
    expect(screen.getAllByText(/Profesional Uno/).length).toBeGreaterThan(0);
    expect(screen.getByText("Profesional")).toBeDefined();
    expect(screen.getByText(/Estado: Pendiente/)).toBeDefined();
    expect(screen.getByText("Administrador")).toBeDefined();
    expect(screen.getByText(/Estado: Habilitada/)).toBeDefined();
    expect(
      screen.getByText(/No concede acceso a acompañamientos ni a notas internas/),
    ).toBeDefined();
  });

  test("listado vacío muestra estado vacío por rol", async () => {
    comoAdministrador();
    professionalPage = pagina([]);
    adminPage = pagina([]);
    renderAt("/administrador/cuentas");

    expect(await screen.findByText("No hay cuentas profesionales.")).toBeDefined();
    expect(screen.getByText("No hay cuentas administrativas.")).toBeDefined();
  });

  test("denegación de lectura muestra acceso denegado sin datos", async () => {
    comoAdministrador();
    listThrows = new ConvexError(UNAUTHORIZED_ERROR_MESSAGE);
    renderAt("/administrador/cuentas");

    const avisos = await screen.findAllByText(/No autorizado/);
    expect(avisos.length).toBe(2);
    expect(screen.queryByText(/Profesional Uno/)).toBeNull();
  });

  test("habilitar una cuenta pendiente confirma y llama a la API", async () => {
    comoAdministrador();
    professionalPage = pagina([cuenta({ _id: "user-1", institutionalStatus: "pending" })]);
    adminPage = pagina([]);
    renderAt("/administrador/cuentas");

    const habilitar = await openRowMenu("Profesional Uno", "Habilitar cuenta");
    fireEvent.click(habilitar);

    expect(await screen.findByText("Cuenta de Profesional Uno habilitada.")).toBeDefined();
    expect(enableMock).toHaveBeenCalledWith({ userId: "user-1" });
  });

  test("revocar una cuenta habilitada confirma y llama a la API", async () => {
    comoAdministrador();
    professionalPage = pagina([cuenta({ _id: "user-1", institutionalStatus: "enabled" })]);
    adminPage = pagina([]);
    renderAt("/administrador/cuentas");

    const revocar = await openRowMenu("Profesional Uno", "Revocar cuenta");
    fireEvent.click(revocar);

    fireEvent.click(await screen.findByRole("button", { name: "Revocar cuenta" }));

    expect(await screen.findByText("Cuenta de Profesional Uno revocada.")).toBeDefined();
    expect(revokeMock).toHaveBeenCalledWith({ userId: "user-1" });
  });

  test("cancelar la revocación cierra el diálogo sin escribir", async () => {
    comoAdministrador();
    professionalPage = pagina([cuenta({ _id: "user-1", institutionalStatus: "enabled" })]);
    adminPage = pagina([]);
    renderAt("/administrador/cuentas");

    const revocar = await openRowMenu("Profesional Uno", "Revocar cuenta");
    fireEvent.click(revocar);

    expect(
      await screen.findByText("Esta cuenta perderá acceso a CERETI en su próximo ingreso."),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(revokeMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/revocada\./)).toBeNull();
  });

  test("acción denegada muestra acceso denegado", async () => {
    comoAdministrador();
    professionalPage = pagina([cuenta({ _id: "user-1", institutionalStatus: "pending" })]);
    adminPage = pagina([]);
    enableMock.mockRejectedValueOnce(new ConvexError(UNAUTHORIZED_ERROR_MESSAGE));
    renderAt("/administrador/cuentas");

    const habilitar = await openRowMenu("Profesional Uno", "Habilitar cuenta");
    fireEvent.click(habilitar);

    expect(
      await screen.findByText("No autorizado. Pide acceso por el canal oficial si corresponde."),
    ).toBeDefined();
    expect(screen.queryByText(/habilitada\./)).toBeNull();
  });

  test("fallo de habilitación muestra el mensaje público del Backend", async () => {
    comoAdministrador();
    professionalPage = pagina([cuenta({ _id: "user-1", institutionalStatus: "pending" })]);
    adminPage = pagina([]);
    enableMock.mockRejectedValueOnce(
      new ConvexError({ code: "conflict", message: "La cuenta ya está habilitada." }),
    );
    renderAt("/administrador/cuentas");

    fireEvent.click(await openRowMenu("Profesional Uno", "Habilitar cuenta"));

    expect(await screen.findByText("La cuenta ya está habilitada.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("revocar la propia cuenta avisa abajo sin pintar error en la fila", async () => {
    comoAdministrador();
    professionalPage = pagina([cuenta({ _id: "user-1", institutionalStatus: "enabled" })]);
    adminPage = pagina([]);
    revokeMock.mockRejectedValueOnce(
      new ConvexError({ code: "conflict", message: "No puedes revocar tu propia cuenta." }),
    );
    renderAt("/administrador/cuentas");

    fireEvent.click(await openRowMenu("Profesional Uno", "Revocar cuenta"));
    fireEvent.click(await screen.findByRole("button", { name: "Revocar cuenta" }));

    expect(await screen.findByText("No puedes revocar tu propia cuenta.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("el menú se cierra con Escape y devuelve el foco al botón", async () => {
    comoAdministrador();
    professionalPage = pagina([cuenta({ _id: "user-1", institutionalStatus: "pending" })]);
    adminPage = pagina([]);
    renderAt("/administrador/cuentas");

    const menu = await screen.findByRole("button", { name: "Acciones para Profesional Uno" });
    fireEvent.click(menu);
    const item = await screen.findByRole("menuitem", {
      name: "Habilitar cuenta",
    });
    expect(item).toBeDefined();

    fireEvent.keyDown(item, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
    expect(document.activeElement).toBe(menu);
    expect(enableMock).not.toHaveBeenCalled();
  });
});

describe("guard de la ruta de cuentas (TI2-169)", () => {
  test("sin sesión redirige al acceso conservando el retorno", async () => {
    mockedSession = SIN_SESION;
    mockedPair = PAR_SIN_SESION;
    const { router } = renderAt("/administrador/cuentas");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({
      redirect: "/administrador/cuentas",
    });
    expect(screen.queryByRole("heading", { name: "Cuentas de personal" })).toBeNull();
  });

  test.each(["professional", "intern", "student"] as const)(
    "el rol %s ve denegado sin contenido de cuentas",
    async (rolAjeno) => {
      const emailAjeno = rolAjeno === "student" ? "estudiante@alu.uct.cl" : `${rolAjeno}@uct.cl`;
      mockedSession =
        rolAjeno === "student"
          ? {
              status: "authenticated",
              email: emailAjeno,
              name: "Estudiante Ficticio",
              population: "estudiante",
            }
          : {
              status: "authenticated",
              email: emailAjeno,
              name: "Personal Ficticio",
              population: "personal",
            };
      mockedPair = {
        session: mockedSession,
        role: { status: "authenticated", role: rolAjeno, email: emailAjeno },
      };
      const { router } = renderAt("/administrador/cuentas");

      await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
      expect(screen.queryByRole("heading", { name: "Cuentas de personal" })).toBeNull();
    },
  );
});
