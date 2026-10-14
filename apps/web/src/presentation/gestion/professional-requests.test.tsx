// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
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
 * Pruebas de bandeja y detalle del Profesional (TI2-91/92).
 *
 * Integración por el router real (incluye guards): la sesión simulada es de
 * Profesional con toma, salvo los casos de denegación. Las queries de datos
 * se mockean por módulo porque `convex/react` no distingue referencias del
 * `api` generado (crea un objeto nuevo por acceso); el cableado real
 * query→referencia lo cubren `tsc`, el build y la verificación manual contra
 * el entorno ficticio de TI2-30. Todos los datos son ficticios.
 */

// Mocks de mutaciones (TI2-92)
const takeRequestMock = vi.fn();
const requestInfoMock = vi.fn();

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

// Mock global de convex/react: solo lo usa AuthScreen (ruta /login) con
// useQuery directo; las lecturas de gestión se mockean por módulo abajo con
// valores distintos por recurso, así que este mock no interfiere con ellas.
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
  useTakeRequest: () => takeRequestMock,
  useRequestAdditionalInformation: () => requestInfoMock,
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
  takeRequestMock.mockReset();
  requestInfoMock.mockReset();
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

test("tomar desde la bandeja ejecuta takeRequest con el id de la fila", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta([filaAbierta({ _id: "req-1" })], true);
    mockedAuthorized = paginaTomadas([], true);
    takeRequestMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes");

    const tomarBtn = await screen.findByRole("button", { name: "Tomar" });
    expect(tomarBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(tomarBtn);

    expect(takeRequestMock).toHaveBeenCalledTimes(1);
    expect(takeRequestMock).toHaveBeenCalledWith({ requestId: "req-1" });
  });

  test("error al tomar en bandeja muestra aviso y permite reintento", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta([filaAbierta({ _id: "req-1" })], true);
    mockedAuthorized = paginaTomadas([], true);
    takeRequestMock.mockRejectedValueOnce(new Error("No autorizado"));
    renderAt("/profesional/solicitudes");

    const tomarBtn = await screen.findByRole("button", { name: "Tomar" });
    fireEvent.click(tomarBtn);

    expect(await screen.findByText("No autorizado")).toBeDefined();
    expect(tomarBtn.hasAttribute("disabled")).toBe(false);

    takeRequestMock.mockResolvedValue(undefined);
    fireEvent.click(tomarBtn);
    expect(takeRequestMock).toHaveBeenCalledTimes(2);
  });

  test("doble clic en tomar de la bandeja no duplica la llamada", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta([filaAbierta({ _id: "req-1" })], true);
    mockedAuthorized = paginaTomadas([], true);
    takeRequestMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes");

    const tomarBtn = await screen.findByRole("button", { name: "Tomar" });
    fireEvent.click(tomarBtn);
    fireEvent.click(tomarBtn);

    expect(takeRequestMock).toHaveBeenCalledTimes(1);
  });

  test("tomar en curso se ve deshabilitado en la bandeja", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta([filaAbierta({ _id: "req-1" })], true);
    mockedAuthorized = paginaTomadas([], true);
    takeRequestMock.mockImplementation(() => new Promise(() => {}));
    renderAt("/profesional/solicitudes");

    const tomarBtn = await screen.findByRole("button", { name: "Tomar" });
    fireEvent.click(tomarBtn);

    const ocupado = await screen.findByRole("button", { name: "Tomando…" });
    expect(ocupado.hasAttribute("disabled")).toBe(true);
    expect(ocupado.className).toMatch("disabled:opacity-60");
    expect(ocupado.className).toMatch("disabled:cursor-not-allowed");
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

  test("un cambio en el conjunto visible con más cargadas reancla a ventana única", () => {
    const filaA = { _id: "req-1", status: "received", createdAt: 1700000000000 };
    const pagina = { page: [filaA], isDone: false, continueCursor: "c1" };

    const { result } = renderHook(() => usePagedList(() => pagina));

    // Carga la segunda página y reporta ambas ventanas (como harían los hijos).
    act(() => {
      result.current.loadMore();
    });
    expect(result.current.cursors).toEqual([null, "c1"]);
    act(() => {
      result.current.reportIds(null, ["req-1"]);
      result.current.reportIds("c1", ["req-2"]);
    });
    // Conjunto memorizado sin colapso: el avance no es un cambio.
    expect(result.current.cursors).toEqual([null, "c1"]);
    expect(result.current.hasItems).toBe(true);

    // Toma insertada antes del límite: cambia el conjunto → reancla.
    act(() => {
      result.current.reportIds(null, ["req-0", "req-1"]);
    });

    expect(result.current.cursors).toEqual([null]);
    expect(result.current.hasItems).toBe(true);
  });

  test("una página en vuelo no establece referencia ni colapsa", () => {
    const filaA = { _id: "req-1", status: "received", createdAt: 1700000000000 };
    const pagina = { page: [filaA], isDone: false, continueCursor: "c1" };

    const { result } = renderHook(() => usePagedList(() => pagina));
    act(() => {
      result.current.reportIds(null, ["req-1"]);
    });
    act(() => {
      result.current.loadMore();
    });
    expect(result.current.cursors).toEqual([null, "c1"]);

    // La nueva página aún carga (sin reporte): no hay referencia que comparar.
    act(() => {
      result.current.reportIds("c1", undefined);
    });
    expect(result.current.cursors).toEqual([null, "c1"]);

    // Llegan sus filas: se memoriza sin colapsar por el propio avance.
    act(() => {
      result.current.reportIds("c1", ["req-2"]);
    });
    expect(result.current.cursors).toEqual([null, "c1"]);
    expect(result.current.hasItems).toBe(true);
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

describe("acciones del Profesional (TI2-92)", () => {
  const DETALLE_RECEIVED: RequestDetail = {
    _id: "req-1" as Id<"requests">,
    studentId: "stu-1" as Id<"users">,
    status: "received",
    accessNeeds: "Necesidad inicial",
    createdAt: 1700000000000,
  };

  const DETALLE_UNDER_REVIEW: RequestDetail = {
    _id: "req-9" as Id<"requests">,
    studentId: "stu-1" as Id<"users">,
    status: "under_review",
    accessNeeds: "Necesidad ficticia de acceso",
    createdAt: 1700000000000,
  };

  test("estado received muestra botón 'Tomar solicitud' y ejecuta takeRequest", async () => {
    comoProfesional();
    mockedDetail = DETALLE_RECEIVED;
    takeRequestMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-1");

    const tomarBtn = await screen.findByRole("button", { name: "Tomar solicitud" });
    expect(tomarBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(tomarBtn);

    expect(takeRequestMock).toHaveBeenCalledTimes(1);
    expect(takeRequestMock).toHaveBeenCalledWith({ requestId: "req-1" });
  });

  test("estado under_review muestra botón 'Pedir información' y abre modal", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    const pedirBtn = await screen.findByRole("button", { name: "Pedir información" });
    expect(pedirBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(pedirBtn);

    expect(
      await screen.findByRole("dialog", { name: "Pedir información adicional" }),
    ).toBeDefined();
    expect(await screen.findByLabelText("Motivo *")).toBeDefined();
  });

  test("pedir información valida motivo obligatorio", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText("El motivo es obligatorio")).toBeDefined();
    expect(requestInfoMock).not.toHaveBeenCalled();
  });

  test("pedir información valida longitud máxima 2000 caracteres", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const textarea = screen.getByLabelText("Motivo *");
    const longReason = "a".repeat(2001);
    fireEvent.change(textarea, { target: { value: longReason } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText("El motivo no puede exceder 2000 caracteres")).toBeDefined();
    expect(requestInfoMock).not.toHaveBeenCalled();
  });

  test("pedir información ejecuta requestAdditionalInformation con motivo válido", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    requestInfoMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const textarea = screen.getByLabelText("Motivo *");
    fireEvent.change(textarea, { target: { value: "Falta información sobre horario" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(requestInfoMock).toHaveBeenCalledTimes(1));
    expect(requestInfoMock).toHaveBeenCalledWith({
      requestId: "req-9",
      reason: "Falta información sobre horario",
    });

    // Tras el éxito el modal cierra y el foco va al estado (estable ante la
    // transición inminente), no al botón que puede desmontarse enseguida.
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Pedir información adicional" })).toBeNull(),
    );
    const estadoTrasExito = await screen.findByText("En revisión");
    expect(document.activeElement).toBe(estadoTrasExito);
  });

  test("tras éxito con cambio de estado el foco va al estado estable", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    requestInfoMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    fireEvent.change(screen.getByLabelText("Motivo *"), {
      target: { value: "Falta información sobre horario" },
    });
    // El estado cambia DURANTE el envío: al cerrar, el botón ya no existe.
    mockedDetail = { ...DETALLE_UNDER_REVIEW, status: "awaiting_information_or_acceptance" };
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(requestInfoMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Pedir información adicional" })).toBeNull(),
    );
    const estado = await screen.findByText("Esperando información o aceptación");
    expect(document.activeElement).toBe(estado);
  });

  test("error en takeRequest muestra mensaje y permite reintento", async () => {
    comoProfesional();
    mockedDetail = DETALLE_RECEIVED;
    takeRequestMock.mockRejectedValue(new Error("No autorizado"));
    renderAt("/profesional/solicitudes/req-1");

    const tomarBtn = await screen.findByRole("button", { name: "Tomar solicitud" });
    fireEvent.click(tomarBtn);

    expect(await screen.findByText("No autorizado")).toBeDefined();
    expect(tomarBtn.hasAttribute("disabled")).toBe(false);
  });

  test("error en requestAdditionalInformation muestra mensaje y permite reintento", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    requestInfoMock.mockRejectedValue(new Error("No autorizado"));
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const textarea = screen.getByLabelText("Motivo *");
    fireEvent.change(textarea, { target: { value: "Motivo válido" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    // El aviso vive DENTRO del diálogo abierto (aria-modal lo exige).
    const dialogo = await screen.findByRole("dialog", { name: "Pedir información adicional" });
    expect(within(dialogo).getByText("No autorizado")).toBeDefined();
    const enviarBtn = within(dialogo).getByRole("button", { name: "Enviar" });
    expect(enviarBtn.hasAttribute("disabled")).toBe(false);
  });

  test("reintento exitoso cierra sin conservar el error anterior", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    requestInfoMock.mockRejectedValueOnce(new Error("No autorizado"));
    requestInfoMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    fireEvent.change(screen.getByLabelText("Motivo *"), { target: { value: "Motivo válido" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("No autorizado")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Pedir información adicional" })).toBeNull(),
    );
    expect(screen.queryByText("No autorizado")).toBeNull();

    // Al reabrir no queda el error anterior.
    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    expect(
      await screen.findByRole("dialog", { name: "Pedir información adicional" }),
    ).toBeDefined();
    expect(screen.queryByText("No autorizado")).toBeNull();
  });

  test("doble clic en tomar no duplica la llamada", async () => {
    comoProfesional();
    mockedDetail = DETALLE_RECEIVED;
    takeRequestMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-1");

    const tomarBtn = await screen.findByRole("button", { name: "Tomar solicitud" });
    fireEvent.click(tomarBtn);
    fireEvent.click(tomarBtn);

    expect(takeRequestMock).toHaveBeenCalledTimes(1);
  });

  test("doble clic en pedir información no duplica la llamada", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    requestInfoMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const textarea = screen.getByLabelText("Motivo *");
    fireEvent.change(textarea, { target: { value: "Motivo válido" } });
    const enviarBtn = screen.getByRole("button", { name: "Enviar" });
    fireEvent.click(enviarBtn);

    // Tras el primer clic el botón se deshabilita; el segundo clic (misma
    // referencia) lo frena el guard isActionPending del handler, no el DOM.
    expect(enviarBtn.hasAttribute("disabled")).toBe(true);
    fireEvent.click(enviarBtn);

    expect(requestInfoMock).toHaveBeenCalledTimes(1);
  });

  test("modal se cierra con botón Cancelar", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    expect(
      await screen.findByRole("dialog", { name: "Pedir información adicional" }),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog", { name: "Pedir información adicional" })).toBeNull();
  });

  test("abrir el modal mueve el foco al motivo", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const motivo = await screen.findByLabelText("Motivo *");

    await waitFor(() => expect(document.activeElement).toBe(motivo));
  });

  test("Escape cierra el modal y devuelve el foco al botón", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    const abrirBtn = await screen.findByRole("button", { name: "Pedir información" });
    fireEvent.click(abrirBtn);
    const dialogo = await screen.findByRole("dialog", { name: "Pedir información adicional" });

    fireEvent.keyDown(dialogo, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Pedir información adicional" })).toBeNull();
    expect(document.activeElement).toBe(abrirBtn);
  });

  test("Tab queda atrapado dentro del modal", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const dialogo = await screen.findByRole("dialog", { name: "Pedir información adicional" });
    const motivo = screen.getByLabelText("Motivo *");

    // Desde el último foco (Enviar), Tab envuelve al primero (motivo).
    const enviarBtn = screen.getByRole("button", { name: "Enviar" });
    enviarBtn.focus();
    fireEvent.keyDown(dialogo, { key: "Tab" });
    expect(document.activeElement).toBe(motivo);

    // Desde el primero, Shift+Tab envuelve al último.
    fireEvent.keyDown(dialogo, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(enviarBtn);
  });

  test("estados accepted y awaiting_information_or_acceptance no muestran acciones", async () => {
    const detalleAccepted: RequestDetail = {
      ...DETALLE_UNDER_REVIEW,
      status: "accepted",
    };
    const detalleAwaiting: RequestDetail = {
      ...DETALLE_UNDER_REVIEW,
      status: "awaiting_information_or_acceptance",
    };

    for (const detalle of [detalleAccepted, detalleAwaiting]) {
      comoProfesional();
      mockedDetail = detalle;
      renderAt("/profesional/solicitudes/req-9");

      // Espera el detalle renderizado: sin esto la ausencia de botones sería
      // vacuosa (el cuerpo aún no monta).
      expect(await screen.findByText("Necesidad ficticia de acceso")).toBeDefined();
      expect(screen.queryByRole("button", { name: /Tomar|Pedir información/ })).toBeNull();
    }
  });
});

describe("acciones del Profesional (TI2-92)", () => {
  const DETALLE_RECEIVED: RequestDetail = {
    _id: "req-1" as Id<"requests">,
    studentId: "stu-1" as Id<"users">,
    status: "received",
    accessNeeds: "Necesidad inicial",
    createdAt: 1700000000000,
  };

  const DETALLE_UNDER_REVIEW: RequestDetail = {
    _id: "req-9" as Id<"requests">,
    studentId: "stu-1" as Id<"users">,
    status: "under_review",
    accessNeeds: "Necesidad ficticia de acceso",
    createdAt: 1700000000000,
  };

  test("estado received muestra botón 'Tomar solicitud' y ejecuta takeRequest", async () => {
    comoProfesional();
    mockedDetail = DETALLE_RECEIVED;
    takeRequestMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-1");

    const tomarBtn = await screen.findByRole("button", { name: "Tomar solicitud" });
    expect(tomarBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(tomarBtn);

    expect(takeRequestMock).toHaveBeenCalledTimes(1);
    expect(takeRequestMock).toHaveBeenCalledWith({ requestId: "req-1" });
  });

  test("estado under_review muestra botón 'Pedir información' y abre modal", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    const pedirBtn = await screen.findByRole("button", { name: "Pedir información" });
    expect(pedirBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(pedirBtn);

    expect(
      await screen.findByRole("dialog", { name: "Pedir información adicional" }),
    ).toBeDefined();
    expect(await screen.findByLabelText("Motivo *")).toBeDefined();
  });

  test("pedir información valida motivo obligatorio", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText("El motivo es obligatorio")).toBeDefined();
    expect(requestInfoMock).not.toHaveBeenCalled();
  });

  test("pedir información valida longitud máxima 2000 caracteres", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const textarea = screen.getByLabelText("Motivo *");
    const longReason = "a".repeat(2001);
    fireEvent.change(textarea, { target: { value: longReason } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText("El motivo no puede exceder 2000 caracteres")).toBeDefined();
    expect(requestInfoMock).not.toHaveBeenCalled();
  });

  test("pedir información ejecuta requestAdditionalInformation con motivo válido", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    requestInfoMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const textarea = screen.getByLabelText("Motivo *");
    fireEvent.change(textarea, { target: { value: "Falta información sobre horario" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(requestInfoMock).toHaveBeenCalledTimes(1));
    expect(requestInfoMock).toHaveBeenCalledWith({
      requestId: "req-9",
      reason: "Falta información sobre horario",
    });

    // Tras el éxito el modal cierra y el foco va al estado (estable ante la
    // transición inminente), no al botón que puede desmontarse enseguida.
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Pedir información adicional" })).toBeNull(),
    );
    const estadoTrasExito = await screen.findByText("En revisión");
    expect(document.activeElement).toBe(estadoTrasExito);
  });

  test("tras éxito con cambio de estado el foco va al estado estable", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    requestInfoMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    fireEvent.change(screen.getByLabelText("Motivo *"), {
      target: { value: "Falta información sobre horario" },
    });
    // El estado cambia DURANTE el envío: al cerrar, el botón ya no existe.
    mockedDetail = { ...DETALLE_UNDER_REVIEW, status: "awaiting_information_or_acceptance" };
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(requestInfoMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Pedir información adicional" })).toBeNull(),
    );
    const estado = await screen.findByText("Esperando información o aceptación");
    expect(document.activeElement).toBe(estado);
  });

  test("error en takeRequest muestra mensaje y permite reintento", async () => {
    comoProfesional();
    mockedDetail = DETALLE_RECEIVED;
    takeRequestMock.mockRejectedValue(new Error("No autorizado"));
    renderAt("/profesional/solicitudes/req-1");

    const tomarBtn = await screen.findByRole("button", { name: "Tomar solicitud" });
    fireEvent.click(tomarBtn);

    expect(await screen.findByText("No autorizado")).toBeDefined();
    expect(tomarBtn.hasAttribute("disabled")).toBe(false);
  });

  test("error en requestAdditionalInformation muestra mensaje y permite reintento", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    requestInfoMock.mockRejectedValue(new Error("No autorizado"));
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const textarea = screen.getByLabelText("Motivo *");
    fireEvent.change(textarea, { target: { value: "Motivo válido" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    // El aviso vive DENTRO del diálogo abierto (aria-modal lo exige).
    const dialogo = await screen.findByRole("dialog", { name: "Pedir información adicional" });
    expect(within(dialogo).getByText("No autorizado")).toBeDefined();
    const enviarBtn = within(dialogo).getByRole("button", { name: "Enviar" });
    expect(enviarBtn.hasAttribute("disabled")).toBe(false);
  });

  test("reintento exitoso cierra sin conservar el error anterior", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    requestInfoMock.mockRejectedValueOnce(new Error("No autorizado"));
    requestInfoMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    fireEvent.change(screen.getByLabelText("Motivo *"), { target: { value: "Motivo válido" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("No autorizado")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Pedir información adicional" })).toBeNull(),
    );
    expect(screen.queryByText("No autorizado")).toBeNull();

    // Al reabrir no queda el error anterior.
    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    expect(
      await screen.findByRole("dialog", { name: "Pedir información adicional" }),
    ).toBeDefined();
    expect(screen.queryByText("No autorizado")).toBeNull();
  });

  test("doble clic en tomar no duplica la llamada", async () => {
    comoProfesional();
    mockedDetail = DETALLE_RECEIVED;
    takeRequestMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-1");

    const tomarBtn = await screen.findByRole("button", { name: "Tomar solicitud" });
    fireEvent.click(tomarBtn);
    fireEvent.click(tomarBtn);

    expect(takeRequestMock).toHaveBeenCalledTimes(1);
  });

  test("doble clic en pedir información no duplica la llamada", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    requestInfoMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const textarea = screen.getByLabelText("Motivo *");
    fireEvent.change(textarea, { target: { value: "Motivo válido" } });
    const enviarBtn = screen.getByRole("button", { name: "Enviar" });
    fireEvent.click(enviarBtn);

    // Tras el primer clic el botón se deshabilita; el segundo clic (misma
    // referencia) lo frena el guard isActionPending del handler, no el DOM.
    expect(enviarBtn.hasAttribute("disabled")).toBe(true);
    fireEvent.click(enviarBtn);

    expect(requestInfoMock).toHaveBeenCalledTimes(1);
  });

  test("modal se cierra con botón Cancelar", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    expect(
      await screen.findByRole("dialog", { name: "Pedir información adicional" }),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog", { name: "Pedir información adicional" })).toBeNull();
  });

  test("abrir el modal mueve el foco al motivo", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const motivo = await screen.findByLabelText("Motivo *");

    await waitFor(() => expect(document.activeElement).toBe(motivo));
  });

  test("Escape cierra el modal y devuelve el foco al botón", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    const abrirBtn = await screen.findByRole("button", { name: "Pedir información" });
    fireEvent.click(abrirBtn);
    const dialogo = await screen.findByRole("dialog", { name: "Pedir información adicional" });

    fireEvent.keyDown(dialogo, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Pedir información adicional" })).toBeNull();
    expect(document.activeElement).toBe(abrirBtn);
  });

  test("Tab queda atrapado dentro del modal", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const dialogo = await screen.findByRole("dialog", { name: "Pedir información adicional" });
    const motivo = screen.getByLabelText("Motivo *");

    // Desde el último foco (Enviar), Tab envuelve al primero (motivo).
    const enviarBtn = screen.getByRole("button", { name: "Enviar" });
    enviarBtn.focus();
    fireEvent.keyDown(dialogo, { key: "Tab" });
    expect(document.activeElement).toBe(motivo);

    // Desde el primero, Shift+Tab envuelve al último.
    fireEvent.keyDown(dialogo, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(enviarBtn);
  });

  test("estados accepted y awaiting_information_or_acceptance no muestran acciones", async () => {
    const detalleAccepted: RequestDetail = {
      ...DETALLE_UNDER_REVIEW,
      status: "accepted",
    };
    const detalleAwaiting: RequestDetail = {
      ...DETALLE_UNDER_REVIEW,
      status: "awaiting_information_or_acceptance",
    };

    for (const detalle of [detalleAccepted, detalleAwaiting]) {
      comoProfesional();
      mockedDetail = detalle;
      renderAt("/profesional/solicitudes/req-9");

      // Espera el detalle renderizado: sin esto la ausencia de botones sería
      // vacuosa (el cuerpo aún no monta).
      expect(await screen.findByText("Necesidad ficticia de acceso")).toBeDefined();
      expect(screen.queryByRole("button", { name: /Tomar|Pedir información/ })).toBeNull();
    }
  });
});
