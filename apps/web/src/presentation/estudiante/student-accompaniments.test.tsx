// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { OwnAccompanimentDetail } from "./student-accompaniments-data.ts";

/**
 * Pruebas del detalle del acompañamiento propio del Estudiante (TI2-90).
 *
 * Integración por el router real (incluye guards): la sesión simulada es de
 * Estudiante titular, salvo los casos de denegación. Las queries de datos
 * se simulan por módulo porque `convex/react` no distingue referencias del
 * `api` generado (crea un objeto nuevo por acceso); el cableado real
 * query→referencia lo cubren `tsc`, el build y la verificación manual contra
 * el entorno ficticio de TI2-30. Todos los datos son ficticios. Nunca se
 * llama a `getInternalNotes` desde esta superficie.
 */

let mockedSession: WebSessionState;
let mockedPair:
  | {
      session: WebSessionState;
      role: WebSessionRole;
    }
  | undefined;
let mockedBackendConfigured = true;

let mockedDetail: OwnAccompanimentDetail | undefined;
let detailThrows: Error | null = null;

let mockedPortalAccompaniments:
  | { page: OwnAccompanimentDetail[]; isDone: boolean; continueCursor: string }
  | undefined;

vi.mock("convex/react", () => ({ useQuery: () => mockedSession }));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () => mockedPair,
}));

vi.mock("./student-accompaniments-data.ts", () => ({
  useOwnAccompanimentDetail: () => {
    if (detailThrows !== null) {
      throw detailThrows;
    }
    return mockedDetail;
  },
}));

vi.mock("../routes/student-panel-data.ts", () => ({
  useStudentSession: () => mockedSession,
  useStudentRequests: () => ({ page: [], isDone: true, continueCursor: "" }),
  useStudentAccompaniments: () => mockedPortalAccompaniments,
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

function detallePropio(
  overrides: Partial<{ _id: string; status: "active" | "paused" | "closed" }> = {},
): OwnAccompanimentDetail {
  return {
    _id: (overrides._id ?? "acc-1") as Id<"accompaniments">,
    studentId: "stu-1" as Id<"users">,
    status: overrides.status ?? "active",
    objective: "Objetivo ficticio del acompañamiento",
    accessNeeds: "Apoyo ficticio para la prueba",
    view: "full",
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
  mockedDetail = undefined;
  detailThrows = null;
  mockedPortalAccompaniments = undefined;
});

afterEach(() => {
  cleanup();
});

describe("detalle del acompañamiento propio (TI2-90)", () => {
  test("el titular ve estado, objetivo y necesidades propias sin notas internas", async () => {
    mockedDetail = detallePropio({ _id: "acc-1" });
    renderAt("/estudiante/acompanamientos/acc-1");

    expect(await screen.findByRole("heading", { name: "Detalle del acompañamiento" }))
      .toBeDefined();
    expect(screen.getByText("Activo")).toBeDefined();
    expect(screen.getByText("Objetivo ficticio del acompañamiento")).toBeDefined();
    expect(screen.getByText("Apoyo ficticio para la prueba")).toBeDefined();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toBeDefined();
    expect(screen.getByText(/historial básico/i)).toBeDefined();
  });

  test("el acompañamiento ajeno se deniega sin revelar su contenido", async () => {
    detailThrows = new Error("No autorizado");
    renderAt("/estudiante/acompanamientos/acc-ajeno");

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText(/no pudimos cargar el detalle/i)).toBeDefined();
    expect(screen.queryByText(/objetivo ficticio/i)).toBeNull();
    expect(screen.queryByText(/apoyo ficticio/i)).toBeNull();
  });

  test("el acompañamiento cerrado conserva su vista en solo lectura", async () => {
    mockedDetail = detallePropio({ _id: "acc-1", status: "closed" });
    renderAt("/estudiante/acompanamientos/acc-1");

    expect(await screen.findByRole("heading", { name: "Detalle del acompañamiento" }))
      .toBeDefined();
    expect(screen.getByText("Cerrado")).toBeDefined();
    expect(screen.getByText(/solo lectura/i)).toBeDefined();
    expect(screen.getByText("Objetivo ficticio del acompañamiento")).toBeDefined();
  });

  test("el acompañamiento pausado muestra su estado con texto", async () => {
    mockedDetail = detallePropio({ _id: "acc-1", status: "paused" });
    renderAt("/estudiante/acompanamientos/acc-1");

    expect(await screen.findByText("Pausado")).toBeDefined();
    expect(screen.queryByText(/solo lectura/i)).toBeNull();
  });

  test("la carga inicial muestra el estado sin contenido", async () => {
    mockedDetail = undefined;
    renderAt("/estudiante/acompanamientos/acc-1");

    expect(await screen.findByRole("status")).toBeDefined();
    expect(screen.getByText(/cargando el detalle/i)).toBeDefined();
  });

  test("el fallo de red muestra aviso genérico con reintento", async () => {
    detailThrows = new Error("backend caído");
    renderAt("/estudiante/acompanamientos/acc-1");

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText(/no pudimos cargar el detalle/i)).toBeDefined();

    detailThrows = null;
    mockedDetail = detallePropio({ _id: "acc-1" });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Objetivo ficticio del acompañamiento")).toBeDefined();
  });
});

describe("enlace del portal al detalle (TI2-90)", () => {
  test("cada acompañamiento del portal enlaza a su detalle", async () => {
    mockedPortalAccompaniments = {
      page: [detallePropio({ _id: "acc-1" })],
      isDone: true,
      continueCursor: "",
    };
    renderAt("/estudiante");

    const enlace = await screen.findByRole("link", { name: /objetivo ficticio/i });
    expect(enlace.getAttribute("href")).toContain("/estudiante/acompanamientos/acc-1");
  });
});

describe("guard del detalle propio (TI2-90)", () => {
  test("otra población ve denegado sin contenido protegido", async () => {
    mockedSession = SESION_PERSONAL;
    mockedPair = {
      session: SESION_PERSONAL,
      role: { status: "authenticated", role: "professional", email: "pro@uct.cl" },
    };
    mockedDetail = detallePropio({ _id: "acc-1" });
    const { router } = renderAt("/estudiante/acompanamientos/acc-1");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(await screen.findByRole("heading", { name: "Acceso denegado" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Detalle del acompañamiento" })).toBeNull();
  });

  test("sin sesión redirige al acceso conservando el retorno", async () => {
    mockedSession = SIN_SESION;
    mockedPair = PAR_SIN_SESION;
    const { router } = renderAt("/estudiante/acompanamientos/acc-1");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({
      redirect: "/estudiante/acompanamientos/acc-1",
    });
    expect(screen.queryByRole("heading", { name: "Detalle del acompañamiento" })).toBeNull();
  });
});
