// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type {
  AppointmentCalendarFile,
  AppointmentCalendarResult,
  OwnAccompanimentDetail,
  OwnAppointmentSummary,
} from "./student-accompaniments-data.ts";
import type { DownloadableCalendarFile } from "./calendar-download.ts";

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

let mockedAppointments: OwnAppointmentSummary[] | undefined;
let mockedConnection: { connected: boolean } | undefined;
let mockedAddResult: AppointmentCalendarResult | (() => Promise<AppointmentCalendarResult>);
let mockedCalendarFile: AppointmentCalendarFile;
let addCalls: string[] = [];
let fileCalls: string[] = [];
let downloadedFiles: DownloadableCalendarFile[] = [];
let linkSocialCalls: Array<Record<string, unknown>> = [];

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
  useOwnAccompanimentAppointments: () => mockedAppointments,
  useCalendarConnection: () => mockedConnection,
  useAddAppointmentToGoogleCalendar: () => async (input: { appointmentId: string }) => {
    addCalls.push(input.appointmentId);
    return typeof mockedAddResult === "function" ? await mockedAddResult() : mockedAddResult;
  },
  useAppointmentCalendarFile: () => async (appointmentId: string) => {
    fileCalls.push(appointmentId);
    return mockedCalendarFile;
  },
}));

vi.mock("./calendar-download.ts", () => ({
  downloadCalendarFile: (file: DownloadableCalendarFile) => {
    downloadedFiles.push(file);
  },
}));

vi.mock("../routes/student-panel-data.ts", () => ({
  useStudentSession: () => mockedSession,
  useStudentRequests: () => ({ page: [], isDone: true, continueCursor: "" }),
  useStudentAccompaniments: () => mockedPortalAccompaniments,
}));

vi.mock("../../infrastructure/auth/auth-client", () => ({
  authClient: {
    useSession: () => ({ isPending: false }),
    linkSocial: async (input: Record<string, unknown>) => {
      linkSocialCalls.push(input);
      return { data: {}, error: null };
    },
  },
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

const INICIO_ATENCION = Date.UTC(2026, 2, 10, 16, 0, 0);
const FIN_ATENCION = Date.UTC(2026, 2, 10, 17, 0, 0);

const ARCHIVO_ICS: AppointmentCalendarFile = {
  fileName: "atencion-programada.ics",
  content: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n",
  alreadyAdded: false,
};

function atencion(overrides: Partial<OwnAppointmentSummary> = {}): OwnAppointmentSummary {
  return {
    appointmentId: "apt-1",
    status: "scheduled",
    startAt: INICIO_ATENCION,
    endAt: FIN_ATENCION,
    modality: "online",
    calendarAdded: false,
    ...overrides,
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
  mockedAppointments = [];
  mockedConnection = { connected: false };
  mockedAddResult = { status: "fallback", reason: "not_connected", ics: ARCHIVO_ICS };
  mockedCalendarFile = ARCHIVO_ICS;
  addCalls = [];
  fileCalls = [];
  downloadedFiles = [];
  linkSocialCalls = [];
  mockedPortalAccompaniments = undefined;
});

afterEach(() => {
  cleanup();
});

describe("detalle del acompañamiento propio (TI2-90)", () => {
  test("el titular ve estado, objetivo y necesidades propias sin notas internas", async () => {
    mockedDetail = detallePropio({ _id: "acc-1" });
    renderAt("/estudiante/acompanamientos/acc-1");

    expect(
      await screen.findByRole("heading", { name: "Detalle del acompañamiento" }),
    ).toBeDefined();
    expect(screen.getByText("Activo")).toBeDefined();
    expect(screen.getByText("Objetivo ficticio del acompañamiento")).toBeDefined();
    expect(screen.getByText("Apoyo ficticio para la prueba")).toBeDefined();
    expect(screen.getAllByRole("link", { name: "Volver al inicio" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Atenciones" })).toBeDefined();
    expect(screen.getByText(/aún no tienes atenciones registradas/i)).toBeDefined();
  });

  test("el acompañamiento ajeno muestra denegación permanente sin reintento ni contenido", async () => {
    // El SDK decora el mensaje con su contexto; el valor canónico viaja en `data`.
    const denial = new ConvexError("No autorizado");
    denial.message =
      "[CONVEX Q(presentation/accompaniments:getAccompaniment)] [Request ID: abc123] Server Error: No autorizado";
    detailThrows = denial;
    renderAt("/estudiante/acompanamientos/acc-ajeno");

    expect(await screen.findByText("No tienes acceso a este acompañamiento.")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toMatch(/no tienes acceso/i);
    expect(screen.queryByText(/objetivo ficticio/i)).toBeNull();
    expect(screen.queryByText(/apoyo ficticio/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toBeDefined();
  });

  test("el acompañamiento cerrado conserva su vista en solo lectura", async () => {
    mockedDetail = detallePropio({ _id: "acc-1", status: "closed" });
    renderAt("/estudiante/acompanamientos/acc-1");

    expect(
      await screen.findByRole("heading", { name: "Detalle del acompañamiento" }),
    ).toBeDefined();
    expect(screen.getByText("Cerrado")).toBeDefined();
    expect(
      screen.getByText("Este acompañamiento está cerrado y se muestra en solo lectura."),
    ).toBeDefined();
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

describe("calendario por atención (TI2-122)", () => {
  test("muestra la conexión y descarga el .ics de una atención propia", async () => {
    mockedDetail = detallePropio();
    mockedAppointments = [atencion()];
    renderAt("/estudiante/acompanamientos/acc-1");

    expect(await screen.findByText("Google Calendar no está conectado.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Conectar Google Calendar" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /descargar el archivo .ics/i }));
    await waitFor(() => expect(downloadedFiles).toEqual([ARCHIVO_ICS]));
    expect(fileCalls).toEqual(["apt-1"]);
    expect(await screen.findByText("Descargamos el archivo .ics de esta atención.")).toBeDefined();
  });

  test("el botón de conexión pide solo el alcance de Calendar", async () => {
    mockedDetail = detallePropio();
    renderAt("/estudiante/acompanamientos/acc-1");

    fireEvent.click(await screen.findByRole("button", { name: "Conectar Google Calendar" }));
    await waitFor(() => expect(linkSocialCalls).toHaveLength(1));
    expect(linkSocialCalls[0]).toMatchObject({
      provider: "google",
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
    });
  });

  test("agrega la atención al Google Calendar con una acción explícita", async () => {
    mockedDetail = detallePropio();
    mockedConnection = { connected: true };
    mockedAppointments = [atencion()];
    mockedAddResult = { status: "created", eventId: "event-1", ics: ARCHIVO_ICS };
    renderAt("/estudiante/acompanamientos/acc-1");

    fireEvent.click(
      await screen.findByRole("button", { name: /agregar a google calendar la atención/i }),
    );
    await waitFor(() => expect(addCalls).toEqual(["apt-1"]));
    expect(await screen.findByText("Agregamos la atención a tu Google Calendar.")).toBeDefined();
  });

  test("un fallo del proveedor deja la atención visible y ofrece el .ics de respaldo", async () => {
    mockedDetail = detallePropio();
    mockedConnection = { connected: true };
    mockedAppointments = [atencion()];
    mockedAddResult = { status: "fallback", reason: "unavailable", ics: ARCHIVO_ICS };
    renderAt("/estudiante/acompanamientos/acc-1");

    fireEvent.click(
      await screen.findByRole("button", { name: /agregar a google calendar la atención/i }),
    );
    expect(
      await screen.findByText(/no pudimos agregar la atención a google calendar/i),
    ).toBeDefined();
    // La reserva sigue visible: el fallo externo no oculta ni altera la atención.
    expect(screen.getByText(/Programada · En línea/)).toBeDefined();
    expect(screen.queryByText(/error_description|access_token|refresh_token/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Descargar .ics de respaldo" }));
    expect(downloadedFiles).toEqual([ARCHIVO_ICS]);
  });

  test("no ofrece agregar una atención que ya está en el calendario", async () => {
    mockedDetail = detallePropio();
    mockedConnection = { connected: true };
    mockedAppointments = [atencion({ calendarAdded: true })];
    renderAt("/estudiante/acompanamientos/acc-1");

    expect(await screen.findByText(/agregada a google calendar/i)).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /agregar a google calendar la atención/i }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /descargar el archivo .ics/i })).toBeDefined();
  });

  test("el acompañamiento cerrado muestra las atenciones sin acciones de calendario", async () => {
    mockedDetail = detallePropio({ status: "closed" });
    mockedAppointments = [atencion()];
    renderAt("/estudiante/acompanamientos/acc-1");

    expect(await screen.findByText(/sin acciones de calendario/i)).toBeDefined();
    expect(screen.getByText(/Programada · En línea/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /descargar el archivo .ics/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /conectar google calendar/i })).toBeNull();
  });

  test("el retorno del consentimiento muestra un aviso genérico", async () => {
    mockedDetail = detallePropio();
    mockedConnection = { connected: true };
    mockedAppointments = [atencion()];
    renderAt("/estudiante/acompanamientos/acc-1?calendar=connected");

    expect(await screen.findByText(/google calendar quedó conectado/i)).toBeDefined();
    expect(screen.getByText("Google Calendar está conectado.")).toBeDefined();
  });

  test("un consentimiento fallido no bloquea el .ics", async () => {
    mockedDetail = detallePropio();
    mockedAppointments = [atencion()];
    renderAt("/estudiante/acompanamientos/acc-1?calendar=error");

    expect(await screen.findByText(/no pudimos conectar google calendar/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /descargar el archivo .ics/i })).toBeDefined();
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
