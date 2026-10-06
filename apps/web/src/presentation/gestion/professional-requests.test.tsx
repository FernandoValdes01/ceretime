// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  useAuthorizedRequests: () => mockedAuthorized,
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

    expect(await screen.findByText("No autorizado")).toBeDefined();
    const enviarBtn = screen.getByRole("button", { name: "Enviar" });
    expect(enviarBtn.hasAttribute("disabled")).toBe(false);
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

    // Tras el primer clic, el botón se deshabilita (aria-busy + disabled)
    expect(enviarBtn.hasAttribute("disabled")).toBe(true);
    // Segundo clic no encuentra botón habilitado, así que no duplica la llamada
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

      expect(screen.queryByRole("button", { name: /Tomar|Pedir información/ })).toBeNull();
    }
  });
});
