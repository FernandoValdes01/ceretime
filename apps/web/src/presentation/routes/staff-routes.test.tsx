// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "./router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";

/**
 * Store reactivo del par sesión y rol (TI2-20): como en producción, ambas
 * mitades viajan juntas en una única respuesta y `setPair` notifica dentro
 * de `act`, así los cambios con el guard montado re-renderizan como la
 * reactividad real de Convex. No existe estado intermedio con la sesión de
 * una cuenta y el rol de otra.
 */
const pairMocks = vi.hoisted(() => {
  let pair: { session: WebSessionState; role: WebSessionRole } | undefined = undefined;
  let backendConfigured = true;
  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((listener) => listener());
  }

  return {
    getPair: () => pair,
    getSession: () => pair?.session,
    isBackendConfigured: () => backendConfigured,
    setPair: (next: { session: WebSessionState; role: WebSessionRole } | undefined) => {
      pair = next;
      notify();
    },
    setBackendConfigured: (next: boolean) => {
      backendConfigured = next;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset: () => {
      pair = undefined;
      backendConfigured = true;
      listeners.clear();
    },
  };
});

vi.mock("convex/react", () => ({ useQuery: () => pairMocks.getSession() }));

vi.mock("../session/session-state", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSessionState: () => useSyncExternalStore(pairMocks.subscribe, pairMocks.getSession),
    useSessionAndRole: () => useSyncExternalStore(pairMocks.subscribe, pairMocks.getPair),
  };
});

vi.mock("../../infrastructure/auth/auth-client", () => ({
  authClient: { useSession: () => ({ isPending: false }) },
}));

vi.mock("../../infrastructure/convex/convex-client", () => ({
  convexUrl: "https://test.convex.cloud",
  convexSiteUrl: "https://test.convex.site",
  get isBackendConfigured() {
    return pairMocks.isBackendConfigured();
  },
  convexClient: {},
}));

const SIN_SESION: WebSessionState = { status: "unauthenticated" };
const ROL_DESCONOCIDO: WebSessionRole = { status: "unauthenticated" };

function sesionPersonal(email: string): WebSessionState {
  return { status: "authenticated", email, name: "Personal Ficticio", population: "personal" };
}

function rolDe(
  role: "professional" | "intern" | "admin" | "student",
  email: string,
): WebSessionRole {
  return { status: "authenticated", role, email };
}

beforeEach(() => {
  vi.stubEnv("VITE_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("VITE_CONVEX_SITE_URL", "https://test.convex.site");
  sessionStorage.clear();
  pairMocks.reset();
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
    pairMocks.setPair({ session: SIN_SESION, role: ROL_DESCONOCIDO });
    const { router } = renderAt(portal.ruta);

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({ redirect: portal.ruta });
    const accessHeading = await screen.findByRole("heading", { name: "Acceso institucional" });
    expect(accessHeading).toBeDefined();
    expect(screen.queryByRole("heading", { name: portal.titulo })).toBeNull();
  });

  test.each(portal.ajenos)("el rol %s ve denegado sin contenido del portal", async (rolAjeno) => {
    const emailAjeno = rolAjeno === "student" ? "estudiante@alu.uct.cl" : `${rolAjeno}@uct.cl`;
    pairMocks.setPair({
      session:
        rolAjeno === "student"
          ? {
              status: "authenticated",
              email: emailAjeno,
              name: "Estudiante Ficticio",
              population: "estudiante",
            }
          : sesionPersonal(emailAjeno),
      role: rolDe(rolAjeno, emailAjeno),
    });
    const { router } = renderAt(portal.ruta);

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    const deniedHeading = await screen.findByRole("heading", { name: "Acceso denegado" });
    expect(deniedHeading).toBeDefined();
    expect(screen.queryByRole("heading", { name: portal.titulo })).toBeNull();
  });

  test("la sesión sin perfil ve denegado aunque esté autenticada", async () => {
    pairMocks.setPair({ session: sesionPersonal("fantasma@uct.cl"), role: ROL_DESCONOCIDO });
    const { router } = renderAt(portal.ruta);

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: portal.titulo })).toBeNull();
  });

  test("el rol permitido ve su portal sin redirigir", async () => {
    pairMocks.setPair({
      session: sesionPersonal(`${portal.rol}@uct.cl`),
      role: rolDe(portal.rol, `${portal.rol}@uct.cl`),
    });
    const { router } = renderAt(portal.ruta);

    const portalHeading = await screen.findByRole("heading", { name: portal.titulo });
    expect(portalHeading).toBeDefined();
    expect(router.state.location.pathname).toBe(portal.ruta);
  });
});

describe("límites de navegación por rol (TI2-20)", () => {
  test("el Practicante no enlaza acompañamientos concretos", async () => {
    pairMocks.setPair({
      session: sesionPersonal("intern@uct.cl"),
      role: rolDe("intern", "intern@uct.cl"),
    });
    renderAt("/practicante");

    await screen.findByRole("heading", { name: "Portal del Practicante" });
    const hrefs = portalHrefs();
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href === "/practicante" || href === "/login").toBe(true);
    }
  });

  test("el Administrador no enlaza acompañamientos ni notas internas", async () => {
    pairMocks.setPair({
      session: sesionPersonal("admin@uct.cl"),
      role: rolDe("admin", "admin@uct.cl"),
    });
    renderAt("/administrador");

    await screen.findByRole("heading", { name: "Portal de Administración" });
    const hrefs = portalHrefs();
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href === "/administrador" || href === "/login").toBe(true);
    }
  });

  test("el Profesional no entra al portal del Estudiante", async () => {
    pairMocks.setPair({
      session: sesionPersonal("pro@uct.cl"),
      role: rolDe("professional", "pro@uct.cl"),
    });
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
    pairMocks.setPair({
      session: sesionPersonal(`${rol}@uct.cl`),
      role: rolDe(rol, `${rol}@uct.cl`),
    });
    const { router } = renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe(destino));
  });

  test("el índice sin rol conocido deriva a denegado", async () => {
    pairMocks.setPair({ session: sesionPersonal("fantasma@uct.cl"), role: ROL_DESCONOCIDO });
    const { router } = renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
  });

  test("el acceso con retorno navega ahí para cualquier población", async () => {
    pairMocks.setPair({
      session: sesionPersonal("pro@uct.cl"),
      role: rolDe("professional", "pro@uct.cl"),
    });
    const { router } = renderAt("/login?redirect=/profesional");

    await waitFor(() => expect(router.state.location.pathname).toBe("/profesional"));
    const portalHeading = await screen.findByRole("heading", { name: "Portal del Profesional" });
    expect(portalHeading).toBeDefined();
  });
});

describe("transiciones de sesión con el guard montado (TI2-20)", () => {
  test("perder la sesión oculta el portal y navega al acceso aunque el rol siga vigente", async () => {
    pairMocks.setPair({
      session: sesionPersonal("pro@uct.cl"),
      role: rolDe("professional", "pro@uct.cl"),
    });
    const { router } = renderAt("/profesional");

    const portalHeading = await screen.findByRole("heading", { name: "Portal del Profesional" });
    expect(portalHeading).toBeDefined();

    // La sesión cae pero el par conserva el rol anterior: el portal debe
    // ocultarse desde el primer render sin sesión.
    act(() => {
      pairMocks.setPair({ session: SIN_SESION, role: rolDe("professional", "pro@uct.cl") });
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({ redirect: "/profesional" });
    expect(screen.queryByRole("heading", { name: "Portal del Profesional" })).toBeNull();
  });

  test("el índice espera al par pendiente y deriva al portal cuando se resuelve", async () => {
    const { router } = renderAt("/");

    // Par todavía pendiente: muestra carga sin navegar a ningún lado.
    const loading = await screen.findByRole("status");
    expect(loading).toBeDefined();
    expect(router.state.location.pathname).toBe("/");

    act(() => {
      pairMocks.setPair({
        session: sesionPersonal("pro@uct.cl"),
        role: rolDe("professional", "pro@uct.cl"),
      });
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/profesional"));
    const portalHeading = await screen.findByRole("heading", { name: "Portal del Profesional" });
    expect(portalHeading).toBeDefined();
  });

  test("al cambiar de cuenta el portal anterior no aparece con la sesión nueva", async () => {
    pairMocks.setPair({
      session: sesionPersonal("pro@uct.cl"),
      role: rolDe("professional", "pro@uct.cl"),
    });
    const { router } = renderAt("/profesional");

    const portalHeading = await screen.findByRole("heading", { name: "Portal del Profesional" });
    expect(portalHeading).toBeDefined();

    // El cambio de cuenta llega vinculado: sesión y rol nuevos a la vez,
    // así el portal anterior jamás se monta con la sesión nueva.
    act(() => {
      pairMocks.setPair({
        session: sesionPersonal("intern@uct.cl"),
        role: rolDe("intern", "intern@uct.cl"),
      });
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: "Portal del Profesional" })).toBeNull();
  });

  test("un correo de perfil distinto al de la identidad no bloquea el portal", async () => {
    pairMocks.setPair({
      session: sesionPersonal("nuevo@uct.cl"),
      role: rolDe("professional", "viejo@uct.cl"),
    });
    const { router } = renderAt("/profesional");

    // El arranque admite correo y tokenIdentifier independientes: exigir
    // igualdad dejaría "Cargando…" para siempre. El vínculo es la
    // identidad común de la respuesta, no los correos.
    const portalHeading = await screen.findByRole("heading", { name: "Portal del Profesional" });
    expect(portalHeading).toBeDefined();
    expect(router.state.location.pathname).toBe("/profesional");
  });
});
