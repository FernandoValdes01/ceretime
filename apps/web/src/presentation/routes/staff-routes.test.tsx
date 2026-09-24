// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "./router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";

/**
 * Store reactivo de sesión para pruebas (TI2-20): los hooks mockeados se
 * suscriben y `set*` notifica dentro de `act`, así los cambios con el guard
 * montado re-renderizan como la reactividad real de Convex.
 */
const sessionMocks = vi.hoisted(() => {
  let session: WebSessionState = undefined;
  let role: WebSessionRole = undefined;
  let backendConfigured = true;
  const sessionListeners = new Set<() => void>();
  const roleListeners = new Set<() => void>();

  function notify(listeners: Set<() => void>) {
    listeners.forEach((listener) => listener());
  }

  return {
    getSession: () => session,
    getRole: () => role,
    isBackendConfigured: () => backendConfigured,
    setSession: (next: WebSessionState) => {
      session = next;
      notify(sessionListeners);
    },
    setRole: (next: WebSessionRole) => {
      role = next;
      notify(roleListeners);
    },
    setBackendConfigured: (next: boolean) => {
      backendConfigured = next;
    },
    subscribeSession: (listener: () => void) => {
      sessionListeners.add(listener);
      return () => {
        sessionListeners.delete(listener);
      };
    },
    subscribeRole: (listener: () => void) => {
      roleListeners.add(listener);
      return () => {
        roleListeners.delete(listener);
      };
    },
    reset: () => {
      session = undefined;
      role = undefined;
      backendConfigured = true;
      sessionListeners.clear();
      roleListeners.clear();
    },
  };
});

vi.mock("convex/react", () => ({ useQuery: () => sessionMocks.getSession() }));

vi.mock("../session/session-state", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSessionState: () =>
      useSyncExternalStore(sessionMocks.subscribeSession, sessionMocks.getSession),
    useSessionRole: () => useSyncExternalStore(sessionMocks.subscribeRole, sessionMocks.getRole),
  };
});

vi.mock("../../infrastructure/auth/auth-client", () => ({
  authClient: { useSession: () => ({ isPending: false }) },
}));

vi.mock("../../infrastructure/convex/convex-client", () => ({
  convexUrl: "https://test.convex.cloud",
  convexSiteUrl: "https://test.convex.site",
  get isBackendConfigured() {
    return sessionMocks.isBackendConfigured();
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
  sessionMocks.reset();
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
    sessionMocks.setSession(SIN_SESION);
    sessionMocks.setRole(ROL_DESCONOCIDO);
    const { router } = renderAt(portal.ruta);

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({ redirect: portal.ruta });
    const accessHeading = await screen.findByRole("heading", { name: "Acceso institucional" });
    expect(accessHeading).toBeDefined();
    expect(screen.queryByRole("heading", { name: portal.titulo })).toBeNull();
  });

  test.each(portal.ajenos)("el rol %s ve denegado sin contenido del portal", async (rolAjeno) => {
    sessionMocks.setSession(
      rolAjeno === "student"
        ? {
            status: "authenticated",
            email: "estudiante@alu.uct.cl",
            name: "Estudiante Ficticio",
            population: "estudiante",
          }
        : sesionPersonal(`${rolAjeno}@uct.cl`),
    );
    sessionMocks.setRole(rolDe(rolAjeno));
    const { router } = renderAt(portal.ruta);

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    const deniedHeading = await screen.findByRole("heading", { name: "Acceso denegado" });
    expect(deniedHeading).toBeDefined();
    expect(screen.queryByRole("heading", { name: portal.titulo })).toBeNull();
  });

  test("la sesión sin perfil ve denegado aunque esté autenticada", async () => {
    sessionMocks.setSession(sesionPersonal("fantasma@uct.cl"));
    sessionMocks.setRole(ROL_DESCONOCIDO);
    const { router } = renderAt(portal.ruta);

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: portal.titulo })).toBeNull();
  });

  test("el rol permitido ve su portal sin redirigir", async () => {
    sessionMocks.setSession(sesionPersonal(`${portal.rol}@uct.cl`));
    sessionMocks.setRole(rolDe(portal.rol));
    const { router } = renderAt(portal.ruta);

    const portalHeading = await screen.findByRole("heading", { name: portal.titulo });
    expect(portalHeading).toBeDefined();
    expect(router.state.location.pathname).toBe(portal.ruta);
  });
});

describe("límites de navegación por rol (TI2-20)", () => {
  test("el Practicante no enlaza acompañamientos concretos", async () => {
    sessionMocks.setSession(sesionPersonal("intern@uct.cl"));
    sessionMocks.setRole(rolDe("intern"));
    renderAt("/practicante");

    await screen.findByRole("heading", { name: "Portal del Practicante" });
    const hrefs = portalHrefs();
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href === "/practicante" || href === "/login").toBe(true);
    }
  });

  test("el Administrador no enlaza acompañamientos ni notas internas", async () => {
    sessionMocks.setSession(sesionPersonal("admin@uct.cl"));
    sessionMocks.setRole(rolDe("admin"));
    renderAt("/administrador");

    await screen.findByRole("heading", { name: "Portal de Administración" });
    const hrefs = portalHrefs();
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href === "/administrador" || href === "/login").toBe(true);
    }
  });

  test("el Profesional no entra al portal del Estudiante", async () => {
    sessionMocks.setSession(sesionPersonal("pro@uct.cl"));
    sessionMocks.setRole(rolDe("professional"));
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
    sessionMocks.setSession(sesionPersonal(`${rol}@uct.cl`));
    sessionMocks.setRole(rolDe(rol));
    const { router } = renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe(destino));
  });

  test("el índice sin rol conocido deriva a denegado", async () => {
    sessionMocks.setSession(sesionPersonal("fantasma@uct.cl"));
    sessionMocks.setRole(ROL_DESCONOCIDO);
    const { router } = renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
  });

  test("el acceso con retorno navega ahí para cualquier población", async () => {
    sessionMocks.setSession(sesionPersonal("pro@uct.cl"));
    sessionMocks.setRole(rolDe("professional"));
    const { router } = renderAt("/login?redirect=/profesional");

    await waitFor(() => expect(router.state.location.pathname).toBe("/profesional"));
    const portalHeading = await screen.findByRole("heading", { name: "Portal del Profesional" });
    expect(portalHeading).toBeDefined();
  });
});

describe("transiciones de sesión con el guard montado (TI2-20)", () => {
  test("perder la sesión oculta el portal y navega al acceso aunque el rol siga vigente", async () => {
    sessionMocks.setSession(sesionPersonal("pro@uct.cl"));
    sessionMocks.setRole(rolDe("professional"));
    const { router } = renderAt("/profesional");

    const portalHeading = await screen.findByRole("heading", { name: "Portal del Profesional" });
    expect(portalHeading).toBeDefined();

    // La sesión cae pero el rol todavía conserva el valor anterior: el
    // portal debe ocultarse desde el primer render sin sesión.
    act(() => {
      sessionMocks.setSession(SIN_SESION);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({ redirect: "/profesional" });
    expect(screen.queryByRole("heading", { name: "Portal del Profesional" })).toBeNull();
  });

  test("el índice espera al rol pendiente y deriva al portal cuando se resuelve", async () => {
    sessionMocks.setSession(sesionPersonal("pro@uct.cl"));
    const { router } = renderAt("/");

    // Rol todavía pendiente: muestra carga sin navegar a ningún lado.
    const loading = await screen.findByRole("status");
    expect(loading).toBeDefined();
    expect(router.state.location.pathname).toBe("/");

    act(() => {
      sessionMocks.setRole(rolDe("professional"));
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/profesional"));
    const portalHeading = await screen.findByRole("heading", { name: "Portal del Profesional" });
    expect(portalHeading).toBeDefined();
  });
});
