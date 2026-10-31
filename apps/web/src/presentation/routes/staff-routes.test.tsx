// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "./router.tsx";
import type {
  WebSessionAndRole,
  WebSessionRole,
  WebSessionState,
} from "../session/session-state.ts";

/**
 * Stores reactivos de sesión y par (TI2-20): dos suscripciones
 * independientes como en producción (`getSessionState` y
 * `getSessionWithRole` se actualizan por separado). Sin valor propio, la
 * sesión refleja el par (flujo normal); los tests de desfase fijan ambos
 * por separado. `set*` notifica dentro de `act` en cada prueba.
 */
const sessionMocks = vi.hoisted(() => {
  let session: WebSessionState = undefined;
  let pair: WebSessionAndRole = undefined;
  let backendConfigured = true;
  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((listener) => listener());
  }

  return {
    getSession: () => session ?? pair?.session,
    getPair: () => pair,
    isBackendConfigured: () => backendConfigured,
    setSession: (next: WebSessionState) => {
      session = next;
      notify();
    },
    setPair: (next: WebSessionAndRole) => {
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
      session = undefined;
      pair = undefined;
      backendConfigured = true;
      listeners.clear();
    },
  };
});

vi.mock("convex/react", () => ({ useQuery: () => sessionMocks.getSession() }));

vi.mock("../session/session-state", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSessionState: () => useSyncExternalStore(sessionMocks.subscribe, sessionMocks.getSession),
    useSessionAndRole: () => useSyncExternalStore(sessionMocks.subscribe, sessionMocks.getPair),
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

type SesionFija = Exclude<WebSessionState, undefined>;
type RolFijo = Exclude<WebSessionRole, undefined>;

const SIN_SESION: SesionFija = { status: "unauthenticated" };
const ROL_DESCONOCIDO: RolFijo = { status: "unauthenticated" };

function sesionPersonal(email: string): SesionFija {
  return { status: "authenticated", email, name: "Personal Ficticio", population: "personal" };
}

function rolDe(role: "professional" | "intern" | "admin" | "student", email: string): RolFijo {
  return { status: "authenticated", role, email };
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
    sessionMocks.setPair({ session: SIN_SESION, role: ROL_DESCONOCIDO });
    const { router } = renderAt(portal.ruta);

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({ redirect: portal.ruta });
    const accessHeading = await screen.findByRole("heading", { name: "Acceso institucional" });
    expect(accessHeading).toBeDefined();
    expect(screen.queryByRole("heading", { name: portal.titulo })).toBeNull();
  });

  test("sin sesión confirmada navega al acceso aunque el par siga pendiente", async () => {
    sessionMocks.setSession(SIN_SESION);
    const { router } = renderAt(portal.ruta);

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({ redirect: portal.ruta });
    expect(screen.queryByRole("heading", { name: portal.titulo })).toBeNull();
  });

  test.each(portal.ajenos)("el rol %s ve denegado sin contenido del portal", async (rolAjeno) => {
    const emailAjeno = rolAjeno === "student" ? "estudiante@alu.uct.cl" : `${rolAjeno}@uct.cl`;
    sessionMocks.setPair({
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
    sessionMocks.setPair({ session: sesionPersonal("fantasma@uct.cl"), role: ROL_DESCONOCIDO });
    const { router } = renderAt(portal.ruta);

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: portal.titulo })).toBeNull();
  });

  test("el rol permitido ve su portal sin redirigir", async () => {
    sessionMocks.setPair({
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
    sessionMocks.setPair({
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
    sessionMocks.setPair({
      session: sesionPersonal("admin@uct.cl"),
      role: rolDe("admin", "admin@uct.cl"),
    });
    renderAt("/administrador");

    await screen.findByRole("heading", { name: "Portal de Administración" });
    const hrefs = portalHrefs();
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(
        href === "/administrador" || href === "/administrador/espacios" || href === "/login",
      ).toBe(true);
    }
    // El editor de espacios (TI2-04) es la vista propia del Administrador.
    expect(hrefs).toContain("/administrador/espacios");
  });

  test("el Profesional no entra al portal del Estudiante", async () => {
    sessionMocks.setPair({
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
    sessionMocks.setPair({
      session: sesionPersonal(`${rol}@uct.cl`),
      role: rolDe(rol, `${rol}@uct.cl`),
    });
    const { router } = renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe(destino));
  });

  test("el índice sin rol conocido deriva a denegado", async () => {
    sessionMocks.setPair({ session: sesionPersonal("fantasma@uct.cl"), role: ROL_DESCONOCIDO });
    const { router } = renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
  });

  test("el acceso con retorno navega ahí para cualquier población", async () => {
    sessionMocks.setPair({
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
    sessionMocks.setPair({
      session: sesionPersonal("pro@uct.cl"),
      role: rolDe("professional", "pro@uct.cl"),
    });
    const { router } = renderAt("/profesional");

    const portalHeading = await screen.findByRole("heading", { name: "Portal del Profesional" });
    expect(portalHeading).toBeDefined();

    // La sesión cae pero el par conserva el rol anterior: el portal debe
    // ocultarse desde el primer render sin sesión.
    act(() => {
      sessionMocks.setPair({ session: SIN_SESION, role: rolDe("professional", "pro@uct.cl") });
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
      sessionMocks.setPair({
        session: sesionPersonal("pro@uct.cl"),
        role: rolDe("professional", "pro@uct.cl"),
      });
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/profesional"));
    const portalHeading = await screen.findByRole("heading", { name: "Portal del Profesional" });
    expect(portalHeading).toBeDefined();
  });

  test("al cambiar de cuenta el portal anterior no aparece con la sesión nueva", async () => {
    sessionMocks.setPair({
      session: sesionPersonal("pro@uct.cl"),
      role: rolDe("professional", "pro@uct.cl"),
    });
    const { router } = renderAt("/profesional");

    const portalHeading = await screen.findByRole("heading", { name: "Portal del Profesional" });
    expect(portalHeading).toBeDefined();

    // El cambio de cuenta llega vinculado: sesión y rol nuevos a la vez,
    // así el portal anterior jamás se monta con la sesión nueva.
    act(() => {
      sessionMocks.setPair({
        session: sesionPersonal("intern@uct.cl"),
        role: rolDe("intern", "intern@uct.cl"),
      });
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: "Portal del Profesional" })).toBeNull();
  });

  test("un correo de perfil distinto al de la identidad no bloquea el portal", async () => {
    sessionMocks.setPair({
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

  test("con el par desfasado tras un cambio de cuenta no renderiza ni navega", async () => {
    sessionMocks.setPair({
      session: sesionPersonal("pro@uct.cl"),
      role: rolDe("professional", "pro@uct.cl"),
    });
    const { router } = renderAt("/profesional");

    const portalHeading = await screen.findByRole("heading", { name: "Portal del Profesional" });
    expect(portalHeading).toBeDefined();

    // La suscripción de sesión ya trae la cuenta nueva pero el par aún no
    // se actualiza: sin confirmación no se muestra el portal anterior ni
    // se navega con datos desfasados.
    act(() => {
      sessionMocks.setSession(sesionPersonal("intern@uct.cl"));
    });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Portal del Profesional" })).toBeNull();
    });
    expect(router.state.location.pathname).toBe("/profesional");

    // Al confirmarse el par vigente deriva a denegado sin haber expuesto nada.
    act(() => {
      sessionMocks.setPair({
        session: sesionPersonal("intern@uct.cl"),
        role: rolDe("intern", "intern@uct.cl"),
      });
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: "Portal del Profesional" })).toBeNull();
  });
});

// TI2-126: permisos de gestión del Practicante y del Administrador. El guard
// solo elige portal; la denegación efectiva de datos vive en Convex (matriz
// `convex/domain/authorization/permissions.ts`). Estas pruebas fijan lo que la
// Web puede garantizar sin duplicar la autorización del Backend.
const PORTALES_CON_PERMISOS = [
  {
    nombre: "Practicante",
    ruta: "/practicante",
    titulo: "Portal del Practicante",
    rol: "intern" as const,
  },
  {
    nombre: "Administración",
    ruta: "/administrador",
    titulo: "Portal de Administración",
    rol: "admin" as const,
  },
] as const;

const RUTAS_DEL_PROFESIONAL = [
  "/profesional/solicitudes",
  "/profesional/solicitudes/req-1",
  "/profesional/disponibilidad",
  "/profesional/agenda",
  "/profesional/agenda/aten-1",
] as const;

const ENCABEZADOS_PROFESIONAL = [
  "Solicitudes",
  "Detalle de la solicitud",
  "Disponibilidad",
  "Agenda",
  "Detalle de la atención",
] as const;

describe.each(PORTALES_CON_PERMISOS)(
  "$nombre: sesión expirada y cambio de cuenta (TI2-126)",
  ({ ruta, titulo, rol }) => {
    function comoRolPermitido() {
      sessionMocks.setPair({
        session: sesionPersonal(`${rol}@uct.cl`),
        role: rolDe(rol, `${rol}@uct.cl`),
      });
    }

    test("la sesión expirada oculta el portal y vuelve al acceso conservando el retorno", async () => {
      comoRolPermitido();
      const { router } = renderAt(ruta);

      expect(await screen.findByRole("heading", { name: titulo })).toBeDefined();

      // El token vence: la sesión pasa a no autenticada antes que el par, que
      // todavía conserva el rol anterior. El portal no debe seguir visible.
      act(() => {
        sessionMocks.setPair({
          session: SIN_SESION,
          role: rolDe(rol, `${rol}@uct.cl`),
        });
      });

      await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
      expect(router.state.location.search).toMatchObject({ redirect: ruta });
      expect(screen.queryByRole("heading", { name: titulo })).toBeNull();
    });

    test("el cambio de cuenta no expone el portal del rol anterior", async () => {
      comoRolPermitido();
      const { router } = renderAt(ruta);

      expect(await screen.findByRole("heading", { name: titulo })).toBeDefined();

      const otroRol = rol === "intern" ? "admin" : "intern";
      const otroEmail = `${otroRol}@uct.cl`;
      act(() => {
        sessionMocks.setPair({
          session: sesionPersonal(otroEmail),
          role: rolDe(otroRol, otroEmail),
        });
      });

      await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
      expect(await screen.findByRole("heading", { name: "Acceso denegado" })).toBeDefined();
      expect(screen.queryByRole("heading", { name: titulo })).toBeNull();
    });
  },
);

describe.each([
  ["Practicante", "intern", "intern@uct.cl"],
  ["Administración", "admin", "admin@uct.cl"],
] as const)("%s no abre rutas de gestión del Profesional (TI2-126)", (_nombre, rol, email) => {
  test.each(RUTAS_DEL_PROFESIONAL)("%s va a denegado sin contenido", async (ruta) => {
    sessionMocks.setPair({ session: sesionPersonal(email), role: rolDe(rol, email) });
    const { router } = renderAt(ruta);

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(await screen.findByRole("heading", { name: "Acceso denegado" })).toBeDefined();
    for (const tituloProfesional of ENCABEZADOS_PROFESIONAL) {
      expect(screen.queryByRole("heading", { name: tituloProfesional })).toBeNull();
    }
  });
});

describe("Practicante sin asignación o con asignación revocada (TI2-126)", () => {
  // La vista minimizada del Practicante es TI2-116 y todavía no existe. Hasta
  // entonces la Web solo puede garantizar que no expone datos: el Backend es
  // quien devuelve `minimized` con asignación activa y deniega sin asignación
  // o con la asignación revocada (TI2-5). Esta prueba documenta ese contraste
  // y evita prometer una pantalla que aún no filtra nada.
  test("la portada no expone acompañamientos ni datos de la asignación", async () => {
    sessionMocks.setPair({
      session: sesionPersonal("intern@uct.cl"),
      role: rolDe("intern", "intern@uct.cl"),
    });
    renderAt("/practicante");

    expect(await screen.findByRole("heading", { name: "Portal del Practicante" })).toBeDefined();
    expect(
      screen.getByText("Tus acompañamientos asignados estarán disponibles aquí."),
    ).toBeDefined();

    const hrefs = portalHrefs();
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href === "/practicante" || href === "/login").toBe(true);
    }
    const textos = [...document.querySelectorAll("a")].map((anchor) =>
      (anchor.textContent ?? "").toLowerCase(),
    );
    expect(textos.some((texto) => texto.includes("acompañamiento"))).toBe(false);
    expect(textos.some((texto) => texto.includes("nota"))).toBe(false);
  });

  test("la ruta de acompañamientos del Practicante no existe y no filtra el identificador", async () => {
    sessionMocks.setPair({
      session: sesionPersonal("intern@uct.cl"),
      role: rolDe("intern", "intern@uct.cl"),
    });
    const { router } = renderAt("/practicante/acompanamientos/acompanamiento-ajeno");

    // Sin vista entregada, la ruta desconocida vuelve al índice y el índice
    // deriva al portal del rol: no hay lectura ni eco del identificador.
    await waitFor(() => expect(router.state.location.pathname).toBe("/practicante"));
    expect(await screen.findByRole("heading", { name: "Portal del Practicante" })).toBeDefined();
    expect(screen.queryByText(/acompanamiento-ajeno/)).toBeNull();
  });
});

describe("Administrador sin acceso a acompañamientos ni notas internas (TI2-126)", () => {
  test("la portada no enlaza acompañamientos ni notas internas", async () => {
    sessionMocks.setPair({
      session: sesionPersonal("admin@uct.cl"),
      role: rolDe("admin", "admin@uct.cl"),
    });
    renderAt("/administrador");

    expect(await screen.findByRole("heading", { name: "Portal de Administración" })).toBeDefined();
    const textos = [...document.querySelectorAll("a")].map((anchor) =>
      (anchor.textContent ?? "").toLowerCase(),
    );
    expect(textos.some((texto) => texto.includes("acompañamiento"))).toBe(false);
    expect(textos.some((texto) => texto.includes("nota"))).toBe(false);
    expect(textos.some((texto) => texto.includes("solicitud"))).toBe(false);
  });
});

describe("par inconsistente rol staff y correo estudiante (TI2-20)", () => {
  const SESION_ESTUDIANTE: SesionFija = {
    status: "authenticated",
    email: "estudiante@alu.uct.cl",
    name: "Estudiante Ficticio",
    population: "estudiante",
  };

  test("el índice deriva por rol aunque la población difiera", async () => {
    sessionMocks.setSession(SESION_ESTUDIANTE);
    sessionMocks.setPair({
      session: SESION_ESTUDIANTE,
      role: rolDe("professional", "estudiante@alu.uct.cl"),
    });
    const { router } = renderAt("/");

    await waitFor(() => expect(router.state.location.pathname).toBe("/profesional"));
    const portalHeading = await screen.findByRole("heading", { name: "Portal del Profesional" });
    expect(portalHeading).toBeDefined();
  });

  test("el acceso directo a /estudiante deniega el rol staff sin exponer contenido", async () => {
    sessionMocks.setSession(SESION_ESTUDIANTE);
    sessionMocks.setPair({
      session: SESION_ESTUDIANTE,
      role: rolDe("professional", "estudiante@alu.uct.cl"),
    });
    const { router } = renderAt("/estudiante");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: "Portal del Estudiante" })).toBeNull();
  });
});

// Viven acá y no en `student-routes` porque este simulador separa sesión y
// rol y reacciona a sus cambios; aquel deriva el rol de la población.
describe("portal del Estudiante con sesión y rol independientes (TI2-12)", () => {
  function sesionEstudiante(email: string): SesionFija {
    return {
      status: "authenticated",
      email,
      name: "Estudiante Ficticio",
      population: "estudiante",
    };
  }

  test("la sesión pendiente se restaura en el portal sin pasar por el acceso", async () => {
    const router = createAppRouter({
      history: createMemoryHistory({ initialEntries: ["/estudiante"] }),
    });
    const rutas: Array<string> = [];
    router.subscribe("onBeforeNavigate", (evento) => rutas.push(evento.toLocation.pathname));
    render(<RouterProvider router={router} />);

    const loading = await screen.findByRole("status");
    expect(loading).toBeDefined();
    expect(router.state.location.pathname).toBe("/estudiante");

    act(() => {
      sessionMocks.setPair({
        session: sesionEstudiante("estudiante@alu.uct.cl"),
        role: rolDe("student", "estudiante@alu.uct.cl"),
      });
    });

    const portalHeading = await screen.findByRole("heading", { name: "Portal del Estudiante" });
    expect(portalHeading).toBeDefined();
    expect(router.state.location.pathname).toBe("/estudiante");
    expect(rutas).not.toContain("/login");
  });

  test("la sesión que se pierde con el portal abierto lo oculta y vuelve al acceso", async () => {
    sessionMocks.setPair({
      session: sesionEstudiante("estudiante@alu.uct.cl"),
      role: rolDe("student", "estudiante@alu.uct.cl"),
    });
    const { router } = renderAt("/estudiante");

    const portalHeading = await screen.findByRole("heading", { name: "Portal del Estudiante" });
    expect(portalHeading).toBeDefined();

    act(() => {
      sessionMocks.setPair({
        session: SIN_SESION,
        role: rolDe("student", "estudiante@alu.uct.cl"),
      });
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({ redirect: "/estudiante" });
    expect(screen.queryByRole("heading", { name: "Portal del Estudiante" })).toBeNull();
  });

  test("el Practicante con correo de estudiante ve denegado sin contenido del portal", async () => {
    sessionMocks.setPair({
      session: sesionEstudiante("practicante@alu.uct.cl"),
      role: rolDe("intern", "practicante@alu.uct.cl"),
    });
    const { router } = renderAt("/estudiante");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    const deniedHeading = await screen.findByRole("heading", { name: "Acceso denegado" });
    expect(deniedHeading).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Portal del Estudiante" })).toBeNull();
  });

  // Fija la decisión de TI2-6 y no la amplía: la portada no lee datos, y el
  // Backend deniega el perfil propio a una cuenta sin fila en `sprint1Queries`.
  test("la cuenta de estudiante sin perfil entra por población", async () => {
    sessionMocks.setPair({
      session: sesionEstudiante("nueva@alu.uct.cl"),
      role: ROL_DESCONOCIDO,
    });
    const { router } = renderAt("/estudiante");

    const portalHeading = await screen.findByRole("heading", { name: "Portal del Estudiante" });
    expect(portalHeading).toBeDefined();
    expect(router.state.location.pathname).toBe("/estudiante");
  });
});
