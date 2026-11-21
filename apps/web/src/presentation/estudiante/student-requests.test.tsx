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
 * se simulan por módulo porque `convex/react` no distingue referencias del
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

type ActionOutcome = import("./student-request-actions.ts").OwnRequestActionOutcome;
const cancelOwnRequest = vi.fn<(requestId: string, reason: string) => Promise<ActionOutcome>>();
const respondToInformation =
  vi.fn<(requestId: string, response: string) => Promise<ActionOutcome>>();

let backendConnected = true;

// La traducción de errores y lo que envía cada hook se prueban en
// `student-request-actions.test.ts`; acá cada acción entrega directamente su
// desenlace.
vi.mock("./student-request-actions.ts", () => ({
  useCancelOwnRequest: () => cancelOwnRequest,
  useRespondToInformationRequest: () => respondToInformation,
  useBackendConnected: () => backendConnected,
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
  overrides: Partial<{
    _id: string;
    status: OwnRequestItem["status"];
    createdAt: number;
    accessNeeds: string;
  }> = {},
): OwnRequestItem {
  return {
    _id: (overrides._id ?? "req-1") as Id<"requests">,
    studentId: "stu-1" as Id<"users">,
    status: overrides.status ?? "received",
    accessNeeds: overrides.accessNeeds ?? "Apoyo ficticio para la prueba",
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
  overrides: Partial<Omit<OwnRequestDetail, "_id" | "studentId">> & { _id?: string } = {},
): OwnRequestDetail {
  const { _id, ...rest } = overrides;
  return {
    status: "under_review",
    accessNeeds: "Apoyo ficticio para la prueba",
    createdAt: 1700000000000,
    ...rest,
    _id: (_id ?? "req-1") as Id<"requests">,
    studentId: "stu-1" as Id<"users">,
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
  cancelOwnRequest.mockReset();
  respondToInformation.mockReset();
  backendConnected = true;
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

  test("TI2-149: separa en curso de finalizadas y muestra las necesidades de acceso", async () => {
    paginatedState = estadoPaginado(
      [
        filaPropia({
          _id: "req-1",
          status: "awaiting_information_or_acceptance",
          accessNeeds: [
            "Comunicación escrita",
            "Persona de apoyo",
            "Reducción de estímulos",
            "Otra ficticia",
          ].join("\n"),
        }),
        filaPropia({ _id: "req-2", status: "cancelled" }),
      ],
      "Exhausted",
    );
    renderAt("/estudiante/solicitudes");

    const enCurso = await screen.findByRole("region", { name: "En curso (1)" });
    const finalizadas = screen.getByRole("region", { name: "Finalizadas (1)" });
    expect(enCurso.textContent).toContain("Esperando información o aceptación");
    expect(enCurso.textContent).toContain("Comunicación escrita");
    // Tres necesidades a la vista; el resto se resume y el detalle muestra todas.
    expect(enCurso.textContent).toContain("y 1 más");
    expect(enCurso.textContent).not.toContain("Otra ficticia");
    expect(finalizadas.textContent).toContain("Cancelada");
    expect(
      screen.getAllByRole("link", { name: /Ver detalle/ }).map((link) => link.getAttribute("href")),
    ).toEqual(["/estudiante/solicitudes/req-1", "/estudiante/solicitudes/req-2"]);
  });

  test("TI2-149: con páginas por cargar no afirma totales ni que no hay solicitudes en curso", async () => {
    paginatedState = estadoPaginado(
      [filaPropia({ _id: "req-1", status: "cancelled" })],
      "CanLoadMore",
    );
    renderAt("/estudiante/solicitudes");

    const enCurso = await screen.findByRole("region", { name: "En curso" });
    expect(enCurso.textContent).toContain("No hay solicitudes en curso entre las cargadas.");
    expect(screen.getByRole("region", { name: "Finalizadas" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Cargar más" })).toBeDefined();
  });

  test("TI2-149: sin solicitudes explica el proceso y ofrece empezar", async () => {
    paginatedState = estadoPaginado([], "Exhausted");
    renderAt("/estudiante/solicitudes");

    expect(await screen.findByRole("heading", { name: "Aún no tienes solicitudes" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "CERETI la revisa" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Enviar mi primera solicitud" }).getAttribute("href"),
    ).toBe("/estudiante/solicitudes/nueva");
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
    expect(screen.queryByRole("heading", { name: "Aún no tienes solicitudes" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(loadMore).toHaveBeenCalledTimes(1);
    view.unmount();
    renderAt("/estudiante/solicitudes");
    expect(await screen.findByText("Recibida")).toBeDefined();
  });

  test("la página vacía agotada muestra el vacío explícito", async () => {
    paginatedState = estadoPaginado([], "Exhausted");
    renderAt("/estudiante/solicitudes");

    expect(await screen.findByRole("heading", { name: "Aún no tienes solicitudes" })).toBeDefined();
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
    expect(await screen.findByRole("heading", { name: "Aún no tienes solicitudes" })).toBeDefined();
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

  // TI2-181: el código del contrato común y el texto de Sprint 1, que se sigue
  // aceptando mientras Web y Convex se despliegan por separado.
  test.each([
    ["el código del contrato común", { code: "unauthorized", message: "No autorizado" }],
    ["el texto de Sprint 1", "No autorizado"],
  ])(
    "la solicitud ajena con %s muestra denegación permanente sin reintento ni contenido",
    async (_, data) => {
      // El SDK decora el mensaje con su contexto; el valor canónico viaja en `data`.
      const denial = new ConvexError<string | { code: string; message: string }>(data);
      denial.message =
        "[CONVEX Q(presentation/requests:getRequest)] [Request ID: abc123] Server Error: No autorizado";
      detailThrows = denial;
      renderAt("/estudiante/solicitudes/req-ajena");

      expect(await screen.findByText("No tienes acceso a esta solicitud.")).toBeDefined();
      expect(screen.getByRole("alert").textContent).toMatch(/no tienes acceso/i);
      expect(screen.queryByText(/apoyo ficticio/i)).toBeNull();
      expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
      expect(screen.getByRole("link", { name: "Volver a solicitudes" })).toBeDefined();
    },
  );

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

describe("estado, respuesta y cancelación de la solicitud propia (TI2-153)", () => {
  test.each([
    ["received", "Recibida", /CERETI recibió tu solicitud/],
    ["under_review", "En revisión", /está revisando tu solicitud/],
    [
      "awaiting_information_or_acceptance",
      "Esperando información o aceptación",
      /necesita tu respuesta/,
    ],
    ["accepted", "Aceptada", /abrió tu acompañamiento/],
    ["referred", "Derivada", /derivó tu solicitud a otra unidad/],
    ["closed_without_accompaniment", "Cerrada sin acompañamiento", /sin abrir un acompañamiento/],
    ["cancelled", "Cancelada", /Cancelaste esta solicitud/],
  ] as const)("el estado %s se nombra y se explica", async (status, label, description) => {
    mockedDetail = detallePropio({ status });
    renderAt("/estudiante/solicitudes/req-1");

    expect(await screen.findByText(label)).toBeDefined();
    expect(screen.getByText(description)).toBeDefined();
  });

  test("en espera muestra lo pedido y ofrece responder y cancelar", async () => {
    mockedDetail = detallePropio({
      status: "awaiting_information_or_acceptance",
      informationRequest: "Indica tu horario ficticio de clases.",
    });
    renderAt("/estudiante/solicitudes/req-1");

    expect(await screen.findByText("Indica tu horario ficticio de clases.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Responder a CERETI" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancelar solicitud" })).toBeDefined();
  });

  test("en revisión solo ofrece cancelar", async () => {
    mockedDetail = detallePropio({ status: "under_review" });
    renderAt("/estudiante/solicitudes/req-1");

    expect(await screen.findByRole("button", { name: "Cancelar solicitud" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Responder a CERETI" })).toBeNull();
  });

  test.each(["accepted", "referred", "closed_without_accompaniment", "cancelled"] as const)(
    "la solicitud %s no ofrece acciones",
    async (status) => {
      mockedDetail = detallePropio({ status });
      renderAt("/estudiante/solicitudes/req-1");

      expect(await screen.findByRole("heading", { name: "Estado" })).toBeDefined();
      expect(screen.queryByRole("button", { name: "Cancelar solicitud" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Responder a CERETI" })).toBeNull();
    },
  );

  test("responder confirma en un diálogo, anuncia el envío y devuelve el foco al estado", async () => {
    mockedDetail = detallePropio({
      status: "awaiting_information_or_acceptance",
      informationRequest: "Indica tu horario ficticio.",
    });
    respondToInformation.mockResolvedValue({ status: "done" });
    renderAt("/estudiante/solicitudes/req-1");

    fireEvent.click(await screen.findByRole("button", { name: "Responder a CERETI" }));
    const dialog = screen.getByRole("dialog", { name: "Responder a CERETI" });
    const field = screen.getByLabelText(/Tu respuesta/);
    expect(document.activeElement).toBe(field);
    expect(dialog.getAttribute("aria-modal")).toBe("true");

    fireEvent.change(field, { target: { value: "Martes y jueves por la tarde." } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar respuesta" }));

    expect(await screen.findByText(/Enviamos tu respuesta/)).toBeDefined();
    expect(respondToInformation).toHaveBeenCalledWith("req-1", "Martes y jueves por la tarde.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement?.textContent).toContain("Esperando información o aceptación");
  });

  test("cancelar pide confirmación y Escape cierra sin cancelar, con foco en el botón", async () => {
    mockedDetail = detallePropio({ status: "received" });
    renderAt("/estudiante/solicitudes/req-1");

    const open = await screen.findByRole("button", { name: "Cancelar solicitud" });
    open.focus();
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog", { name: "¿Cancelar esta solicitud?" });
    expect(dialog.textContent).toMatch(/no podrás retomarla/);

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(open);
    expect(cancelOwnRequest).not.toHaveBeenCalled();
  });

  test("el diálogo mantiene Tab dentro de sus controles", async () => {
    mockedDetail = detallePropio({ status: "received" });
    renderAt("/estudiante/solicitudes/req-1");

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar solicitud" }));
    const dialog = screen.getByRole("dialog");
    const confirm = screen.getByRole("button", { name: "Sí, cancelar solicitud" });
    confirm.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });

    expect(document.activeElement).toBe(screen.getByLabelText(/Motivo de la cancelación/));
  });

  test("una cancelación que el Backend rechaza explica el motivo y no anuncia éxito", async () => {
    mockedDetail = detallePropio({ status: "under_review" });
    cancelOwnRequest.mockResolvedValue({
      status: "rejected",
      message: "La solicitud no admite la cancelación en su estado actual.",
    });
    renderAt("/estudiante/solicitudes/req-1");

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar solicitud" }));
    const field = screen.getByLabelText(/Motivo de la cancelación/);
    fireEvent.change(field, { target: { value: "Ya no lo necesito." } });
    fireEvent.click(screen.getByRole("button", { name: "Sí, cancelar solicitud" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/no admite la cancelación en su estado actual/);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.queryByText("Cancelaste la solicitud.")).toBeNull();
  });

  test.each([
    ["denied", /No puedes hacer esto con esta solicitud/],
    ["failed", /No pudimos completar la acción/],
  ] as const)("el desenlace %s se explica sin éxito falso", async (status, message) => {
    mockedDetail = detallePropio({ status: "received" });
    cancelOwnRequest.mockResolvedValue({ status });
    renderAt("/estudiante/solicitudes/req-1");

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar solicitud" }));
    fireEvent.change(screen.getByLabelText(/Motivo de la cancelación/), {
      target: { value: "Motivo ficticio." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sí, cancelar solicitud" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(message);
    expect(screen.queryByText("Cancelaste la solicitud.")).toBeNull();
  });

  // `failed` llega por un error del servidor o un código inesperado, nunca por
  // red caída: el mensaje no culpa a la conexión y ofrece cómo seguir.
  test("el fallo no culpa a la conexión, conserva el texto y devuelve el foco al campo", async () => {
    mockedDetail = detallePropio({ status: "received" });
    cancelOwnRequest.mockResolvedValue({ status: "failed" });
    renderAt("/estudiante/solicitudes/req-1");

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar solicitud" }));
    const field = screen.getByLabelText(/Motivo de la cancelación/);
    fireEvent.change(field, { target: { value: "Motivo ficticio." } });
    // En el navegador el clic deja el foco en el botón; jsdom no lo mueve solo.
    const confirm = screen.getByRole("button", { name: "Sí, cancelar solicitud" });
    confirm.focus();
    fireEvent.click(confirm);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/conexión/i);
    expect(alert.textContent).toMatch(/Lo que escribiste se conserva/);
    expect(alert.textContent).toMatch(/canales oficiales/);
    expect((field as HTMLTextAreaElement).value).toBe("Motivo ficticio.");
    expect(document.activeElement).toBe(field);
  });

  test("con conexión, el envío en curso no se cierra con Escape ni con el botón", async () => {
    mockedDetail = detallePropio({ status: "received" });
    cancelOwnRequest.mockReturnValue(new Promise(() => {}));
    renderAt("/estudiante/solicitudes/req-1");

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar solicitud" }));
    fireEvent.change(screen.getByLabelText(/Motivo de la cancelación/), {
      target: { value: "Motivo ficticio." },
    });
    const confirm = screen.getByRole("button", { name: "Sí, cancelar solicitud" });
    confirm.focus();
    fireEvent.click(confirm);
    const sending = await screen.findByRole("button", { name: "Cancelando…" });

    // Conserva el foco (no `disabled`) y no envía dos veces.
    expect(sending.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(sending);
    fireEvent.click(sending);
    expect(cancelOwnRequest).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "No, mantener solicitud" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByText(/Sin conexión con CERETI/)).toBeNull();
  });

  // Convex retiene la mutación sin conexión y la reenvía al volver: la promesa
  // no termina, así que el diálogo avisa la espera y deja salir.
  test("sin conexión, el diálogo avisa que espera y permite salir", async () => {
    mockedDetail = detallePropio({ status: "received" });
    backendConnected = false;
    cancelOwnRequest.mockReturnValue(new Promise(() => {}));
    renderAt("/estudiante/solicitudes/req-1");

    const open = await screen.findByRole("button", { name: "Cancelar solicitud" });
    open.focus();
    fireEvent.click(open);
    fireEvent.change(screen.getByLabelText(/Motivo de la cancelación/), {
      target: { value: "Motivo ficticio." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sí, cancelar solicitud" }));

    expect(await screen.findByText(/Sin conexión con CERETI/)).toBeDefined();
    const dismiss = screen.getByRole("button", {
      name: "No, mantener solicitud",
    }) as HTMLButtonElement;
    expect(dismiss.disabled).toBe(false);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  test("si el desenlace llega con el diálogo cerrado, se anuncia igual", async () => {
    mockedDetail = detallePropio({ status: "received" });
    backendConnected = false;
    let settle: (outcome: ActionOutcome) => void = () => {};
    cancelOwnRequest.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    renderAt("/estudiante/solicitudes/req-1");

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar solicitud" }));
    fireEvent.change(screen.getByLabelText(/Motivo de la cancelación/), {
      target: { value: "Motivo ficticio." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sí, cancelar solicitud" }));
    await screen.findByText(/Sin conexión con CERETI/);
    fireEvent.click(screen.getByRole("button", { name: "No, mantener solicitud" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    settle({
      status: "rejected",
      message: "La solicitud no admite la cancelación en su estado actual.",
    });

    expect(
      await screen.findByText("La solicitud no admite la cancelación en su estado actual."),
    ).toBeDefined();
    expect(screen.queryByText("Cancelaste la solicitud.")).toBeNull();
  });

  // El nuevo estado llega por la query reactiva, no por la acción: la vista no lo deduce.
  test("la cancelación exitosa se anuncia y devuelve el foco al estado", async () => {
    mockedDetail = detallePropio({ status: "received" });
    cancelOwnRequest.mockResolvedValue({ status: "done" });
    renderAt("/estudiante/solicitudes/req-1");

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar solicitud" }));
    fireEvent.change(screen.getByLabelText(/Motivo de la cancelación/), {
      target: { value: "Ya no lo necesito." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sí, cancelar solicitud" }));

    expect(await screen.findByText("Cancelaste la solicitud.")).toBeDefined();
    expect(cancelOwnRequest).toHaveBeenCalledWith("req-1", "Ya no lo necesito.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement?.textContent).toContain("Recibida");
  });

  test("la cerrada sin acompañamiento muestra la razón del cierre", async () => {
    mockedDetail = detallePropio({
      status: "closed_without_accompaniment",
      closureReason: "La necesidad ficticia corresponde a otra unidad.",
    });
    renderAt("/estudiante/solicitudes/req-1");

    expect(await screen.findByText("Razón del cierre")).toBeDefined();
    expect(screen.getByText("La necesidad ficticia corresponde a otra unidad.")).toBeDefined();
  });

  test("la derivada muestra la unidad de destino y el motivo", async () => {
    mockedDetail = detallePropio({
      status: "referred",
      outgoingReferral: {
        destinationUnit: "Unidad Ficticia",
        referredAt: 1700000000000,
        reason: "Motivo ficticio de derivación.",
      },
    });
    renderAt("/estudiante/solicitudes/req-1");

    expect(await screen.findByText("Unidad Ficticia")).toBeDefined();
    expect(screen.getByText("Motivo ficticio de derivación.")).toBeDefined();
  });

  test("la aceptada enlaza con su acompañamiento", async () => {
    mockedDetail = detallePropio({
      status: "accepted",
      accompanimentId: "acc-1" as Id<"accompaniments">,
    });
    renderAt("/estudiante/solicitudes/req-1");

    const link = await screen.findByRole("link", { name: "Ver mi acompañamiento" });
    expect(link.getAttribute("href")).toBe("/estudiante/acompanamientos/acc-1");
  });

  test("la respuesta enviada se conserva en el detalle", async () => {
    mockedDetail = detallePropio({
      status: "under_review",
      informationResponse: "Respuesta ficticia ya enviada.",
    });
    renderAt("/estudiante/solicitudes/req-1");

    expect(await screen.findByText("Tu última respuesta")).toBeDefined();
    expect(screen.getByText("Respuesta ficticia ya enviada.")).toBeDefined();
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
