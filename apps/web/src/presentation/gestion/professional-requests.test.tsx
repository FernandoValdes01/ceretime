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
import { ConvexError } from "convex/values";
import { useSyncExternalStore } from "react";
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
import { REQUEST_ACTION_FALLBACK_MESSAGE } from "./request-review-errors.ts";
import { ACCESS_DENIED_MESSAGE } from "../shared/view-states.tsx";

/**
 * Pruebas de bandeja y detalle del Profesional (TI2-91/92/157).
 *
 * Integración por el router real (incluye guards): la sesión simulada es de
 * Profesional con toma, salvo los casos de denegación. Las queries de datos
 * se simulan por módulo porque `convex/react` no distingue referencias del
 * `api` generado (crea un objeto nuevo por acceso); el cableado real
 * query→referencia lo cubren `tsc`, el build y la verificación manual contra
 * el entorno ficticio de TI2-30. Todos los datos son ficticios.
 */

// Mocks de mutaciones (TI2-92)
const takeRequestMock = vi.fn();
const requestInfoMock = vi.fn();
const acceptRequestMock = vi.fn();
const closeRequestMock = vi.fn();
const recordContactMock = vi.fn();
const recordAcceptanceMock = vi.fn();
const referRequestMock = vi.fn();
const registerOfficialMock = vi.fn();

/** Denegación del contrato común (TI2-181), tal como la entrega el SDK. */
const UNAUTHORIZED_ERROR = new ConvexError({ code: "unauthorized", message: "No autorizado" });
/** Error del SDK con texto técnico: nunca debe llegar a la pantalla. */
const SDK_ERROR = new Error("[CONVEX M(presentation/requests:acceptRequest)] Server Error");

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

/**
 * El detalle simulado es reactivo como `useQuery` de Convex: `actualizarDetalle`
 * cambia la respuesta y vuelve a dibujar a quien la lee, igual que cuando
 * el Backend empuja la solicitud después de una mutación.
 */
const detailListeners = new Set<() => void>();
let detailVersion = 0;
function suscribirDetalle(listener: () => void) {
  detailListeners.add(listener);
  return () => {
    detailListeners.delete(listener);
  };
}
function actualizarDetalle(next: RequestDetail) {
  mockedDetail = next;
  detailVersion += 1;
  for (const listener of detailListeners) listener();
}

/** Las etiquetas de estado de las filas, sin las opciones del filtro. */
const FICHA = { selector: ".student-portal__chip" };

// Mock global de convex/react: solo lo usa AuthScreen (ruta /login) con
// useQuery directo; las lecturas de gestión se simulan por módulo abajo con
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
    useSyncExternalStore(suscribirDetalle, () => detailVersion);
    if (detailThrows !== null) {
      throw detailThrows;
    }
    return mockedDetail;
  },
  useTakeRequest: () => takeRequestMock,
  useRequestAdditionalInformation: () => requestInfoMock,
  useAcceptRequest: () => acceptRequestMock,
  useCloseRequestWithoutAccompaniment: () => closeRequestMock,
  useRecordReferralContact: () => recordContactMock,
  useRecordReferralAcceptance: () => recordAcceptanceMock,
  useReferRequest: () => referRequestMock,
  useRegisterOfficialRequest: () => registerOfficialMock,
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

const SESION_ADMIN: WebSessionState = {
  status: "authenticated",
  email: "admin@uct.cl",
  name: "Administrador Ficticio",
  population: "personal",
};

const PAR_ADMIN = {
  session: SESION_ADMIN,
  role: { status: "authenticated", role: "admin", email: "admin@uct.cl" },
} as const;

function filaAbierta(
  overrides: Partial<{
    _id: string;
    studentId: string;
    status: RequestDetail["status"];
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
  overrides: Partial<{ _id: string; status: RequestDetail["status"]; accessNeeds: string }> = {},
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
  detailListeners.clear();
  takeRequestMock.mockReset();
  requestInfoMock.mockReset();
  acceptRequestMock.mockReset();
  closeRequestMock.mockReset();
  recordContactMock.mockReset();
  recordAcceptanceMock.mockReset();
  referRequestMock.mockReset();
  registerOfficialMock.mockReset();
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
    expect(await screen.findAllByText("Recibida", FICHA)).toHaveLength(2);
    // La bandeja minimizada no expone necesidades de acceso.
    expect(screen.queryByText("Necesidad ficticia")).toBeNull();
    expect(await screen.findByText("No tienes solicitudes tomadas.")).toBeDefined();
  });

  test("pro con toma ve ambas listas con enlaces al detalle", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta([filaAbierta({ _id: "req-1" })], true);
    mockedAuthorized = paginaTomadas([filaTomada({ _id: "req-9", status: "under_review" })], true);
    renderAt("/profesional/solicitudes");

    expect(await screen.findByText("En revisión", FICHA)).toBeDefined();
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

  test("cada «Tomar» de la bandeja describe su fila para el lector de pantalla", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta(
      [filaAbierta({ _id: "req-1" }), filaAbierta({ _id: "req-2" })],
      true,
    );
    mockedAuthorized = paginaTomadas([], true);
    renderAt("/profesional/solicitudes");

    const controles = await screen.findAllByRole("button", { name: "Tomar" });
    expect(controles).toHaveLength(2);
    const textos = controles.map((control) => {
      const fila = document.getElementById(control.getAttribute("aria-describedby") ?? "");
      return fila?.textContent ?? "";
    });
    for (const texto of textos) expect(texto).toMatch(/^Recibida.*Registrada el /);
    expect(new Set(controles.map((control) => control.getAttribute("aria-describedby"))).size).toBe(
      2,
    );
  });

  test("error al tomar en bandeja muestra aviso y permite reintento", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta([filaAbierta({ _id: "req-1" })], true);
    mockedAuthorized = paginaTomadas([], true);
    takeRequestMock.mockRejectedValueOnce(SDK_ERROR);
    renderAt("/profesional/solicitudes");

    const tomarBtn = await screen.findByRole("button", { name: "Tomar" });
    fireEvent.click(tomarBtn);

    expect(await screen.findByText(REQUEST_ACTION_FALLBACK_MESSAGE)).toBeDefined();
    expect(screen.queryByText(/CONVEX|Server Error/)).toBeNull();
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
    expect(await screen.findByText("En revisión", FICHA)).toBeDefined();
  });

  test("cargar más agrega la página siguiente sin duplicar", async () => {
    comoProfesional();
    const primera = paginaAbierta([filaAbierta({ _id: "req-1" })], false, "c1");
    const segunda = paginaAbierta([filaAbierta({ _id: "req-2" })], true, "c1");
    openByCursor = (cursor: string | null) => (cursor === null ? primera : segunda);
    mockedAuthorized = paginaTomadas([], true);
    renderAt("/profesional/solicitudes");

    // La bandeja ya no tiene enlaces (clickable={false}); busca el texto en la fila
    expect(await screen.findByText("Recibida", FICHA)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));

    await waitFor(() => expect(screen.getAllByText("Recibida", FICHA)).toHaveLength(2));
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
    expect(await screen.findByText("En revisión", FICHA)).toBeDefined();
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

  test("un cambio en el conjunto visible con más cargadas vuelve a anclar en una ventana única", () => {
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

    // Toma insertada antes del límite: cambia el conjunto → vuelve a anclar.
    act(() => {
      result.current.reportIds(null, ["req-0", "req-1"]);
    });

    expect(result.current.cursors).toEqual([null]);
    expect(result.current.hasItems).toBe(true);
  });

  test("recargar una página descartada no la vuelve a colapsar", () => {
    const filaA = { _id: "req-1", status: "received", createdAt: 1700000000000 };
    const pagina = { page: [filaA], isDone: false, continueCursor: "c1" };

    const { result } = renderHook(() => usePagedList(() => pagina));
    act(() => {
      result.current.reportIds(null, ["req-1"]);
    });
    act(() => {
      result.current.loadMore();
    });
    act(() => {
      result.current.reportIds("c1", ["req-2"]);
    });
    expect(result.current.cursors).toEqual([null, "c1"]);

    // Toma insertada antes del límite: vuelve a anclar en una ventana única.
    act(() => {
      result.current.reportIds(null, ["req-0", "req-1"]);
    });
    expect(result.current.cursors).toEqual([null]);

    // "Cargar más" vuelve a pedir el mismo cursor. El cliente responde primero
    // con la copia en caché y después con la página actual: la ventana nueva
    // debe mantenerse en ambos reportes.
    act(() => {
      result.current.loadMore();
    });
    act(() => {
      result.current.reportIds("c1", ["req-2"]);
    });
    act(() => {
      result.current.reportIds("c1", ["req-9"]);
    });

    expect(result.current.cursors).toEqual([null, "c1"]);
  });

  test("un cambio en la última página no vuelve a anclar: no deja huecos detrás", () => {
    const filaA = { _id: "req-1", status: "received", createdAt: 1700000000000 };
    const pagina = { page: [filaA], isDone: false, continueCursor: "c1" };

    const { result } = renderHook(() => usePagedList(() => pagina));
    act(() => {
      result.current.reportIds(null, ["req-1"]);
      result.current.loadMore();
    });
    act(() => {
      result.current.reportIds("c1", ["req-2"]);
    });
    expect(result.current.cursors).toEqual([null, "c1"]);

    // La cola cambia: no hay ventana posterior que desplazar.
    act(() => {
      result.current.reportIds("c1", ["req-3"]);
    });

    expect(result.current.cursors).toEqual([null, "c1"]);
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
    // Se distingue del texto normal por el subrayado, no solo por el color.
    expect(volver.className).toContain("underline");
    expect(volver.className).not.toContain("no-underline");
    expect(volver.className).toContain("text-primary");
  });

  test("otra cuenta sin toma ve acceso denegado sin filtrar el contenido", async () => {
    comoProfesional();
    detailThrows = UNAUTHORIZED_ERROR;
    renderAt("/profesional/solicitudes/req-ajena");

    expect(await screen.findByText(ACCESS_DENIED_MESSAGE)).toBeDefined();
    expect(screen.queryByText("Necesidad ficticia de acceso")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Detalle de la solicitud" })).toBeDefined();
  });

  test("un fallo de lectura que no es denegación ofrece reintento sin texto técnico", async () => {
    comoProfesional();
    detailThrows = SDK_ERROR;
    renderAt("/profesional/solicitudes/req-9");

    expect(
      await screen.findByText("No pudimos cargar el detalle de la solicitud.", { exact: false }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeDefined();
    expect(screen.queryByText(/CONVEX|Server Error/)).toBeNull();
  });

  test("navegar de detalle denegado a uno válido lo muestra sin reintento", async () => {
    comoProfesional();
    detailThrows = UNAUTHORIZED_ERROR;
    const { router } = renderAt("/profesional/solicitudes/req-ajena");

    expect(await screen.findByText(ACCESS_DENIED_MESSAGE)).toBeDefined();

    // Navega dentro del mismo router: el límite debe reiniciarse con el requestId.
    detailThrows = null;
    mockedDetail = DETALLE;
    await act(async () => {
      router.history.push("/profesional/solicitudes/req-9");
    });

    expect(await screen.findByText("En revisión")).toBeDefined();
    expect(screen.getByText("Necesidad ficticia de acceso")).toBeDefined();
    expect(screen.queryByText(ACCESS_DENIED_MESSAGE)).toBeNull();
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

  // TI2-126: la bandeja y el detalle son gestión del Profesional. El
  // Administrador no lee acompañamientos ni notas internas (matriz TI2-5), y
  // la Web no debe ofrecerle la ruta aunque el guard sea solo navegación.
  test("el Administrador ve denegado sin contenido de gestión", async () => {
    mockedSession = SESION_ADMIN;
    mockedPair = PAR_ADMIN;
    const { router } = renderAt("/profesional/solicitudes");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(await screen.findByRole("heading", { name: "Acceso denegado" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Solicitudes" })).toBeNull();
  });

  test("el Administrador ve denegado el detalle sin contenido ni notas internas", async () => {
    mockedSession = SESION_ADMIN;
    mockedPair = PAR_ADMIN;
    const { router } = renderAt("/profesional/solicitudes/req-9");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: "Detalle de la solicitud" })).toBeNull();
    expect(screen.queryByText(/nota interna/i)).toBeNull();
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
    expect(await screen.findByLabelText("Motivo (obligatorio)")).toBeDefined();
  });

  test("pedir información valida motivo obligatorio", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText("Escribe el motivo.")).toBeDefined();
    expect(requestInfoMock).not.toHaveBeenCalled();
  });

  test("pedir información valida longitud máxima 2000 caracteres", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const textarea = screen.getByLabelText("Motivo (obligatorio)");
    const longReason = "a".repeat(2001);
    fireEvent.change(textarea, { target: { value: longReason } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText("El motivo no puede exceder 2000 caracteres.")).toBeDefined();
    expect(requestInfoMock).not.toHaveBeenCalled();
  });

  test("pedir información ejecuta requestAdditionalInformation con motivo válido", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    requestInfoMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const textarea = screen.getByLabelText("Motivo (obligatorio)");
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
    const estadoFinal = await screen.findByText("En revisión");
    expect(document.activeElement).toBe(estadoFinal);
  });

  test("tras éxito con cambio de estado el foco va al estado estable", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    requestInfoMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    fireEvent.change(screen.getByLabelText("Motivo (obligatorio)"), {
      target: { value: "Falta información sobre horario" },
    });
    // El estado cambia DURANTE el envío: al cerrar, el botón ya no existe.
    requestInfoMock.mockImplementation(async () => {
      actualizarDetalle({ ...DETALLE_UNDER_REVIEW, status: "awaiting_information_or_acceptance" });
    });
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
    takeRequestMock.mockRejectedValue(UNAUTHORIZED_ERROR);
    renderAt("/profesional/solicitudes/req-1");

    const tomarBtn = await screen.findByRole("button", { name: "Tomar solicitud" });
    fireEvent.click(tomarBtn);

    expect(await screen.findByText(ACCESS_DENIED_MESSAGE)).toBeDefined();
    expect(tomarBtn.hasAttribute("disabled")).toBe(false);
  });

  test("error en requestAdditionalInformation muestra mensaje y permite reintento", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    requestInfoMock.mockRejectedValue(
      new ConvexError({
        code: "conflict",
        message: "La solicitud no admite pedir información adicional en su estado actual",
      }),
    );
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    const textarea = screen.getByLabelText("Motivo (obligatorio)");
    fireEvent.change(textarea, { target: { value: "Motivo válido" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    // El aviso vive DENTRO del diálogo abierto (aria-modal lo exige) y dice
    // cómo seguir además del motivo público del conflicto.
    const dialogo = await screen.findByRole("dialog", { name: "Pedir información adicional" });
    expect(
      await within(dialogo).findByText(
        "La solicitud no admite pedir información adicional en su estado actual. El detalle ya muestra el estado vigente; continúa desde ahí.",
      ),
    ).toBeDefined();
    const enviarBtn = within(dialogo).getByRole("button", { name: "Enviar" });
    expect(enviarBtn.hasAttribute("disabled")).toBe(false);
  });

  test("reintento exitoso cierra sin conservar el error anterior", async () => {
    comoProfesional();
    mockedDetail = DETALLE_UNDER_REVIEW;
    requestInfoMock.mockRejectedValueOnce(SDK_ERROR);
    requestInfoMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    fireEvent.change(screen.getByLabelText("Motivo (obligatorio)"), {
      target: { value: "Motivo válido" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText(REQUEST_ACTION_FALLBACK_MESSAGE)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Pedir información adicional" })).toBeNull(),
    );
    expect(screen.queryByText(REQUEST_ACTION_FALLBACK_MESSAGE)).toBeNull();

    // Al reabrir no queda el error anterior.
    fireEvent.click(await screen.findByRole("button", { name: "Pedir información" }));
    expect(
      await screen.findByRole("dialog", { name: "Pedir información adicional" }),
    ).toBeDefined();
    expect(screen.queryByText(REQUEST_ACTION_FALLBACK_MESSAGE)).toBeNull();
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
    const textarea = screen.getByLabelText("Motivo (obligatorio)");
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
    const motivo = await screen.findByLabelText("Motivo (obligatorio)");

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
    const motivo = screen.getByLabelText("Motivo (obligatorio)");

    // Desde el último foco (Enviar), Tab envuelve al primero (motivo).
    const enviarBtn = screen.getByRole("button", { name: "Enviar" });
    enviarBtn.focus();
    fireEvent.keyDown(dialogo, { key: "Tab" });
    expect(document.activeElement).toBe(motivo);

    // Desde el primero, Shift+Tab envuelve al último.
    fireEvent.keyDown(dialogo, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(enviarBtn);
  });

  test("cada estado ofrece solo las acciones que admite", async () => {
    const acciones = [
      "Tomar solicitud",
      "Aceptar y abrir acompañamiento",
      "Pedir información",
      "Cerrar sin acompañamiento",
      "Derivar a otra unidad",
    ];
    const casos: ReadonlyArray<[RequestDetail["status"], readonly string[]]> = [
      ["received", ["Tomar solicitud"]],
      [
        "under_review",
        [
          "Aceptar y abrir acompañamiento",
          "Pedir información",
          "Cerrar sin acompañamiento",
          "Derivar a otra unidad",
        ],
      ],
      [
        "awaiting_information_or_acceptance",
        ["Aceptar y abrir acompañamiento", "Cerrar sin acompañamiento", "Derivar a otra unidad"],
      ],
      ["accepted", []],
      ["referred", []],
      ["closed_without_accompaniment", []],
      ["cancelled", []],
    ];

    for (const [status, esperadas] of casos) {
      comoProfesional();
      mockedDetail = { ...DETALLE_UNDER_REVIEW, status };
      const { unmount } = renderAt("/profesional/solicitudes/req-9");

      // Espera el detalle en pantalla: sin esto la ausencia de botones no
      // probaría nada (el cuerpo aún no monta).
      expect(await screen.findByText("Necesidad ficticia de acceso")).toBeDefined();
      const visibles = acciones.filter(
        (nombre) => screen.queryByRole("button", { name: nombre }) !== null,
      );
      expect({ status, visibles }).toEqual({ status, visibles: esperadas });
      unmount();
    }
  });
});

describe("revisión completa del Profesional (TI2-157)", () => {
  const DETALLE: RequestDetail = {
    _id: "req-9" as Id<"requests">,
    studentId: "stu-1" as Id<"users">,
    status: "under_review",
    accessNeeds: "Comunicación escrita\nMás tiempo para comunicarme",
    createdAt: 1700000000000,
  };

  async function openAcceptDialog() {
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar y abrir acompañamiento" }));
    return await screen.findByRole("dialog", { name: "Aceptar y abrir acompañamiento" });
  }

  test("la aceptación muestra necesidades y profesional asignado y exige objetivo", async () => {
    comoProfesional();
    mockedDetail = DETALLE;
    renderAt("/profesional/solicitudes/req-9");

    const dialogo = await openAcceptDialog();
    expect(within(dialogo).getByText("Necesidades que pasan al acompañamiento")).toBeDefined();
    expect(
      within(dialogo).getByText("Comunicación escrita Más tiempo para comunicarme", {
        normalizer: (texto) => texto.replace(/\s+/g, " ").trim(),
      }),
    ).toBeDefined();
    expect(within(dialogo).getByText("Tú, como profesional responsable")).toBeDefined();
    const objetivo = within(dialogo).getByLabelText("Objetivo del acompañamiento (obligatorio)");
    await waitFor(() => expect(document.activeElement).toBe(objetivo));

    fireEvent.click(within(dialogo).getByRole("button", { name: "Aceptar" }));
    expect(
      await within(dialogo).findByText("Escribe el objetivo del acompañamiento."),
    ).toBeDefined();
    expect(objetivo.getAttribute("aria-invalid")).toBe("true");
    expect(acceptRequestMock).not.toHaveBeenCalled();
  });

  test("aceptar envía el objetivo, anuncia el éxito y lleva el foco al estado", async () => {
    comoProfesional();
    mockedDetail = DETALLE;
    acceptRequestMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-9");

    const dialogo = await openAcceptDialog();
    fireEvent.change(within(dialogo).getByLabelText("Objetivo del acompañamiento (obligatorio)"), {
      target: { value: "  Acordar ajustes de comunicación  " },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Aceptar" }));

    await waitFor(() => expect(acceptRequestMock).toHaveBeenCalledTimes(1));
    expect(acceptRequestMock).toHaveBeenCalledWith({
      requestId: "req-9",
      objective: "Acordar ajustes de comunicación",
    });
    expect(
      await screen.findByText("Aceptaste la solicitud y se abrió su acompañamiento."),
    ).toBeDefined();
    expect(document.activeElement).toBe(screen.getByText("En revisión"));
  });

  test("doble envío de la aceptación llama una sola vez", async () => {
    comoProfesional();
    mockedDetail = DETALLE;
    acceptRequestMock.mockImplementation(() => new Promise(() => {}));
    renderAt("/profesional/solicitudes/req-9");

    const dialogo = await openAcceptDialog();
    fireEvent.change(within(dialogo).getByLabelText("Objetivo del acompañamiento (obligatorio)"), {
      target: { value: "Objetivo ficticio" },
    });
    const aceptar = within(dialogo).getByRole("button", { name: "Aceptar" });
    fireEvent.click(aceptar);
    fireEvent.click(aceptar);

    expect(acceptRequestMock).toHaveBeenCalledTimes(1);
    expect(within(dialogo).getByRole("button", { name: "Enviando…" })).toBeDefined();
  });

  test("repetir la aceptación no muestra un segundo acompañamiento", async () => {
    comoProfesional();
    // Otra pestaña ya aceptó: el detalle reactivo trae el acompañamiento único,
    // pero esta vista aún ofrecía aceptar cuando se abrió el diálogo.
    mockedDetail = DETALLE;
    acceptRequestMock.mockRejectedValue(
      new ConvexError({ code: "conflict", message: "La solicitud ya fue aceptada" }),
    );
    renderAt("/profesional/solicitudes/req-9");

    const dialogo = await openAcceptDialog();
    fireEvent.change(within(dialogo).getByLabelText("Objetivo del acompañamiento (obligatorio)"), {
      target: { value: "Objetivo ficticio" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Aceptar" }));

    expect(
      await within(dialogo).findByText(
        "La solicitud ya fue aceptada. El detalle ya muestra el estado vigente; continúa desde ahí.",
      ),
    ).toBeDefined();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    // Llega la versión aceptada: un solo acompañamiento y ninguna acción más.
    act(() => {
      actualizarDetalle({
        ...DETALLE,
        status: "accepted",
        accompanimentId: "acc-1" as Id<"accompaniments">,
      });
    });
    expect(await screen.findByText("Aceptada")).toBeDefined();
    expect(screen.getAllByText("Acompañamiento")).toHaveLength(1);
    expect(screen.getAllByText("Abierto a partir de esta solicitud")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Aceptar y abrir acompañamiento" })).toBeNull();
  });

  test("una aceptación denegada por el Backend muestra acceso denegado", async () => {
    comoProfesional();
    mockedDetail = DETALLE;
    acceptRequestMock.mockRejectedValue(UNAUTHORIZED_ERROR);
    renderAt("/profesional/solicitudes/req-9");

    const dialogo = await openAcceptDialog();
    fireEvent.change(within(dialogo).getByLabelText("Objetivo del acompañamiento (obligatorio)"), {
      target: { value: "Objetivo ficticio" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Aceptar" }));

    expect(await within(dialogo).findByText(ACCESS_DENIED_MESSAGE)).toBeDefined();
    expect(within(dialogo).queryByText("No autorizado", { exact: true })).toBeNull();
  });

  test("un error desconocido usa el mensaje de respaldo sin texto técnico", async () => {
    comoProfesional();
    mockedDetail = DETALLE;
    acceptRequestMock.mockRejectedValue(SDK_ERROR);
    renderAt("/profesional/solicitudes/req-9");

    const dialogo = await openAcceptDialog();
    fireEvent.change(within(dialogo).getByLabelText("Objetivo del acompañamiento (obligatorio)"), {
      target: { value: "Objetivo ficticio" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Aceptar" }));

    expect(await within(dialogo).findByText(REQUEST_ACTION_FALLBACK_MESSAGE)).toBeDefined();
    expect(screen.queryByText(/CONVEX|Server Error|acceptRequest/)).toBeNull();
  });

  test("un dato rechazado muestra el mensaje público que dice qué corregir", async () => {
    comoProfesional();
    mockedDetail = DETALLE;
    acceptRequestMock.mockRejectedValue(
      new ConvexError({
        code: "request_fields_invalid",
        message: "Se requiere el objetivo para abrir el acompañamiento",
      }),
    );
    renderAt("/profesional/solicitudes/req-9");

    const dialogo = await openAcceptDialog();
    fireEvent.change(within(dialogo).getByLabelText("Objetivo del acompañamiento (obligatorio)"), {
      target: { value: "Objetivo ficticio" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Aceptar" }));

    expect(
      await within(dialogo).findByText("Se requiere el objetivo para abrir el acompañamiento."),
    ).toBeDefined();
  });

  test("cerrar sin acompañamiento exige la razón y la envía", async () => {
    comoProfesional();
    mockedDetail = { ...DETALLE, status: "awaiting_information_or_acceptance" };
    closeRequestMock.mockResolvedValue(undefined);
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sin acompañamiento" }));
    const dialogo = await screen.findByRole("dialog", { name: "Cerrar sin acompañamiento" });
    expect(within(dialogo).getByText(/El estudiante leerá esta razón/)).toBeDefined();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Cerrar solicitud" }));
    expect(await within(dialogo).findByText("Escribe la razón del cierre.")).toBeDefined();
    expect(closeRequestMock).not.toHaveBeenCalled();

    fireEvent.change(within(dialogo).getByLabelText("Razón del cierre (obligatorio)"), {
      target: { value: "La necesidad corresponde a otra unidad" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cerrar solicitud" }));

    await waitFor(() => expect(closeRequestMock).toHaveBeenCalledTimes(1));
    expect(closeRequestMock).toHaveBeenCalledWith({
      requestId: "req-9",
      reason: "La necesidad corresponde a otra unidad",
    });
    expect(await screen.findByText("Cerraste la solicitud sin acompañamiento.")).toBeDefined();
  });

  test("queda visible quién resolvió la solicitud", async () => {
    const casos: ReadonlyArray<[RequestDetail["status"], string, string]> = [
      ["under_review", "A cargo de", "Tú, como profesional que la tomó"],
      ["accepted", "Resuelta por", "Tú, como profesional a cargo"],
      ["closed_without_accompaniment", "Resuelta por", "Tú, como profesional a cargo"],
      ["referred", "Resuelta por", "Tú, como profesional a cargo"],
      ["cancelled", "Resuelta por", "El estudiante, al cancelarla"],
    ];
    for (const [status, termino, valor] of casos) {
      comoProfesional();
      mockedDetail = { ...DETALLE, status };
      const { unmount } = renderAt("/profesional/solicitudes/req-9");

      const dt = await screen.findByText(termino, { selector: "dt" });
      expect({ status, valor: dt.nextElementSibling?.textContent }).toEqual({ status, valor });
      unmount();
    }
  });

  test("el detalle muestra el intercambio y la razón de cierre", async () => {
    comoProfesional();
    mockedDetail = {
      ...DETALLE,
      status: "closed_without_accompaniment",
      informationResponse: "Puedo asistir los martes",
      closureReason: "Corresponde a otra unidad",
    };
    renderAt("/profesional/solicitudes/req-9");

    expect(await screen.findByText("Puedo asistir los martes")).toBeDefined();
    expect(screen.getByText("Respuesta del estudiante")).toBeDefined();
    expect(screen.getByText("Corresponde a otra unidad")).toBeDefined();
    expect(screen.getByText("Razón del cierre")).toBeDefined();
  });

  test("el filtro por estado conserva el contexto al ir y volver del detalle", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta([], true);
    mockedAuthorized = paginaTomadas(
      [
        filaTomada({ _id: "req-1", status: "under_review" }),
        filaTomada({ _id: "req-2", status: "accepted" }),
      ],
      true,
    );
    const { router } = renderAt("/profesional/solicitudes?estado=accepted");

    const filtro = await screen.findByLabelText("Filtrar por estado");
    expect((filtro as HTMLSelectElement).value).toBe("accepted");
    const enlace = await screen.findByRole("link", { name: /Aceptada/ });
    expect(screen.queryByRole("link", { name: /En revisión/ })).toBeNull();
    expect(enlace.getAttribute("href")).toBe("/profesional/solicitudes/req-2?estado=accepted");

    mockedDetail = { ...DETALLE, _id: "req-2" as Id<"requests">, status: "accepted" };
    fireEvent.click(enlace);
    const volver = await screen.findByRole("link", { name: "Volver a solicitudes" });
    expect(volver.getAttribute("href")).toBe("/profesional/solicitudes?estado=accepted");

    fireEvent.click(volver);
    await waitFor(() => expect(router.state.location.pathname).toBe("/profesional/solicitudes"));
    expect(router.state.location.search).toEqual({ estado: "accepted" });
    expect(((await screen.findByLabelText("Filtrar por estado")) as HTMLSelectElement).value).toBe(
      "accepted",
    );
  });

  test("cambiar el filtro actualiza la URL y muestra todos los estados al quitarlo", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta([], true);
    mockedAuthorized = paginaTomadas(
      [
        filaTomada({ _id: "req-1", status: "under_review" }),
        filaTomada({ _id: "req-2", status: "cancelled" }),
      ],
      true,
    );
    const { router } = renderAt("/profesional/solicitudes");

    const filtro = await screen.findByLabelText("Filtrar por estado");
    // Todos los estados del contrato están disponibles para filtrar.
    expect(within(filtro).getAllByRole("option")).toHaveLength(8);
    expect(await screen.findByRole("link", { name: /Cancelada/ })).toBeDefined();

    fireEvent.change(filtro, { target: { value: "under_review" } });
    await waitFor(() => expect(router.state.location.search).toEqual({ estado: "under_review" }));
    expect(screen.queryByRole("link", { name: /Cancelada/ })).toBeNull();

    fireEvent.change(filtro, { target: { value: "" } });
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(await screen.findByRole("link", { name: /Cancelada/ })).toBeDefined();
  });

  test("un filtro sin coincidencias explica cómo ver el resto", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta([], true);
    mockedAuthorized = paginaTomadas([filaTomada({ _id: "req-1", status: "under_review" })], true);
    renderAt("/profesional/solicitudes?estado=referred");

    expect(
      await screen.findByText("No tienes solicitudes tomadas en estado «Derivada»."),
    ).toBeDefined();
    expect(screen.queryByText("No tienes solicitudes tomadas.")).toBeNull();
  });

  test("un estado desconocido en la URL se descarta", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta([], true);
    mockedAuthorized = paginaTomadas([filaTomada({ _id: "req-1", status: "under_review" })], true);
    renderAt("/profesional/solicitudes?estado=inventado");

    expect(await screen.findByRole("link", { name: /En revisión/ })).toBeDefined();
    expect(((await screen.findByLabelText("Filtrar por estado")) as HTMLSelectElement).value).toBe(
      "",
    );
  });
});

describe("derivaciones en el detalle del Profesional (TI2-158)", () => {
  const DERIVADA: RequestDetail = {
    _id: "req-9" as Id<"requests">,
    studentId: "stu-1" as Id<"users">,
    status: "under_review",
    accessNeeds: "Necesidad ficticia de acceso",
    createdAt: 1700000000000,
    provenanceChannel: "official_channel",
    incomingReferral: { originUnit: "Unidad ficticia de origen", referredAt: 1700000000000 },
  };

  test("sin aceptación del estudiante no se ofrece abrir acompañamiento", async () => {
    comoProfesional();
    mockedDetail = DERIVADA;
    renderAt("/profesional/solicitudes/req-9");

    expect(await screen.findByRole("heading", { name: "Derivación de entrada" })).toBeDefined();
    expect(screen.getByText(/Unidad ficticia de origen/)).toBeDefined();
    expect(screen.getAllByText("Pendiente")).toHaveLength(2);
    expect(screen.getByText("Registrada por CERETI desde un canal oficial")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Aceptar y abrir acompañamiento" })).toBeNull();
    expect(screen.getByText(/registra primero el contacto con el estudiante/)).toBeDefined();
    // Solo el siguiente paso: la aceptación exige el contacto previo.
    expect(
      screen.getByRole("button", { name: "Registrar contacto con el estudiante" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Registrar aceptación del estudiante" }),
    ).toBeNull();
  });

  test("contacto y aceptación se registran en orden y recién entonces se ofrece aceptar", async () => {
    comoProfesional();
    mockedDetail = DERIVADA;
    recordContactMock.mockImplementation(async () => {
      actualizarDetalle({
        ...DERIVADA,
        incomingReferral: { ...DERIVADA.incomingReferral!, contactedAt: 1700000100000 },
      });
    });
    recordAcceptanceMock.mockImplementation(async () => {
      actualizarDetalle({
        ...DERIVADA,
        incomingReferral: {
          ...DERIVADA.incomingReferral!,
          contactedAt: 1700000100000,
          acceptedAt: 1700000200000,
        },
      });
    });
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(
      await screen.findByRole("button", { name: "Registrar contacto con el estudiante" }),
    );
    await waitFor(() => expect(recordContactMock).toHaveBeenCalledWith({ requestId: "req-9" }));
    expect(await screen.findByText("Registraste el contacto con el estudiante.")).toBeDefined();
    expect(document.activeElement).toBe(screen.getByText("En revisión"));
    expect(screen.queryByRole("button", { name: "Aceptar y abrir acompañamiento" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Registrar aceptación del estudiante" }));
    await waitFor(() => expect(recordAcceptanceMock).toHaveBeenCalledWith({ requestId: "req-9" }));
    expect(
      await screen.findByRole("button", { name: "Aceptar y abrir acompañamiento" }),
    ).toBeDefined();
    expect(screen.queryByText("Pendiente")).toBeNull();
    expect(screen.queryByText(/registra primero el contacto/)).toBeNull();
  });

  test("un registro rechazado por conflicto explica cómo seguir", async () => {
    comoProfesional();
    mockedDetail = DERIVADA;
    recordContactMock.mockRejectedValue(
      new ConvexError({
        code: "conflict",
        message: "El contacto con el estudiante ya está registrado.",
      }),
    );
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(
      await screen.findByRole("button", { name: "Registrar contacto con el estudiante" }),
    );
    expect(
      await screen.findByText(
        "El contacto con el estudiante ya está registrado. El detalle ya muestra el estado vigente; continúa desde ahí.",
      ),
    ).toBeDefined();
  });

  test("derivar a otra unidad informa que la comunicación ocurre fuera de la aplicación", async () => {
    comoProfesional();
    mockedDetail = { ...DERIVADA, incomingReferral: undefined, provenanceChannel: "student" };
    referRequestMock.mockImplementation(async () => {
      actualizarDetalle({
        ...DERIVADA,
        incomingReferral: undefined,
        provenanceChannel: "student",
        status: "referred",
        outgoingReferral: {
          destinationUnit: "Unidad ficticia de destino",
          referredAt: 1700000300000,
          reason: "El apoyo lo entrega esa unidad",
        },
      });
    });
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Derivar a otra unidad" }));
    const dialogo = await screen.findByRole("dialog", { name: "Derivar a otra unidad" });
    expect(
      within(dialogo).getByText(/ocurre fuera de la aplicación/, { exact: false }),
    ).toBeDefined();
    expect(
      within(dialogo).getByText(/no se eligen destinatarios ni se envían antecedentes/),
    ).toBeDefined();
    const unidad = within(dialogo).getByLabelText("Unidad de destino (obligatorio)");
    await waitFor(() => expect(document.activeElement).toBe(unidad));

    fireEvent.click(within(dialogo).getByRole("button", { name: "Derivar" }));
    expect(await within(dialogo).findByText("Indica la unidad de destino.")).toBeDefined();
    expect(unidad.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(unidad);
    expect(referRequestMock).not.toHaveBeenCalled();

    fireEvent.change(unidad, { target: { value: "  Unidad ficticia de destino " } });
    fireEvent.change(within(dialogo).getByLabelText("Razón de la derivación (obligatorio)"), {
      target: { value: "El apoyo lo entrega esa unidad" },
    });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Derivar" }));

    await waitFor(() =>
      expect(referRequestMock).toHaveBeenCalledWith({
        requestId: "req-9",
        destinationUnit: "Unidad ficticia de destino",
        reason: "El apoyo lo entrega esa unidad",
      }),
    );
    expect(await screen.findByText("Derivada")).toBeDefined();
    expect(screen.getByText(/Unidad ficticia de destino, el/)).toBeDefined();
    expect(screen.getByText("El apoyo lo entrega esa unidad")).toBeDefined();
    expect(screen.getByText("Enviada por el estudiante")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Aceptar y abrir acompañamiento" })).toBeNull();
  });

  test("Tab recorre la unidad, la razón y los botones sin salir del diálogo", async () => {
    comoProfesional();
    mockedDetail = { ...DERIVADA, incomingReferral: undefined };
    renderAt("/profesional/solicitudes/req-9");

    fireEvent.click(await screen.findByRole("button", { name: "Derivar a otra unidad" }));
    const dialogo = await screen.findByRole("dialog", { name: "Derivar a otra unidad" });
    const unidad = within(dialogo).getByLabelText("Unidad de destino (obligatorio)");
    const derivar = within(dialogo).getByRole("button", { name: "Derivar" });

    derivar.focus();
    fireEvent.keyDown(dialogo, { key: "Tab" });
    expect(document.activeElement).toBe(unidad);
    fireEvent.keyDown(dialogo, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(derivar);
  });
});

describe("registro por canal oficial (TI2-158)", () => {
  function completarContenido() {
    fireEvent.change(screen.getByLabelText(/Correo institucional del estudiante/), {
      target: { value: "  estudiante.ficticio@alu.uct.cl " },
    });
    fireEvent.change(screen.getByLabelText(/Describe la barrera o necesidad/), {
      target: { value: "Necesidad ficticia" },
    });
    fireEvent.change(screen.getByLabelText(/Qué espera el estudiante de CERETI/), {
      target: { value: "Resultado ficticio" },
    });
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getByRole("radio", { name: "En línea" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Martes" }));
    fireEvent.change(screen.getByLabelText(/Medio accesible para recibir información/), {
      target: { value: "Correo con letra grande" },
    });
  }

  test("se llega desde Solicitudes", async () => {
    comoProfesional();
    mockedOpen = paginaAbierta([], true);
    mockedAuthorized = paginaTomadas([], true);
    renderAt("/profesional/solicitudes");

    const enlace = await screen.findByRole("link", {
      name: "Registrar solicitud por canal oficial",
    });
    expect(enlace.getAttribute("href")).toBe("/profesional/solicitudes/registrar");
  });

  test("cada campo tiene nombre accesible y dice si es obligatorio u opcional", async () => {
    comoProfesional();
    renderAt("/profesional/solicitudes/registrar");

    expect(
      await screen.findByRole("heading", { name: "Registrar solicitud por canal oficial" }),
    ).toBeDefined();
    expect(screen.getByText("Canal oficial de CERETI")).toBeDefined();
    expect(
      screen.getByLabelText("Correo institucional del estudiante (obligatorio)"),
    ).toBeDefined();
    expect(screen.getByLabelText("Fecha en que CERETI la recibió (opcional)")).toBeDefined();
    expect(screen.getByLabelText("Unidad que derivó al estudiante (opcional)")).toBeDefined();
    expect(
      screen.getByRole("group", { name: "Necesidades de acceso (obligatorio)" }),
    ).toBeDefined();
    expect(screen.getByRole("group", { name: "Modalidad preferida (obligatorio)" })).toBeDefined();
    expect(screen.getByRole("group", { name: "Días disponibles (obligatorio)" })).toBeDefined();
    // La voz es la del personal: habla del estudiante.
    expect(screen.getByRole("heading", { name: "Necesidad del estudiante" })).toBeDefined();
    expect(screen.queryByText("Tu necesidad")).toBeNull();
  });

  test("lo que falta se resume, enlaza a cada campo y no se envía", async () => {
    comoProfesional();
    renderAt("/profesional/solicitudes/registrar");

    fireEvent.click(await screen.findByRole("button", { name: "Registrar solicitud" }));

    const resumen = await screen.findByRole("heading", {
      name: "Revisa estos campos antes de registrar",
    });
    await waitFor(() => expect(document.activeElement).toBe(resumen));
    const enlaceCorreo = screen.getByRole("link", {
      name: "Correo del estudiante: Indica el correo institucional del estudiante.",
    });
    expect(
      screen.getByRole("link", {
        name: "Qué espera el estudiante de CERETI: Indica qué espera el estudiante de CERETI.",
      }),
    ).toBeDefined();
    fireEvent.click(enlaceCorreo);
    expect(document.activeElement).toBe(
      screen.getByLabelText(/Correo institucional del estudiante/),
    );
    const correo = screen.getByLabelText(/Correo institucional del estudiante/);
    expect(correo.getAttribute("aria-invalid")).toBe("true");
    expect(correo.getAttribute("aria-describedby")).toContain("request-studentEmail-error");
    expect(registerOfficialMock).not.toHaveBeenCalled();
  });

  test("registra con procedencia y queda como derivación de entrada", async () => {
    comoProfesional();
    registerOfficialMock.mockResolvedValue({ _id: "req-nueva" });
    renderAt("/profesional/solicitudes/registrar");

    await screen.findByRole("heading", { name: "Registrar solicitud por canal oficial" });
    completarContenido();
    fireEvent.change(screen.getByLabelText(/Unidad que derivó al estudiante/), {
      target: { value: " Unidad ficticia de origen " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar solicitud" }));

    await waitFor(() => expect(registerOfficialMock).toHaveBeenCalledTimes(1));
    const [datos] = registerOfficialMock.mock.calls[0] as [Record<string, unknown>];
    expect(datos).toMatchObject({
      studentEmail: "estudiante.ficticio@alu.uct.cl",
      originUnit: "Unidad ficticia de origen",
      needSummary: "Necesidad ficticia",
      expectedOutcome: "Resultado ficticio",
      modalityPreference: "online",
      generalAvailability: { preferredWeekdays: [2] },
      preferredAccessibleInformationChannel: "Correo con letra grande",
    });
    // Desde TI2-165 el contrato no admite clave de idempotencia.
    expect(datos).not.toHaveProperty("idempotencyKey");
    expect(datos).not.toHaveProperty("receivedAt");

    const registrada = await screen.findByRole("heading", { name: "Solicitud registrada" });
    await waitFor(() => expect(document.activeElement).toBe(registrada));
    expect(screen.getByText(/Quedó también como derivación de entrada/)).toBeDefined();
  });

  test("la fecha de recepción se envía y nunca queda en el futuro", async () => {
    comoProfesional();
    registerOfficialMock.mockResolvedValue({ _id: "req-nueva" });
    renderAt("/profesional/solicitudes/registrar");

    await screen.findByRole("heading", { name: "Registrar solicitud por canal oficial" });
    completarContenido();
    fireEvent.change(screen.getByLabelText(/Fecha en que CERETI la recibió/), {
      target: { value: "2026-03-10" },
    });
    const antes = Date.now();
    fireEvent.click(screen.getByRole("button", { name: "Registrar solicitud" }));

    await waitFor(() => expect(registerOfficialMock).toHaveBeenCalledTimes(1));
    const [datos] = registerOfficialMock.mock.calls[0] as [{ receivedAt: number }];
    expect(datos.receivedAt).toBe(Date.UTC(2026, 2, 10, 12));
    expect(datos.receivedAt).toBeLessThanOrEqual(antes);
    expect(screen.queryByText(/derivación de entrada/)).toBeNull();
  });

  test("cada rechazo muestra un mensaje comprensible y se puede reintentar", async () => {
    comoProfesional();
    registerOfficialMock.mockRejectedValueOnce(
      new ConvexError({
        code: "request_fields_invalid",
        message: "No hay una cuenta de Estudiante vigente con ese correo.",
      }),
    );
    registerOfficialMock.mockRejectedValueOnce(SDK_ERROR);
    registerOfficialMock.mockRejectedValueOnce(UNAUTHORIZED_ERROR);
    renderAt("/profesional/solicitudes/registrar");

    await screen.findByRole("heading", { name: "Registrar solicitud por canal oficial" });
    completarContenido();
    const registrar = screen.getByRole("button", { name: "Registrar solicitud" });

    fireEvent.click(registrar);
    expect(
      await screen.findByText("No hay una cuenta de Estudiante vigente con ese correo."),
    ).toBeDefined();
    expect(
      await screen.findByRole("heading", { name: "No se registró la solicitud" }),
    ).toBeDefined();

    fireEvent.click(registrar);
    expect(await screen.findByText(REQUEST_ACTION_FALLBACK_MESSAGE)).toBeDefined();
    expect(screen.queryByText(/CONVEX|Server Error/)).toBeNull();

    fireEvent.click(registrar);
    expect(await screen.findByText(ACCESS_DENIED_MESSAGE)).toBeDefined();
    expect(registerOfficialMock).toHaveBeenCalledTimes(3);
  });

  test("un doble clic mientras se registra llama una sola vez", async () => {
    comoProfesional();
    registerOfficialMock.mockImplementation(() => new Promise(() => {}));
    renderAt("/profesional/solicitudes/registrar");

    await screen.findByRole("heading", { name: "Registrar solicitud por canal oficial" });
    completarContenido();
    const registrar = screen.getByRole("button", { name: "Registrar solicitud" });
    fireEvent.click(registrar);
    fireEvent.click(registrar);

    expect(registerOfficialMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Registrando…" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
