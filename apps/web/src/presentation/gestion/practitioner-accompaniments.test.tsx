// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_ERROR_MESSAGE } from "../../../../../convex/domain/index.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { AssignedAccompanimentsPage } from "./practitioner-accompaniments-data.ts";

/**
 * Pruebas de la vista de solo lectura del Practicante (TI2-116).
 *
 * Integración por el router real (incluye guards). Las queries de datos se
 * simulan por módulo con un store reactivo: `convex/react` no distingue
 * referencias del `api` generado, así que el cableado real query→referencia
 * lo cubren `tsc`, el build y la verificación manual contra el entorno
 * ficticio de TI2-30. Todos los datos son fixtures ficticios. La
 * autorización efectiva vive en Convex (cubierta por
 * `convex/tests/practitionerMinimization.test.ts`); acá se prueba que la
 * superficie muestra solo lo minimizado y traduce la denegación genérica.
 */

type AccompanimentView = AssignedAccompanimentsPage["items"][number];
type Outcome<T> = T | undefined | Error;

const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    pages: new Map<string, unknown>(),
    details: new Map<string, unknown>(),
    afterCalls: [] as Array<string | undefined>,
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
      this.afterCalls.length = 0;
      listeners.clear();
    },
  };
});

let mockedSession: WebSessionState;
let mockedPair: { session: WebSessionState; role: WebSessionRole } | undefined;

vi.mock("convex/react", () => ({ useQuery: () => mockedSession }));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () => mockedPair,
}));

vi.mock("./practitioner-accompaniments-data.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./practitioner-accompaniments-data.ts")>();
  const { useSyncExternalStore } = await import("react");
  function resolve<T>(outcome: Outcome<T>): T | undefined {
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  }
  return {
    ...original,
    useAssignedAccompaniments: (after: string | undefined) => {
      useSyncExternalStore(store.subscribe, store.getVersion);
      store.afterCalls.push(after);
      return resolve(store.pages.get(after ?? "first") as Outcome<AssignedAccompanimentsPage>);
    },
    useAssignedAccompanimentDetail: (accompanimentId: string) => {
      useSyncExternalStore(store.subscribe, store.getVersion);
      return resolve(store.details.get(accompanimentId) as Outcome<AccompanimentView>);
    },
  };
});

vi.mock("../../infrastructure/auth/auth-client", () => ({
  authClient: { useSession: () => ({ isPending: false }) },
}));

vi.mock("../../infrastructure/convex/convex-client", () => ({
  convexUrl: "https://test.convex.cloud",
  convexSiteUrl: "https://test.convex.site",
  isBackendConfigured: true,
  convexClient: {},
}));

const SESION_PRACTICANTE: WebSessionState = {
  status: "authenticated",
  email: "practicante@uct.cl",
  name: "Practicante Ficticio",
  population: "personal",
};

const PAR_PRACTICANTE = {
  session: SESION_PRACTICANTE,
  role: { status: "authenticated", role: "intern", email: "practicante@uct.cl" },
} as const;

const OBJETIVO_1 = "Objetivo ficticio uno";
const OBJETIVO_2 = "Objetivo ficticio dos";
const NECESIDAD_SENSIBLE = "Necesidad ficticia que no debe verse";

function minimizado(id: string, objective: string): AccompanimentView {
  return {
    _id: id as Id<"accompaniments">,
    status: "active",
    objective,
    view: "minimized",
  };
}

/** Vista completa ficticia: verifica que la superficie no propaga campos fuera de lo minimizado. */
function completo(id: string, objective: string): AccompanimentView {
  return {
    _id: id as Id<"accompaniments">,
    studentId: "stu-ficticio" as Id<"users">,
    status: "paused",
    objective,
    accessNeeds: NECESIDAD_SENSIBLE,
    view: "full",
  };
}

function pagina(
  items: AccompanimentView[],
  hasMore = false,
  lastId: string | null = items.at(-1)?._id ?? null,
): AssignedAccompanimentsPage {
  return { items, hasMore, lastId: lastId as Id<"accompaniments"> | null };
}

const DENEGADO = new ConvexError(UNAUTHORIZED_ERROR_MESSAGE);

function setPage(after: string | undefined, outcome: Outcome<AssignedAccompanimentsPage>) {
  store.pages.set(after ?? "first", outcome);
}

function setDetail(id: string, outcome: Outcome<AccompanimentView>) {
  store.details.set(id, outcome);
}

function update(change: () => void) {
  act(() => {
    change();
    store.notify();
  });
}

function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return { router };
}

beforeEach(() => {
  store.reset();
  mockedSession = SESION_PRACTICANTE;
  mockedPair = PAR_PRACTICANTE;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("listado asignado del Practicante (TI2-116)", () => {
  test("muestra carga mientras el Backend responde", async () => {
    renderAt("/practicante/acompanamientos");

    expect(await screen.findByRole("heading", { name: "Acompañamientos asignados" })).toBeDefined();
    expect(screen.getByRole("status").textContent).toContain("Cargando tus acompañamientos");
  });

  test("renderiza solo estado y objetivo, con enlace al detalle", async () => {
    setPage(undefined, pagina([minimizado("acc-1", OBJETIVO_1), completo("acc-2", OBJETIVO_2)]));
    renderAt("/practicante/acompanamientos");

    const link = await screen.findByRole("link", { name: /Objetivo ficticio uno/ });
    expect(link.getAttribute("href")).toBe("/practicante/acompanamientos/acc-1");
    expect(screen.getByText(OBJETIVO_2)).toBeDefined();
    expect(screen.getByText("Activo")).toBeDefined();
    expect(document.body.textContent).not.toContain(NECESIDAD_SENSIBLE);
    expect(document.body.textContent).not.toContain("stu-ficticio");
    expect(screen.queryByRole("button", { name: /Tomar|Cargar más/ })).toBeNull();
  });

  test("cuenta habilitada sin asignación ve el vacío", async () => {
    setPage(undefined, pagina([]));
    renderAt("/practicante/acompanamientos");

    expect(await screen.findByText("No tienes acompañamientos asignados.")).toBeDefined();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  test("la denegación del Backend se muestra sin filtrar existencia", async () => {
    setPage(undefined, DENEGADO);
    renderAt("/practicante/acompanamientos");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No tienes acceso a acompañamientos asignados.");
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  test("un error técnico ofrece reintento acotado a la sección", async () => {
    setPage(undefined, new Error("fallo técnico ficticio"));
    renderAt("/practicante/acompanamientos");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "No pudimos cargar tus acompañamientos asignados",
    );
    expect(document.body.textContent).not.toContain("fallo técnico ficticio");
    setPage(undefined, pagina([minimizado("acc-1", OBJETIVO_1)]));
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText(OBJETIVO_1)).toBeDefined();
  });

  test("Cargar más pide la página siguiente con el cursor del Backend", async () => {
    setPage(undefined, pagina([minimizado("acc-1", OBJETIVO_1)], true));
    renderAt("/practicante/acompanamientos");

    fireEvent.click(await screen.findByRole("button", { name: "Cargar más" }));
    expect(store.afterCalls).toContain("acc-1");
    expect(screen.getByRole("button", { name: "Cargando…" })).toBeDefined();

    update(() => setPage("acc-1", pagina([minimizado("acc-2", OBJETIVO_2)])));
    expect(await screen.findByText(OBJETIVO_2)).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Cargar/ })).toBeNull();
  });

  test("una revocación reactiva retira la fila del listado", async () => {
    setPage(undefined, pagina([minimizado("acc-1", OBJETIVO_1), minimizado("acc-2", OBJETIVO_2)]));
    renderAt("/practicante/acompanamientos");
    await screen.findByText(OBJETIVO_2);

    update(() => setPage(undefined, pagina([minimizado("acc-1", OBJETIVO_1)])));
    await waitFor(() => expect(screen.queryByText(OBJETIVO_2)).toBeNull());
    expect(screen.getByText(OBJETIVO_1)).toBeDefined();
  });

  test("el Profesional no entra al portal del Practicante", async () => {
    mockedPair = {
      session: SESION_PRACTICANTE,
      role: { status: "authenticated", role: "professional", email: "practicante@uct.cl" },
    };
    setPage(undefined, pagina([minimizado("acc-1", OBJETIVO_1)]));
    const { router } = renderAt("/practicante/acompanamientos");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByText(OBJETIVO_1)).toBeNull();
  });
});

describe("detalle minimizado del Practicante (TI2-116)", () => {
  test("muestra estado y objetivo en solo lectura, sin acciones profesionales", async () => {
    setDetail("acc-1", completo("acc-1", OBJETIVO_1));
    renderAt("/practicante/acompanamientos/acc-1");

    const heading = await screen.findByRole("heading", { name: "Detalle del acompañamiento" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(await screen.findByText(OBJETIVO_1)).toBeDefined();
    expect(screen.getByText("Pausado")).toBeDefined();
    expect(screen.getByText(/Vista de solo lectura/)).toBeDefined();
    expect(document.body.textContent).not.toContain(NECESIDAD_SENSIBLE);
    expect(document.body.textContent).not.toContain("Necesidades de acceso");
    expect(document.body.textContent).not.toContain("stu-ficticio");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(
      screen.getByRole("link", { name: "Volver a acompañamientos" }).getAttribute("href"),
    ).toBe("/practicante/acompanamientos");
  });

  test("otra cuenta o un acompañamiento inexistente reciben la misma denegación", async () => {
    setDetail("acc-ajeno", DENEGADO);
    renderAt("/practicante/acompanamientos/acc-ajeno");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No tienes acceso a este acompañamiento.");
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  test("revocar la asignación con la URL abierta reemplaza el contenido por la denegación", async () => {
    setDetail("acc-1", minimizado("acc-1", OBJETIVO_1));
    renderAt("/practicante/acompanamientos/acc-1");
    await screen.findByText(OBJETIVO_1);

    update(() => setDetail("acc-1", DENEGADO));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "No tienes acceso a este acompañamiento.",
    );
    expect(screen.queryByText(OBJETIVO_1)).toBeNull();
  });
});
