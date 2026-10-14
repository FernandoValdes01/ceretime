// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { OwnRequestDetail, OwnRequestItem } from "./student-requests-data.ts";

/**
 * Pruebas del listado y detalle propios del Estudiante (TI2-89).
 *
 * Integración por el router real (incluye guards): la sesión simulada es de
 * Estudiante titular, salvo los casos de denegación. Las queries de datos
 * se mockean por módulo porque `convex/react` no distingue referencias del
 * `api` generado (crea un objeto nuevo por acceso); el cableado real
 * query→referencia lo cubren `tsc`, el build y la verificación manual contra
 * el entorno ficticio de TI2-30. Todos los datos son ficticios.
 */

type PaginatedState = {
  results: OwnRequestItem[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  loadMore: (numItems: number) => void;
};

let mockedSession: WebSessionState;
let mockedPair:
  | {
      session: WebSessionState;
      role: WebSessionRole;
    }
  | undefined;
let mockedBackendConfigured = true;

let paginatedState: PaginatedState | undefined;
let paginatedThrows: Error | null = null;
let mockedDetail: OwnRequestDetail | undefined;
let detailThrows: Error | null = null;

vi.mock("convex/react", () => ({ useQuery: () => mockedSession }));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () => mockedPair,
}));

vi.mock("./student-requests-data.ts", () => ({
  PAGE_SIZE: 10,
  useOwnRequestsPaginated: () => {
    if (paginatedThrows !== null) {
      throw paginatedThrows;
    }
    return paginatedState;
  },
  useOwnRequestDetail: () => {
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

const SESION_ESTUDIANTE: WebSessionState = {
  status: "authenticated",
  email: "estudiante@alu.uct.cl",
  name: "Estudiante Ficticio",
  population: "estudiante",
};

const PAR_ESTUDIANTE: { session: WebSessionState; role: WebSessionRole } = {
  session: SESION_ESTUDIANTE,
  role: { status: "authenticated", role: "student", email: "estudiante@alu.uct.cl" },
};

const SESION_PERSONAL: WebSessionState = {
  status: "authenticated",
  email: "pro@uct.cl",
  name: "Personal Ficticio",
  population: "personal",
};

const SIN_SESION: WebSessionState = { status: "unauthenticated" };

const PAR_SIN_SESION = {
  session: SIN_SESION,
  role: { status: "unauthenticated" },
} as const;

function filaPropia(
  overrides: Partial<{ _id: string; status: "received" | "under_review"; createdAt: number }> = {},
): OwnRequestItem {
  return {
    _id: (overrides._id ?? "req-1") as Id<"requests">,
    studentId: "stu-1" as Id<"users">,
    status: overrides.status ?? "received",
    accessNeeds: "Apoyo ficticio para la prueba",
    createdAt: overrides.createdAt ?? 1700000000000,
  };
}

function estadoPaginado(
  results: OwnRequestItem[],
  status: PaginatedState["status"],
  loadMore: (numItems: number) => void = () => {},
): PaginatedState {
  return { results, status, loadMore };
}

function detallePropio(
  overrides: Partial<{ _id: string; status: "under_review"; accessNeeds: string }> = {},
): OwnRequestDetail {
  return {
    _id: (overrides._id ?? "req-1") as Id<"requests">,
    studentId: "stu-1" as Id<"users">,
    status: overrides.status ?? "under_review",
    accessNeeds: overrides.accessNeeds ?? "Apoyo ficticio para la prueba",
    createdAt: 1700000000000,
  };
}

function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

beforeEach(() => {
  mockedSession = SESION_ESTUDIANTE;
  mockedPair = PAR_ESTUDIANTE;
  mockedBackendConfigured = true;
  paginatedState = undefined;
  paginatedThrows = null;
  mockedDetail = undefined;
  detailThrows = null;
});

afterEach(() => {
  cleanup();
});

describe("listado propio del Estudiante (TI2-89)", () => {
  test("el titular ve sus solicitudes con etiquetas y enlace al detalle", async () => {
    paginatedState = estadoPaginado(
      [filaPropia({ _id: "req-1", status: "under_review" })],
      "Exhausted",
    );
    renderAt("/estudiante/solicitudes");

    expect(await screen.findByRole("heading", { name: "Mis solicitudes" })).toBeDefined();
    expect(screen.getByText("En revisión")).toBeDefined();
    expect(screen.getByRole("link", { name: /en revisión/i })).toHaveProperty(
      "textContent",
      expect.stringContaining("En revisión"),
    );
  });

  test("el avance de página no pierde ni repite filas", async () => {
    const primera = [filaPropia({ _id: "req-1" })];
    const acumuladas = [...primera, filaPropia({ _id: "req-2", status: "under_review" })];
    const loadMore = vi.fn(() => {
      paginatedState = estadoPaginado(acumuladas, "Exhausted", loadMore);
    });
    paginatedState = estadoPaginado(primera, "CanLoadMore", loadMore);
    const view = renderAt("/estudiante/solicitudes");

    expect(await screen.findByText("Recibida")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(loadMore).toHaveBeenCalledTimes(1);

    // El hook reactivo entrega el acumulado; la vista lo refleja sin duplicar.
    view.unmount();
    renderAt("/estudiante/solicitudes");

    expect(await screen.findByText("En revisión")).toBeDefined();
    expect(screen.getByText("Recibida")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  test("el cambio de estado se refleja sin caché desactualizada", async () => {
    paginatedState = estadoPaginado(
      [filaPropia({ _id: "req-1", status: "received" })],
      "Exhausted",
    );
    const view = renderAt("/estudiante/solicitudes");
    expect(await screen.findByText("Recibida")).toBeDefined();

    // La misma solicitud cambia a revisión (actualización reactiva del Backend).
    paginatedState = estadoPaginado(
      [filaPropia({ _id: "req-1", status: "under_review" })],
      "Exhausted",
    );
    view.unmount();
    renderAt("/estudiante/solicitudes");

    expect(await screen.findByText("En revisión")).toBeDefined();
    expect(screen.queryByText("Recibida")).toBeNull();
  });

  test("la página vacía no final permite avanzar y el vacío es solo al agotar", async () => {
    const loadMore = vi.fn(() => {
      paginatedState = estadoPaginado([filaPropia({ _id: "req-2" })], "Exhausted", loadMore);
    });
    paginatedState = estadoPaginado([], "CanLoadMore", loadMore);
    const view = renderAt("/estudiante/solicitudes");

    expect(await screen.findByRole("button", { name: "Cargar más" })).toBeDefined();
    expect(screen.queryByText("Aún no tienes solicitudes registradas.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(loadMore).toHaveBeenCalledTimes(1);
    view.unmount();
    renderAt("/estudiante/solicitudes");
    expect(await screen.findByText("Recibida")).toBeDefined();
  });

  test("la página vacía agotada muestra el vacío explícito", async () => {
    paginatedState = estadoPaginado([], "Exhausted");
    renderAt("/estudiante/solicitudes");

    expect(await screen.findByText("Aún no tienes solicitudes registradas.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  test("la carga inicial muestra el estado sin contenido", async () => {
    paginatedState = estadoPaginado([], "LoadingFirstPage");
    renderAt("/estudiante/solicitudes");

    expect(await screen.findByRole("status")).toBeDefined();
    expect(screen.getByText(/cargando tus solicitudes/i)).toBeDefined();
  });

  test("el fallo de red muestra aviso genérico con reintento", async () => {
    paginatedThrows = new Error("backend caído");
    renderAt("/estudiante/solicitudes");

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText(/no pudimos cargar tus solicitudes/i)).toBeDefined();

    paginatedThrows = null;
    paginatedState = estadoPaginado([], "Exhausted");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Aún no tienes solicitudes registradas.")).toBeDefined();
  });
});

describe("detalle propio del Estudiante (TI2-89)", () => {
  test("el titular ve estado, fecha y necesidades sin filtrar terceros", async () => {
    mockedDetail = detallePropio({ _id: "req-1" });
    renderAt("/estudiante/solicitudes/req-1");

    expect(await screen.findByRole("heading", { name: "Detalle de la solicitud" })).toBeDefined();
    expect(screen.getByText("En revisión")).toBeDefined();
    expect(screen.getByText("Apoyo ficticio para la prueba")).toBeDefined();
    expect(screen.getByRole("link", { name: "Volver a solicitudes" })).toBeDefined();
  });

  test("la solicitud ajena muestra denegación permanente sin reintento ni contenido", async () => {
    detailThrows = new ConvexError("No autorizado");
    renderAt("/estudiante/solicitudes/req-ajena");

    expect(await screen.findByText("No tienes acceso a esta solicitud.")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toMatch(/no tienes acceso/i);
    expect(screen.queryByText(/apoyo ficticio/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    expect(screen.getByRole("link", { name: "Volver a solicitudes" })).toBeDefined();
  });

  test("el fallo transitorio del detalle conserva aviso con reintento", async () => {
    detailThrows = new Error("backend caído");
    renderAt("/estudiante/solicitudes/req-1");

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText(/no pudimos cargar el detalle/i)).toBeDefined();

    detailThrows = null;
    mockedDetail = detallePropio({ _id: "req-1" });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Apoyo ficticio para la prueba")).toBeDefined();
  });
});

describe("guard del listado propio (TI2-89)", () => {
  test("otra población ve denegado sin contenido protegido", async () => {
    mockedSession = SESION_PERSONAL;
    mockedPair = {
      session: SESION_PERSONAL,
      role: { status: "authenticated", role: "professional", email: "pro@uct.cl" },
    };
    paginatedState = estadoPaginado([filaPropia()], "Exhausted");
    const { router } = renderAt("/estudiante/solicitudes");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(await screen.findByRole("heading", { name: "Acceso denegado" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Mis solicitudes" })).toBeNull();
  });

  test("sin sesión redirige al acceso conservando el retorno", async () => {
    mockedSession = SIN_SESION;
    mockedPair = PAR_SIN_SESION;
    const { router } = renderAt("/estudiante/solicitudes");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({
      redirect: "/estudiante/solicitudes",
    });
    expect(screen.queryByRole("heading", { name: "Mis solicitudes" })).toBeNull();
  });
});
