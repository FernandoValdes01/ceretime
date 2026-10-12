// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { OwnRequestDetail, OwnRequestsPage } from "./student-requests-data.ts";

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

let mockedSession: WebSessionState;
let mockedPair:
  | {
      session: WebSessionState;
      role: WebSessionRole;
    }
  | undefined;
let mockedBackendConfigured = true;

let mockedList: OwnRequestsPage | undefined;
let listByCursor: ((cursor: string | null) => OwnRequestsPage | undefined) | null = null;
let listThrows: Error | null = null;
let mockedDetail: OwnRequestDetail | undefined;
let detailThrows: Error | null = null;

vi.mock("convex/react", () => ({ useQuery: () => mockedSession }));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () => mockedPair,
}));

vi.mock("./student-requests-data.ts", () => ({
  PAGE_SIZE: 10,
  useOwnRequests: (cursor: string | null) => {
    if (listThrows !== null) {
      throw listThrows;
    }
    return listByCursor === null ? mockedList : listByCursor(cursor);
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
) {
  return {
    _id: (overrides._id ?? "req-1") as Id<"requests">,
    studentId: "stu-1" as Id<"users">,
    status: overrides.status ?? "received",
    accessNeeds: "Apoyo ficticio para la prueba",
    createdAt: overrides.createdAt ?? 1700000000000,
  };
}

function paginaPropia(
  items: ReturnType<typeof filaPropia>[],
  overrides: Partial<{ isDone: boolean; continueCursor: string }> = {},
): OwnRequestsPage {
  return {
    page: items,
    isDone: overrides.isDone ?? true,
    continueCursor: overrides.continueCursor ?? "",
  };
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
  return { router, unmount: view.unmount };
}

beforeEach(() => {
  mockedSession = SESION_ESTUDIANTE;
  mockedPair = PAR_ESTUDIANTE;
  mockedBackendConfigured = true;
  mockedList = undefined;
  listByCursor = null;
  listThrows = null;
  mockedDetail = undefined;
  detailThrows = null;
});

afterEach(() => {
  cleanup();
});

describe("listado propio del Estudiante (TI2-89)", () => {
  test("el titular ve sus solicitudes con etiquetas y enlace al detalle", async () => {
    mockedList = paginaPropia([filaPropia({ _id: "req-1", status: "under_review" })]);
    renderAt("/estudiante/solicitudes");

    expect(await screen.findByRole("heading", { name: "Mis solicitudes" })).toBeDefined();
    expect(screen.getByText("En revisión")).toBeDefined();
    expect(screen.getByRole("link", { name: /en revisión/i })).toHaveProperty(
      "textContent",
      expect.stringContaining("En revisión"),
    );
  });

  test("el avance de página no pierde ni repite filas", async () => {
    listByCursor = (cursor) => {
      if (cursor === null) {
        return paginaPropia([filaPropia({ _id: "req-1" })], {
          isDone: false,
          continueCursor: "cursor-1",
        });
      }
      return paginaPropia([filaPropia({ _id: "req-2", status: "under_review" })], {
        isDone: true,
        continueCursor: "",
      });
    };
    renderAt("/estudiante/solicitudes");

    expect(await screen.findByText("Recibida")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));

    expect(await screen.findByText("En revisión")).toBeDefined();
    expect(screen.getByText("Recibida")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  test("la página vacía muestra el vacío explícito", async () => {
    mockedList = paginaPropia([]);
    renderAt("/estudiante/solicitudes");

    expect(await screen.findByText("Aún no tienes solicitudes registradas.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  test("la carga inicial muestra el estado sin contenido", async () => {
    mockedList = undefined;
    renderAt("/estudiante/solicitudes");

    expect(await screen.findByRole("status")).toBeDefined();
    expect(screen.getByText(/cargando tus solicitudes/i)).toBeDefined();
  });

  test("el fallo de red muestra aviso genérico con reintento", async () => {
    listThrows = new Error("backend caído");
    renderAt("/estudiante/solicitudes");

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText(/no pudimos cargar tus solicitudes/i)).toBeDefined();

    listThrows = null;
    mockedList = paginaPropia([]);
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

  test("la solicitud ajena se deniega sin revelar existencia", async () => {
    detailThrows = new Error("No autorizado");
    renderAt("/estudiante/solicitudes/req-ajena");

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText(/no pudimos cargar el detalle/i)).toBeDefined();
    expect(screen.queryByText(/apoyo ficticio/i)).toBeNull();
  });
});

describe("guard del listado propio (TI2-89)", () => {
  test("otra población ve denegado sin contenido protegido", async () => {
    mockedSession = SESION_PERSONAL;
    mockedPair = {
      session: SESION_PERSONAL,
      role: { status: "authenticated", role: "professional", email: "pro@uct.cl" },
    };
    mockedList = paginaPropia([filaPropia()]);
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
