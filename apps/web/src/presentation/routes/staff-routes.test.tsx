// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_ERROR_MESSAGE } from "../../../../../convex/domain/index.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { GENERIC_AUTH_MESSAGES } from "../../application/session/institutional-login.ts";
import type { AssignedAccompanimentsPage } from "../gestion/practitioner-accompaniments-data.ts";
import { createAppRouter } from "./router.tsx";
import type {
  WebSessionAndRole,
  WebSessionRole,
  WebSessionState,
} from "../session/session-state.ts";

/**
 * Cierre de sesión (TI2-133): el encabezado común debe invalidar la sesión
 * real de Better Auth, no navegar a `/login`.
 */
const signOutMock = vi.hoisted(() => vi.fn());

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

/**
 * Respuestas ficticias de las lecturas del Practicante (TI2-116) para probar
 * los permisos de la ruta con asignación vigente, sin asignación y con la
 * asignación revocada. El Backend real decide esas respuestas; aquí solo se
 * fija qué ve la Web cuando la API entrega la vista minimizada o la denegación
 * genérica. Un `Error` guardado se lanza como lo haría la query real.
 */
const assignmentMocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    pages: new Map<string, unknown>(),
    details: new Map<string, unknown>(),
    queries: [] as Array<{ name: string; args: unknown }>,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
    notify: () => {
      version += 1;
      listeners.forEach((listener) => listener());
    },
    reset() {
      this.pages.clear();
      this.details.clear();
      this.queries.length = 0;
      listeners.clear();
    },
  };
});

vi.mock("convex/react", async () => {
  const { useSyncExternalStore } = await import("react");
  const { getFunctionName } = await import("convex/server");
  function resolve<T>(outcome: T | Error | undefined): T | undefined {
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  }
  return {
    useQuery: (
      reference: Parameters<typeof getFunctionName>[0],
      args?: Record<string, unknown>,
    ) => {
      // Las lecturas del Practicante son reactivas: una asignación revocada
      // vuelve a pintar la fila igual que con la suscripción real de Convex.
      useSyncExternalStore(assignmentMocks.subscribe, assignmentMocks.getVersion);
      const name = getFunctionName(reference);
      if (name === "presentation/accompaniments:listAssignedAccompaniments") {
        assignmentMocks.queries.push({ name, args });
        const after = (args?.after as string | undefined) ?? "first";
        return resolve(
          assignmentMocks.pages.get(after) as AssignedAccompanimentsPage | Error | undefined,
        );
      }
      if (name === "presentation/accompaniments:getAccompaniment") {
        assignmentMocks.queries.push({ name, args });
        return resolve(
          assignmentMocks.details.get(args?.accompanimentId as string) as
            | AssignedAccompanimentsPage["items"][number]
            | Error
            | undefined,
        );
      }
      return sessionMocks.getSession();
    },
  };
});

vi.mock("../session/session-state", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSessionState: () => useSyncExternalStore(sessionMocks.subscribe, sessionMocks.getSession),
    useSessionAndRole: () => useSyncExternalStore(sessionMocks.subscribe, sessionMocks.getPair),
  };
});

vi.mock("../../infrastructure/auth/auth-client", () => ({
  authClient: { useSession: () => ({ isPending: false }), signOut: signOutMock },
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
  assignmentMocks.reset();
  signOutMock.mockReset();
  signOutMock.mockResolvedValue({ data: {}, error: null });
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
  return (
    [...document.querySelectorAll("a")]
      .map((anchor) => anchor.getAttribute("href") ?? "")
      // El enlace de salto apunta al contenido de la misma página, no a un
      // portal: no forma parte de los límites de navegación por rol.
      .filter((href) => href.length > 0 && !href.startsWith("#"))
  );
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

describe("encabezado común y cierre de sesión (TI2-133)", () => {
  test.each(PORTALES)(
    "$nombre marca la portada actual y no ofrece un enlace de sesión",
    async (portal) => {
      sessionMocks.setPair({
        session: sesionPersonal(`${portal.rol}@uct.cl`),
        role: rolDe(portal.rol, `${portal.rol}@uct.cl`),
      });
      renderAt(portal.ruta);

      await screen.findByRole("heading", { name: portal.titulo });
      const nav = screen.getByRole("navigation", { name: portal.titulo });
      expect(within(nav).getByRole("link", { name: "Inicio" }).getAttribute("aria-current")).toBe(
        "page",
      );
      expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeDefined();
      expect(screen.queryByRole("link", { name: "Sesión" })).toBeNull();
      expect(portalHrefs()).not.toContain("/login");
    },
  );

  test("Cerrar sesión invalida la sesión de Better Auth y vuelve al índice", async () => {
    sessionMocks.setPair({
      session: sesionPersonal("pro@uct.cl"),
      role: rolDe("professional", "pro@uct.cl"),
    });
    // Better Auth retira la sesión al cerrarla; se simula esa transición para
    // comprobar que el índice ya no deriva de vuelta al portal.
    signOutMock.mockImplementation(async () => {
      act(() => {
        sessionMocks.setSession(SIN_SESION);
        sessionMocks.setPair({ session: SIN_SESION, role: ROL_DESCONOCIDO });
      });
      return { data: {}, error: null };
    });
    const { router } = renderAt("/profesional");

    const logout = await screen.findByRole("button", { name: "Cerrar sesión" });
    fireEvent.click(logout);

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Portal del Profesional" })).toBeNull();
  });

  test("si el cierre falla, avisa sin navegar ni abandonar el portal", async () => {
    sessionMocks.setPair({
      session: sesionPersonal("pro@uct.cl"),
      role: rolDe("professional", "pro@uct.cl"),
    });
    signOutMock.mockResolvedValue({ data: null, error: { status: 500, message: "fallo" } });
    const { router } = renderAt("/profesional");

    const logout = await screen.findByRole("button", { name: "Cerrar sesión" });
    fireEvent.click(logout);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(GENERIC_AUTH_MESSAGES.signOutError);
    expect(router.state.location.pathname).toBe("/profesional");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeDefined();
  });
});

describe("límites de navegación por rol (TI2-20)", () => {
  test("el Practicante enlaza solo su listado asignado, no acompañamientos concretos", async () => {
    sessionMocks.setPair({
      session: sesionPersonal("intern@uct.cl"),
      role: rolDe("intern", "intern@uct.cl"),
    });
    renderAt("/practicante");

    await screen.findByRole("heading", { name: "Portal del Practicante" });
    const hrefs = portalHrefs();
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(["/practicante", "/practicante/acompanamientos"]).toContain(href);
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
      expect(href === "/administrador" || href === "/administrador/espacios").toBe(true);
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

type AccompanimentView = AssignedAccompanimentsPage["items"][number];

const OBJETIVO_ASIGNADO = "Acompañar a la biblioteca.";
const NECESIDAD_SENSIBLE = "Necesidad ficticia que no debe verse.";
const DENEGACIÓN = new ConvexError(UNAUTHORIZED_ERROR_MESSAGE);

/** Vista minimizada tal como la entrega el Backend con asignación vigente. */
function asignado(id: string, objective: string): AccompanimentView {
  return { _id: id as Id<"accompaniments">, status: "active", objective, view: "minimized" };
}

/** Vista completa ficticia: la superficie no debe propagar sus campos. */
function vistaCompleta(id: string, objective: string): AccompanimentView {
  return {
    _id: id as Id<"accompaniments">,
    studentId: "estudiante-ficticio" as Id<"users">,
    status: "paused",
    objective,
    accessNeeds: NECESIDAD_SENSIBLE,
    view: "full",
  };
}

function paginaAsignada(items: AccompanimentView[]): AssignedAccompanimentsPage {
  return { items, hasMore: false, lastId: items.at(-1)?._id ?? null };
}

function comoPracticante() {
  sessionMocks.setPair({
    session: sesionPersonal("intern@uct.cl"),
    role: rolDe("intern", "intern@uct.cl"),
  });
}

function revocarAsignacion() {
  act(() => {
    assignmentMocks.pages.set("first", paginaAsignada([]));
    assignmentMocks.notify();
  });
}

const OTRA_CUENTA_PRACTICANTE = "intern2@uct.cl";
const OBJETIVO_OTRA_CUENTA = "Acompañar al laboratorio de idiomas.";

/**
 * Registra todo nodo insertado en el DOM que contenga el texto o el enlace
 * indicados. Las mutaciones conservan los nodos añadidos aunque se retiren
 * en el mismo ciclo, así un parpadeo intermedio también queda registrado.
 */
function vigilarInserciones(texto: string, href?: string) {
  const vistos: string[] = [];
  const revisar = (registros: MutationRecord[]) => {
    for (const registro of registros) {
      for (const nodo of registro.addedNodes) {
        const conTexto = nodo.textContent?.includes(texto) ?? false;
        const conEnlace =
          href !== undefined &&
          nodo instanceof Element &&
          (nodo.matches(`a[href="${href}"]`) || nodo.querySelector(`a[href="${href}"]`) !== null);
        if (conTexto || conEnlace) {
          vistos.push(nodo.textContent ?? "");
        }
      }
    }
  };
  const observer = new MutationObserver(revisar);
  observer.observe(document.body, { childList: true, subtree: true });
  return {
    detener() {
      revisar(observer.takeRecords());
      observer.disconnect();
      return vistos;
    },
  };
}

/**
 * Cambio a otra cuenta del mismo rol en dos tiempos, como llega desde
 * Convex: primero la sesión nueva con el par anterior (revalidación en
 * curso) mientras la consulta conserva la respuesta de la cuenta anterior, y
 * luego el par confirmado con la consulta de la cuenta nueva aún pendiente.
 */
function cambiarAOtraCuentaPracticante(consultaPendiente: () => void) {
  act(() => {
    sessionMocks.setSession(sesionPersonal(OTRA_CUENTA_PRACTICANTE));
  });
  expect(screen.queryByText(OBJETIVO_ASIGNADO)).toBeNull();
  expect(screen.getByText("Cargando…")).toBeDefined();

  act(() => {
    consultaPendiente();
    sessionMocks.setPair({
      session: sesionPersonal(OTRA_CUENTA_PRACTICANTE),
      role: rolDe("intern", OTRA_CUENTA_PRACTICANTE),
    });
  });
}

describe("asignaciones del Practicante en la Web (TI2-126)", () => {
  test("con asignación vigente ve el listado minimizado y su detalle en solo lectura", async () => {
    const item = asignado("acompanamiento-ficticio-1", OBJETIVO_ASIGNADO);
    assignmentMocks.pages.set("first", paginaAsignada([item]));
    assignmentMocks.details.set(item._id, item);
    comoPracticante();

    renderAt("/practicante/acompanamientos");

    expect(await screen.findByRole("heading", { name: "Acompañamientos asignados" })).toBeDefined();
    const fila = await screen.findByRole("link", { name: new RegExp(OBJETIVO_ASIGNADO) });
    expect(fila.getAttribute("href")).toBe(`/practicante/acompanamientos/${item._id}`);
    expect(screen.getByText("Activo")).toBeDefined();
    // La primera página se pide con el cursor vacío y el tope de la vista.
    expect(assignmentMocks.queries[0]).toEqual({
      name: "presentation/accompaniments:listAssignedAccompaniments",
      args: { limit: 10, after: undefined },
    });

    cleanup();
    renderAt(`/practicante/acompanamientos/${item._id}`);

    expect(
      await screen.findByRole("heading", { name: "Detalle del acompañamiento" }),
    ).toBeDefined();
    expect(screen.getByText(OBJETIVO_ASIGNADO)).toBeDefined();
    expect(screen.getByText(/Vista de solo lectura/)).toBeDefined();
  });

  test("una vista completa del Backend se muestra solo con estado y objetivo", async () => {
    const item = vistaCompleta("acompanamiento-ficticio-2", OBJETIVO_ASIGNADO);
    assignmentMocks.pages.set("first", paginaAsignada([item]));
    assignmentMocks.details.set(item._id, item);
    comoPracticante();

    renderAt(`/practicante/acompanamientos/${item._id}`);

    expect(await screen.findByText(OBJETIVO_ASIGNADO)).toBeDefined();
    expect(screen.getByText("Pausado")).toBeDefined();
    expect(screen.queryByText(/estudiante-ficticio/)).toBeNull();
    expect(screen.queryByText(new RegExp(NECESIDAD_SENSIBLE))).toBeNull();
    // Sin acciones profesionales: el Practicante no hereda permisos.
    for (const acción of ["Tomar", "Registrar", "Cancelar", "Notas internas"]) {
      expect(screen.queryByRole("button", { name: acción })).toBeNull();
    }
  });

  test("sin asignación vigente ve el vacío y ninguna fila", async () => {
    assignmentMocks.pages.set("first", paginaAsignada([]));
    comoPracticante();

    renderAt("/practicante/acompanamientos");

    expect(await screen.findByText("No tienes acompañamientos asignados.")).toBeDefined();
    expect(screen.queryByRole("link", { name: /Ver detalle/ })).toBeNull();
  });

  test("una asignación revocada retira la fila sin dejar datos en pantalla", async () => {
    const item = asignado("acompanamiento-ficticio-3", OBJETIVO_ASIGNADO);
    assignmentMocks.pages.set("first", paginaAsignada([item]));
    comoPracticante();

    renderAt("/practicante/acompanamientos");

    expect(await screen.findByText(OBJETIVO_ASIGNADO)).toBeDefined();

    revocarAsignacion();

    expect(await screen.findByText("No tienes acompañamientos asignados.")).toBeDefined();
    expect(screen.queryByText(OBJETIVO_ASIGNADO)).toBeNull();
  });

  test("con la asignación revocada el detalle responde denegación genérica sin filtrar existencia", async () => {
    const item = asignado("acompanamiento-ficticio-4", OBJETIVO_ASIGNADO);
    assignmentMocks.details.set(item._id, DENEGACIÓN);
    comoPracticante();

    const { router } = renderAt(`/practicante/acompanamientos/${item._id}`);

    expect(await screen.findByText("No tienes acceso a este acompañamiento.")).toBeDefined();
    expect(router.state.location.pathname).toBe(`/practicante/acompanamientos/${item._id}`);
    expect(screen.queryByText(OBJETIVO_ASIGNADO)).toBeNull();
    expect(screen.queryByText(new RegExp(item._id))).toBeNull();
  });

  test("la denegación del listado retira filas e identificadores ya pintados", async () => {
    const item = asignado("acompanamiento-ficticio-5", OBJETIVO_ASIGNADO);
    assignmentMocks.pages.set("first", paginaAsignada([item]));
    comoPracticante();

    renderAt("/practicante/acompanamientos");

    expect(await screen.findByText(OBJETIVO_ASIGNADO)).toBeDefined();

    act(() => {
      assignmentMocks.pages.set("first", DENEGACIÓN);
      assignmentMocks.notify();
    });

    expect(await screen.findByText("No tienes acceso a acompañamientos asignados.")).toBeDefined();
    expect(screen.queryByText(OBJETIVO_ASIGNADO)).toBeNull();
    expect(screen.queryByText(/acompanamiento-ficticio/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Ver detalle/ })).toBeNull();
  });

  test("al cambiar a otra cuenta Practicante el acompañamiento anterior no reaparece en el listado", async () => {
    const anterior = asignado("acompanamiento-cuenta-anterior", OBJETIVO_ASIGNADO);
    const nuevo = asignado("acompanamiento-cuenta-nueva", OBJETIVO_OTRA_CUENTA);
    const enlaceAnterior = `/practicante/acompanamientos/${anterior._id}`;
    assignmentMocks.pages.set("first", paginaAsignada([anterior]));
    comoPracticante();

    renderAt("/practicante/acompanamientos");

    const fila = await screen.findByRole("link", { name: new RegExp(OBJETIVO_ASIGNADO) });
    expect(fila.getAttribute("href")).toBe(enlaceAnterior);
    const vigilancia = vigilarInserciones(OBJETIVO_ASIGNADO, enlaceAnterior);

    cambiarAOtraCuentaPracticante(() => assignmentMocks.pages.delete("first"));

    expect(await screen.findByText("Cargando tus acompañamientos…")).toBeDefined();
    expect(screen.queryByText(OBJETIVO_ASIGNADO)).toBeNull();
    expect(document.querySelector(`a[href="${enlaceAnterior}"]`)).toBeNull();

    act(() => {
      assignmentMocks.pages.set("first", paginaAsignada([nuevo]));
      assignmentMocks.notify();
    });

    const filaNueva = await screen.findByRole("link", { name: new RegExp(OBJETIVO_OTRA_CUENTA) });
    expect(filaNueva.getAttribute("href")).toBe(`/practicante/acompanamientos/${nuevo._id}`);
    expect(screen.queryByText(OBJETIVO_ASIGNADO)).toBeNull();
    expect(document.querySelector(`a[href="${enlaceAnterior}"]`)).toBeNull();
    expect(vigilancia.detener()).toEqual([]);
  });

  test("al cambiar a otra cuenta Practicante el detalle anterior no reaparece y la nueva cuenta recibe denegación genérica", async () => {
    const anterior = asignado("acompanamiento-cuenta-anterior", OBJETIVO_ASIGNADO);
    assignmentMocks.details.set(anterior._id, anterior);
    comoPracticante();

    renderAt(`/practicante/acompanamientos/${anterior._id}`);

    expect(await screen.findByText(OBJETIVO_ASIGNADO)).toBeDefined();
    const vigilancia = vigilarInserciones(OBJETIVO_ASIGNADO);

    cambiarAOtraCuentaPracticante(() => assignmentMocks.details.delete(anterior._id));

    expect(await screen.findByText("Cargando el detalle…")).toBeDefined();
    expect(screen.queryByText(OBJETIVO_ASIGNADO)).toBeNull();

    act(() => {
      assignmentMocks.details.set(anterior._id, DENEGACIÓN);
      assignmentMocks.notify();
    });

    expect(await screen.findByText("No tienes acceso a este acompañamiento.")).toBeDefined();
    expect(screen.queryByText(OBJETIVO_ASIGNADO)).toBeNull();
    expect(screen.queryByText(new RegExp(anterior._id))).toBeNull();
    expect(vigilancia.detener()).toEqual([]);
  });
});

describe("el Administrador no hereda la vista del Practicante (TI2-126)", () => {
  test.each(["/practicante/acompanamientos", "/practicante/acompanamientos/acompanamiento-ajeno"])(
    "%s va a denegado sin consultar las lecturas del Practicante",
    async (ruta) => {
      assignmentMocks.pages.set("first", paginaAsignada([asignado("ajeno", OBJETIVO_ASIGNADO)]));
      assignmentMocks.details.set("acompanamiento-ajeno", asignado("ajeno", OBJETIVO_ASIGNADO));
      sessionMocks.setPair({
        session: sesionPersonal("admin@uct.cl"),
        role: rolDe("admin", "admin@uct.cl"),
      });

      const { router } = renderAt(ruta);

      await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
      expect(await screen.findByRole("heading", { name: "Acceso denegado" })).toBeDefined();
      expect(assignmentMocks.queries).toEqual([]);
      expect(screen.queryByText(OBJETIVO_ASIGNADO)).toBeNull();
    },
  );
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
