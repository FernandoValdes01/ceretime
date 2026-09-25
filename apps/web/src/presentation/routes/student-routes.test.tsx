// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "./router.tsx";
import type { WebSessionState } from "../session/session-state.ts";

let mockedSession: WebSessionState;
let mockedBackendConfigured = true;

vi.mock("convex/react", () => ({
  useQuery: () => mockedSession,
}));

// El índice lee el par sesión y rol: acá el rol no se usa (flujos de
// Estudiante o sin sesión), así que el par deriva de la sesión mockeada.
vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () =>
    mockedSession === undefined ? undefined : { session: mockedSession, role: undefined },
}));

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

const ESTUDIANTE: WebSessionState = {
  status: "authenticated",
  email: "estudiante@alu.uct.cl",
  name: "Estudiante Ficticio",
  population: "estudiante",
};

const PERSONAL: WebSessionState = {
  status: "authenticated",
  email: "personal@uct.cl",
  name: "Personal Ficticio",
  population: "personal",
};

const SIN_SESION: WebSessionState = { status: "unauthenticated" };

beforeEach(() => {
  vi.stubEnv("VITE_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("VITE_CONVEX_SITE_URL", "https://test.convex.site");
  sessionStorage.clear();
  mockedSession = undefined;
  mockedBackendConfigured = true;
});

afterEach(() => {
  cleanup();
});

function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(<RouterProvider router={router} />);
  return { router, unmount: view.unmount };
}

describe("guard del portal del Estudiante (TI2-6)", () => {
  test("el acceso directo sin sesión redirige al acceso conservando el retorno", async () => {
    mockedSession = SIN_SESION;
    const { router } = renderAt("/estudiante");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({ redirect: "/estudiante" });
    const accessHeading = await screen.findByRole("heading", { name: "Acceso institucional" });
    expect(accessHeading).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Portal del Estudiante" })).toBeNull();
  });

  test("la sesión de otra población ve denegado sin contenido protegido", async () => {
    mockedSession = PERSONAL;
    const { router } = renderAt("/estudiante");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    const deniedHeading = await screen.findByRole("heading", { name: "Acceso denegado" });
    expect(deniedHeading).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Portal del Estudiante" })).toBeNull();
  });

  test("el Estudiante con sesión ve el portal sin redirigir", async () => {
    mockedSession = ESTUDIANTE;
    const { router } = renderAt("/estudiante");

    const portalHeading = await screen.findByRole("heading", { name: "Portal del Estudiante" });
    expect(portalHeading).toBeDefined();
    expect(router.state.location.pathname).toBe("/estudiante");
  });

  test("el denegado tampoco expone contenido protegido sin sesión", async () => {
    mockedSession = SIN_SESION;
    const { router } = renderAt("/denegado");

    const deniedHeading = await screen.findByRole("heading", { name: "Acceso denegado" });
    expect(deniedHeading).toBeDefined();
    expect(router.state.location.pathname).toBe("/denegado");
    expect(screen.queryByRole("heading", { name: "Portal del Estudiante" })).toBeNull();
  });
});

describe("retorno post-login (TI2-6)", () => {
  test("el retorno OAuth en / navega a la ruta conservada una sola vez", async () => {
    mockedSession = SIN_SESION;
    const first = renderAt("/login?redirect=/estudiante");

    const accessHeading = await screen.findByRole("heading", { name: "Acceso institucional" });
    expect(accessHeading).toBeDefined();

    // El callback OAuth real vuelve a `/`: el índice consume el retorno.
    first.unmount();
    mockedSession = ESTUDIANTE;
    const { router } = renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/estudiante"));
    const portalHeading = await screen.findByRole("heading", { name: "Portal del Estudiante" });
    expect(portalHeading).toBeDefined();
    expect(sessionStorage.getItem("ceretime:post-login-redirect")).toBe(null);
  });

  test("el retorno OAuth conserva la query del destino", async () => {
    mockedSession = SIN_SESION;
    const first = renderAt("/login?redirect=/estudiante?tab=solicitudes");

    const accessHeading = await screen.findByRole("heading", { name: "Acceso institucional" });
    expect(accessHeading).toBeDefined();

    first.unmount();
    mockedSession = ESTUDIANTE;
    const { router } = renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/estudiante"));
    expect(router.state.location.search).toMatchObject({ tab: "solicitudes" });
    expect(sessionStorage.getItem("ceretime:post-login-redirect")).toBe(null);
  });

  test("la sesión ya iniciada sin retorno muestra su estado con cierre", async () => {
    mockedSession = ESTUDIANTE;
    renderAt("/login");

    const sessionHeading = await screen.findByRole("heading", { name: "Sesión iniciada" });
    expect(sessionHeading).toBeDefined();
  });
});

describe("sin backend configurado (TI2-6)", () => {
  test("las rutas muestran el acceso con su estado explícito, sin cargar infinito", async () => {
    mockedBackendConfigured = false;
    mockedSession = undefined;

    const index = renderAt("/");
    const indexHeading = await screen.findByRole("heading", { name: "Acceso institucional" });
    expect(indexHeading).toBeDefined();
    expect(index.router.state.location.pathname).toBe("/");
    index.unmount();

    const portal = renderAt("/estudiante");
    const portalHeading = await screen.findByRole("heading", { name: "Acceso institucional" });
    expect(portalHeading).toBeDefined();
    expect(portal.router.state.location.pathname).toBe("/estudiante");
    expect(screen.queryByRole("heading", { name: "Portal del Estudiante" })).toBeNull();
  });
});

describe("índice y rutas desconocidas (TI2-6)", () => {
  test("el índice sin sesión muestra el acceso (preserva el callback OAuth)", async () => {
    mockedSession = SIN_SESION;
    const { router } = renderAt("/");

    const indexHeading = await screen.findByRole("heading", { name: "Acceso institucional" });
    expect(indexHeading).toBeDefined();
    expect(router.state.location.pathname).toBe("/");
  });

  test("el índice con sesión de Estudiante deriva al portal", async () => {
    mockedSession = ESTUDIANTE;
    const { router } = renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/estudiante"));
  });

  test("una ruta desconocida vuelve al índice", async () => {
    mockedSession = SIN_SESION;
    const { router } = renderAt("/no-existe");

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });
});
