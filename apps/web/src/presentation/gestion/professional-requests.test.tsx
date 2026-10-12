// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type {
  AuthorizedRequestsPage,
  OpenRequestsPage,
  RequestDetail,
} from "./professional-requests-data.ts";
import { usePagedList } from "./paged-requests.ts";
import { PagedItems } from "./professional-requests.tsx";

/**
 * Pruebas de bandeja y detalle del Profesional (TI2-91).
 *
 * Integración por el router real (incluye guards): la sesión simulada es de
 * Profesional con toma, salvo los casos de denegación. Las queries de datos
 * se mockean por módulo porque `convex/react` no distingue referencias del
 * `api` generado (crea un objeto nuevo por acceso); el cableado real
 * query→referencia lo cubren `tsc`, el build y la verificación manual contra
 * el entorno ficticio de TI2-30. Todos los datos son ficticios.
 */

let mockedSession: WebSessionState;
let mockedPair:
  | {
      session: WebSessionState;
      role: WebSessionRole;
    }
  | undefined;
let mockedBackendConfigured = true;

let mockedOpen: OpenRequestsPage | undefined;
let openByCursor: ((cursor: string | null) => OpenRequestsPage | undefined) | null = null;
let mockedAuthorized: AuthorizedRequestsPage | undefined;
let authorizedByCursor: ((cursor: string | null) => AuthorizedRequestsPage | undefined) | null =
  null;
let mockedDetail: RequestDetail | undefined;
let detailThrows: Error | null = null;

vi.mock("convex/react", () => ({ useQuery: () => mockedSession }));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () => mockedPair,
}));

vi.mock("./professional-requests-data.ts", () => ({
  useOpenRequests: (cursor: string | null) =>
    openByCursor === null ? mockedOpen : openByCursor(cursor),
  useAuthorizedRequests: (cursor: string | null) =>
    authorizedByCursor === null ? mockedAuthorized : authorizedByCursor(cursor),
  useRequestDetail: () => {
    if (detailThrows !== null) {
      throw detailThrows;
    }
    return mockedDetail;
  },
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

const SESION_PRO: WebSessionState = {
  status: "authenticated",
  email: "pro@uct.cl",
  name: "Profesional Ficticio",
  population: "personal",
};

const PAR_PRO: { session: WebSessionState; role: WebSessionRole } = {
  session: SESION_PRO,
  role: { status: "authenticated", role: "professional", email: "pro@uct.cl" },
};

const SESION_INTERN: WebSessionState = {
  status: "authenticated",
  email: "intern@uct.cl",
  name: "Practicante Ficticio",
  population: "personal",
};

const SIN_SESION: WebSessionState = { status: "unauthenticated" };

const PAR_SIN_SESION = {
  session: SIN_SESION,
  role: { status: "unauthenticated" },
} as const;

const PAR_INTERN = {
  session: SESION_INTERN,
  role: { status: "authenticated", role: "intern", email: "intern@uct.cl" },
} as const;

function filaAbierta(
  overrides: Partial<{
    _id: string;
    studentId: string;
    status: "received" | "under_review";
    createdAt: number;
  }> = {},
) {
  return {
    _id: (overrides._id ?? "req-1") as Id<"requests">,
    studentId: (overrides.studentId ?? "stu-1") as Id<"users">,
    status: overrides.status ?? "received",
    createdAt: overrides.createdAt ?? 1700000000000,
  };
}

function filaTomada(
  overrides: Partial<{ _id: string; status: "under_review"; accessNeeds: string }> = {},
) {
  return {
    ...filaAbierta(overrides),
    accessNeeds: overrides.accessNeeds ?? "Necesidad ficticia",
  };
}

function paginaAbierta(
  items: ReturnType<typeof filaAbierta>[],
  done: boolean,
  continueCursor = "c1",
): OpenRequestsPage {
  return { page: items, isDone: done, continueCursor };
}

function paginaTomadas(
  items: ReturnType<typeof filaTomada>[],
  done: boolean,
): AuthorizedRequestsPage {
  return { page: items, isDone: done, continueCursor: "c1" };
}

beforeEach(() => {
  vi.stubEnv("VITE_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("VITE_CONVEX_SITE_URL", "https://test.convex.site");
  sessionStorage.clear();
  mockedSession = undefined;
  mockedPair = undefined;
  mockedBackendConfigured = true;
  mockedOpen = undefined;
  openByCursor = null;
  mockedAuthorized = undefined;
  authorizedByCursor = null;
  mockedDetail = undefined;
  detailThrows = null;
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

function comoProfesional() {
  mockedSession = SESION_PRO;
  mockedPair = PAR_PRO;
}

describe("bandeja del Profesional (TI2-91)", () => {
  test("pro sin toma ve la bandeja minimizada y el vacío de tomadas", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta(
      [filaAbierta({ _id: "req-1" }), filaAbierta({ _id: "req-2" })],
      true,
    );
    mockedAuthorized = paginaTomadas([], true);
    renderAt("/profesional/solicitudes");

    const bandeja = await screen.findByRole("heading", { name: "Bandeja de triage" });
    expect(bandeja).toBeDefined();
    expect(await screen.findAllByText("Recibida")).toHaveLength(2);
    // La bandeja minimizada no expone necesidades de acceso.
    expect(screen.queryByText("Necesidad ficticia")).toBeNull();
    expect(await screen.findByText("No tienes solicitudes tomadas.")).toBeDefined();
  });

  test("pro con toma ve ambas listas con enlaces al detalle", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta([filaAbierta({ _id: "req-1" })], true);
    mockedAuthorized = paginaTomadas([filaTomada({ _id: "req-9", status: "under_review" })], true);
    renderAt("/profesional/solicitudes");

    expect(await screen.findByText("En revisión")).toBeDefined();
    const enlace = await screen.findByRole("link", { name: /En revisión/ });
    expect(enlace.getAttribute("href")).toBe("/profesional/solicitudes/req-9");
  });

  test("bandeja vacía muestra el vacío explícito", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta([], true);
    mockedAuthorized = paginaTomadas([], true);
    renderAt("/profesional/solicitudes");

    expect(await screen.findByText("No hay solicitudes por revisar.")).toBeDefined();
  });

  test("fallo de la bandeja no tumba las tomadas", async () => {
    comoProfesional();
    openByCursor = () => {
      throw new Error("No autorizado");
    };
    mockedAuthorized = paginaTomadas([filaTomada({ _id: "req-9", status: "under_review" })], true);
    renderAt("/profesional/solicitudes");

    expect(
      await screen.findByText("No pudimos cargar la bandeja de solicitudes.", { exact: false }),
    ).toBeDefined();
    expect(await screen.findByText("En revisión")).toBeDefined();
  });

  test("cargar más agrega la página siguiente sin duplicar", async () => {
    comoProfesional();
    const primera = paginaAbierta([filaAbierta({ _id: "req-1" })], false, "c1");
    const segunda = paginaAbierta([filaAbierta({ _id: "req-2" })], true, "c1");
    openByCursor = (cursor: string | null) => (cursor === null ? primera : segunda);
    mockedAuthorized = paginaTomadas([], true);
    renderAt("/profesional/solicitudes");

    // La bandeja ya no tiene enlaces (clickable={false}); busca el texto en la fila
    expect(await screen.findByText("Recibida")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));

    await waitFor(() => expect(screen.getAllByText("Recibida")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  test("primera página vacía no oculta filas de páginas posteriores", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta([], true);
    authorizedByCursor = (cursor: string | null) =>
      cursor === null
        ? paginaTomadas([], false)
        : paginaTomadas([filaTomada({ _id: "req-9", status: "under_review" })], true);
    renderAt("/profesional/solicitudes");

    // Hay más por cargar aunque la primera página venga vacía.
    const cargarMas = await screen.findByRole("button", { name: "Cargar más" });
    fireEvent.click(cargarMas);

    // La segunda página trae la fila: ni el vacío aparece ni se pierde la fila.
    expect(await screen.findByText("En revisión")).toBeDefined();
    expect(screen.queryByText("No tienes solicitudes tomadas.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  test("isDone se sincroniza aunque filas y estados no cambien", () => {
    const fila = { _id: "req-9", status: "under_review", createdAt: 1700000000000 };
    const sinMasPaginas = { page: [fila], isDone: true, continueCursor: "c1" };
    // Mismos IDs y estados, pero isDone pasa a false (hay página siguiente).
    const conMasPaginas = { page: [{ ...fila }], isDone: false, continueCursor: "c1" };

    const { result, rerender } = renderHook(
      ({ page }: { page: typeof sinMasPaginas | undefined }) => usePagedList(() => page),
      { initialProps: { page: sinMasPaginas as typeof sinMasPaginas | undefined } },
    );

    expect(result.current.firstPage?.page).toHaveLength(1);
    expect(result.current.tailDone).toBe(true);

    // Equivale al push reactivo de Convex con mismos datos e isDone distinto.
    rerender({ page: conMasPaginas });

    expect(result.current.firstPage?.page).toHaveLength(1);
    expect(result.current.tailDone).toBe(false);
  });

  test("todas las páginas cargadas mantienen lectura reactiva", () => {
    const tomadaPrimera = { _id: "req-1", status: "received", createdAt: 1700000000000 };
    const tomadaSegunda = { _id: "req-2", status: "under_review", createdAt: 1700000000000 };
    const paginas: Record<
      string,
      { page: (typeof tomadaPrimera)[]; isDone: boolean; continueCursor: string }
    > = {
      first: { page: [tomadaPrimera], isDone: false, continueCursor: "c1" },
      c1: { page: [tomadaSegunda], isDone: true, continueCursor: "c1" },
    };
    const usePage = (cursor: string | null) => paginas[cursor ?? "first"];
    const vista = (idsByCursor: ReadonlyMap<string, ReadonlyArray<string>> = new Map()) => (
      <ul>
        <PagedItems
          cursors={[null, "c1"]}
          usePage={usePage}
          renderItem={(request) => (
            <li key={request._id}>
              {request._id}:{request.status}
            </li>
          )}
          onIds={() => {}}
          idsByCursor={idsByCursor}
        />
      </ul>
    );

    const { rerender } = render(vista());
    expect(screen.getByText("req-1:received")).toBeDefined();
    expect(screen.getByText("req-2:under_review")).toBeDefined();

    // Convex empuja la primera página con la solicitud ya tomada: la vista de
    // esa página se actualiza sin tocar la segunda ni recargar.
    paginas.first = {
      page: [{ ...tomadaPrimera, status: "under_review" }],
      isDone: false,
      continueCursor: "c1",
    };
    rerender(vista());

    expect(screen.getByText("req-1:under_review")).toBeDefined();
    expect(screen.queryByText("req-1:received")).toBeNull();
    expect(screen.getByText("req-2:under_review")).toBeDefined();
  });

  test("una fila repetida en dos páginas se muestra una sola vez", () => {
    const filaA = { _id: "req-1", status: "received", createdAt: 1700000000000 };
    const filaB = { _id: "req-2", status: "received", createdAt: 1700000000000 };
    const filaC = { _id: "req-3", status: "received", createdAt: 1700000000000 };
    // Corrimiento por cambios concurrentes: req-2 quedó en ambas ventanas.
    const paginas: Record<
      string,
      { page: (typeof filaA)[]; isDone: boolean; continueCursor: string }
    > = {
      first: { page: [filaA, filaB], isDone: false, continueCursor: "c1" },
      c1: { page: [filaB, filaC], isDone: true, continueCursor: "c1" },
    };
    const usePage = (cursor: string | null) => paginas[cursor ?? "first"];
    render(
      <ul>
        <PagedItems
          cursors={[null, "c1"]}
          usePage={usePage}
          renderItem={(request) => (
            <li key={request._id}>
              {request._id}:{request.status}
            </li>
          )}
          onIds={() => {}}
          idsByCursor={
            new Map([
              ["first", ["req-1", "req-2"]],
              ["c1", ["req-2", "req-3"]],
            ])
          }
        />
      </ul>,
    );

    expect(screen.getByText("req-1:received")).toBeDefined();
    expect(screen.getAllByText("req-2:received")).toHaveLength(1);
    expect(screen.getByText("req-3:received")).toBeDefined();
  });
});

describe("detalle del Profesional (TI2-91)", () => {
  const DETALLE: RequestDetail = {
    _id: "req-9" as Id<"requests">,
    studentId: "stu-1" as Id<"users">,
    status: "under_review",
    accessNeeds: "Necesidad ficticia de acceso",
    createdAt: 1700000000000,
  };

  test("con toma muestra el detalle completo con necesidades", async () => {
    comoProfesional();
    mockedDetail = DETALLE;
    renderAt("/profesional/solicitudes/req-9");

    expect(await screen.findByRole("heading", { name: "Detalle de la solicitud" })).toBeDefined();
    expect(await screen.findByText("En revisión")).toBeDefined();
    expect(screen.getByText("Necesidad ficticia de acceso")).toBeDefined();
    const volver = screen.getByRole("link", { name: "Volver a solicitudes" });
    expect(volver.getAttribute("href")).toBe("/profesional/solicitudes");
  });

  test("otra cuenta sin toma ve denegación sin filtrar el contenido", async () => {
    comoProfesional();
    detailThrows = new Error("No autorizado");
    renderAt("/profesional/solicitudes/req-ajena");

    expect(
      await screen.findByText("No pudimos cargar el detalle de la solicitud.", { exact: false }),
    ).toBeDefined();
    expect(screen.queryByText("Necesidad ficticia de acceso")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Detalle de la solicitud" })).toBeDefined();
  });

  test("navegar de detalle denegado a uno válido lo muestra sin reintento", async () => {
    comoProfesional();
    detailThrows = new Error("No autorizado");
    const { router } = renderAt("/profesional/solicitudes/req-ajena");

    expect(
      await screen.findByText("No pudimos cargar el detalle de la solicitud.", { exact: false }),
    ).toBeDefined();

    // Navega dentro del mismo router: el límite debe reiniciarse con el requestId.
    detailThrows = null;
    mockedDetail = DETALLE;
    await act(async () => {
      router.history.push("/profesional/solicitudes/req-9");
    });

    expect(await screen.findByText("En revisión")).toBeDefined();
    expect(screen.getByText("Necesidad ficticia de acceso")).toBeDefined();
    expect(
      screen.queryByText("No pudimos cargar el detalle de la solicitud.", { exact: false }),
    ).toBeNull();
  });
});

describe("guard de las rutas de gestión (TI2-91)", () => {
  test("sin sesión redirige al acceso conservando el retorno", async () => {
    mockedSession = SIN_SESION;
    mockedPair = PAR_SIN_SESION;
    const { router } = renderAt("/profesional/solicitudes");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({
      redirect: "/profesional/solicitudes",
    });
    expect(screen.queryByRole("heading", { name: "Solicitudes" })).toBeNull();
  });

  test("otro rol va a denegado sin contenido de gestión", async () => {
    mockedSession = SESION_INTERN;
    mockedPair = PAR_INTERN;
    const { router } = renderAt("/profesional/solicitudes");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: "Solicitudes" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Detalle de la solicitud" })).toBeNull();
  });

  test("otro rol va a denegado en el detalle sin contenido", async () => {
    mockedSession = SESION_INTERN;
    mockedPair = PAR_INTERN;
    const { router } = renderAt("/profesional/solicitudes/req-9");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: "Detalle de la solicitud" })).toBeNull();
  });
});
