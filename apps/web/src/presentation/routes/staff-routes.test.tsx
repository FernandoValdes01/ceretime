// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "./router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";

let mockedSession: WebSessionState;
let mockedRole: WebSessionRole;
let mockedBackendConfigured = true;

vi.mock("convex/react", () => ({ useQuery: () => mockedSession }));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionRole: () => mockedRole,
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

const SIN_SESION: WebSessionState = { status: "unauthenticated" };
const ROL_DESCONOCIDO: WebSessionRole = { status: "unauthenticated" };

function sesionPersonal(email: string): WebSessionState {
  return { status: "authenticated", email, name: "Personal Ficticio", population: "personal" };
}

function rolDe(role: "professional" | "intern" | "admin" | "student"): WebSessionRole {
  return { status: "authenticated", role };
}

beforeEach(() => {
  vi.stubEnv("VITE_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("VITE_CONVEX_SITE_URL", "https://test.convex.site");
  sessionStorage.clear();
  mockedSession = undefined;
  mockedRole = undefined;
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

function portalHrefs(): Array<string> {
  return [...document.querySelectorAll("a")]
    .map((anchor) => anchor.getAttribute("href") ?? "")
    .filter((href) => href.length > 0);
}

const PORTALES = [
  {
    nombre: "Profesional",
    ruta: "/profesional",
    titulo: "Portal del Profesional",
    rol: "professional" as const,
    ajenos: ["intern", "admin", "student"] as const,
  },
  {
    nombre: "Practicante",
    ruta: "/practicante",
    titulo: "Portal del Practicante",
    rol: "intern" as const,
    ajenos: ["professional", "admin", "student"] as const,
  },
  {
    nombre: "Administración",
    ruta: "/administrador",
    titulo: "Portal de Administración",
    rol: "admin" as const,
    ajenos: ["professional", "intern", "student"] as const,
  },
] as const;

describe.each(PORTALES)("portal $nombre (TI2-20)", (portal) => {
  test("el acceso directo sin sesión redirige al acceso conservando el retorno", async () => {
    mockedSession = SIN_SESION;
    mockedRole = ROL_DESCONOCIDO;
    const { router } = renderAt(portal.ruta);

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({ redirect: portal.ruta });
    const accessHeading = await screen.findByRole("heading", { name: "Acceso institucional" });
    expect(accessHeading).toBeDefined();
    expect(screen.queryByRole("heading", { name: portal.titulo })).toBeNull();
  });

  test.each(portal.ajenos)("el rol %s ve denegado sin contenido del portal", async (rolAjeno) => {
    mockedSession =
      rolAjeno === "student"
        ? {
            status: "authenticated",
            email: "estudiante@alu.uct.cl",
            name: "Estudiante Ficticio",
            population: "estudiante",
          }
        : sesionPersonal(`${rolAjeno}@uct.cl`);
    mockedRole = rolDe(rolAjeno);
    const { router } = renderAt(portal.ruta);

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    const deniedHeading = await screen.findByRole("heading", { name: "Acceso denegado" });
    expect(deniedHeading).toBeDefined();
    expect(screen.queryByRole("heading", { name: portal.titulo })).toBeNull();
  });

  test("la sesión sin perfil ve denegado aunque esté autenticada", async () => {
    mockedSession = sesionPersonal("fantasma@uct.cl");
    mockedRole = ROL_DESCONOCIDO;
    const { router } = renderAt(portal.ruta);

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: portal.titulo })).toBeNull();
  });

  test("el rol permitido ve su portal sin redirigir", async () => {
    mockedSession = sesionPersonal(`${portal.rol}@uct.cl`);
    mockedRole = rolDe(portal.rol);
    const { router } = renderAt(portal.ruta);

    const portalHeading = await screen.findByRole("heading", { name: portal.titulo });
    expect(portalHeading).toBeDefined();
    expect(router.state.location.pathname).toBe(portal.ruta);
  });
});

describe("límites de navegación por rol (TI2-20)", () => {
  test("el Practicante no enlaza acompañamientos concretos", async () => {
    mockedSession = sesionPersonal("intern@uct.cl");
    mockedRole = rolDe("intern");
    renderAt("/practicante");

    await screen.findByRole("heading", { name: "Portal del Practicante" });
    const hrefs = portalHrefs();
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href === "/practicante" || href === "/login").toBe(true);
    }
  });

  test("el Administrador no enlaza acompañamientos ni notas internas", async () => {
    mockedSession = sesionPersonal("admin@uct.cl");
    mockedRole = rolDe("admin");
    renderAt("/administrador");

    await screen.findByRole("heading", { name: "Portal de Administración" });
    const hrefs = portalHrefs();
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href === "/administrador" || href === "/login").toBe(true);
    }
  });

  test("el Profesional no entra al portal del Estudiante", async () => {
    mockedSession = sesionPersonal("pro@uct.cl");
    mockedRole = rolDe("professional");
    const { router } = renderAt("/estudiante");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: "Portal del Estudiante" })).toBeNull();
  });
});

describe("derivación por rol (TI2-20)", () => {
  test.each([
    ["professional", "/profesional"],
    ["intern", "/practicante"],
    ["admin", "/administrador"],
  ] as const)("el índice deriva al portal de %s", async (rol, destino) => {
    mockedSession = sesionPersonal(`${rol}@uct.cl`);
    mockedRole = rolDe(rol);
    const { router } = renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe(destino));
  });

  test("el índice sin rol conocido deriva a denegado", async () => {
    mockedSession = sesionPersonal("fantasma@uct.cl");
    mockedRole = ROL_DESCONOCIDO;
    const { router } = renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
  });

  test("el acceso con retorno navega ahí para cualquier población", async () => {
    mockedSession = sesionPersonal("pro@uct.cl");
    mockedRole = rolDe("professional");
    const { router } = renderAt("/login?redirect=/profesional");

    await waitFor(() => expect(router.state.location.pathname).toBe("/profesional"));
    const portalHeading = await screen.findByRole("heading", { name: "Portal del Profesional" });
    expect(portalHeading).toBeDefined();
  });
});
