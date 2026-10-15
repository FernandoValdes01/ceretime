// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { AgendaPort } from "../../application/agenda/agenda-port.ts";
import { setAgendaPortForTests } from "./professional-availability-data.ts";

/**
 * Pruebas del editor de disponibilidad del Profesional (TI2-103).
 *
 * Integración por el router real (incluye guards): la sesión simulada es de
 * Profesional, salvo los casos de denegación. El puerto de agenda se inyecta
 * por pruebas porque el adaptador ficticio no distingue referencias; el
 * cableado real puerto→adaptador lo cubren `tsc`, el build y la verificación
 * manual contra el entorno ficticio de TI2-30. Todos los datos son ficticios.
 */

let mockedSession: WebSessionState;
let mockedPair:
  | {
      session: WebSessionState;
      role: WebSessionRole;
    }
  | undefined;
let mockedBackendConfigured = true;

vi.mock("convex/react", () => ({ useQuery: () => mockedSession }));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () => mockedPair,
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

const PAR_INTERN = {
  session: SESION_INTERN,
  role: { status: "authenticated", role: "intern", email: "intern@uct.cl" },
} as const;

const SIN_SESION: WebSessionState = { status: "unauthenticated" };

const PAR_SIN_SESION = {
  session: SIN_SESION,
  role: { status: "unauthenticated" },
} as const;

function puertoOk(): AgendaPort {
  return {
    searchSlots: () => Promise.resolve({ status: "empty" }),
    reserveSlot: () =>
      Promise.resolve({
        status: "error",
        error: { code: "no_availability", message: "El cupo ya no está disponible." },
      }),
    listAvailability: () =>
      Promise.resolve({
        status: "ok",
        blocks: [
          {
            id: "bloque-ficticio-1",
            professionalId: "pro-ficticio-1",
            weekday: 1,
            startMinute: 540,
            endMinute: 720,
            slotMinutes: 60,
            modality: "inPerson",
            spaceId: "esp-1",
            version: "v1",
          },
        ],
        exceptions: [
          { date: "2026-05-04", kind: "cancelled", version: "v1" },
          {
            date: "2026-05-05",
            kind: "cancelled",
            blockId: "bloque-ficticio-1",
            version: "v1",
          },
          {
            date: "2026-05-06",
            kind: "added",
            windows: [
              {
                startMinute: 600,
                endMinute: 660,
                slotMinutes: 30,
                modality: "inPerson",
                spaceId: "esp-2",
              },
            ],
            version: "v1",
          },
        ],
      }),
    saveBlock: (input) =>
      Promise.resolve({
        status: "saved",
        block: {
          id: "bloque-ficticio-9",
          professionalId: "pro-ficticio-1",
          ...input,
          version: "v1",
        },
      }),
    saveException: (input) =>
      Promise.resolve({
        status: "saved",
        exception: { ...input, version: "v1" },
      }),
  };
}

function comoProfesional(port: AgendaPort | null = puertoOk()) {
  mockedSession = SESION_PRO;
  mockedPair = PAR_PRO;
  setAgendaPortForTests(port);
}

function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(<RouterProvider router={router} />);
  return { router, unmount: view.unmount };
}

function completarBloqueValido() {
  fireEvent.change(screen.getByLabelText("Día de la semana"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Inicio (HH:MM)"), { target: { value: "09:00" } });
  fireEvent.change(screen.getByLabelText("Término (HH:MM)"), { target: { value: "10:00" } });
  fireEvent.change(screen.getByLabelText("Duración del cupo (minutos)"), {
    target: { value: "30" },
  });
  fireEvent.change(screen.getByLabelText("Modalidad"), { target: { value: "online" } });
}

beforeEach(() => {
  vi.stubEnv("VITE_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("VITE_CONVEX_SITE_URL", "https://test.convex.site");
  sessionStorage.clear();
  mockedSession = undefined;
  mockedPair = undefined;
  mockedBackendConfigured = true;
  setAgendaPortForTests(null);
});

afterEach(() => {
  cleanup();
  setAgendaPortForTests(null);
});

describe("editor de disponibilidad (TI2-103)", () => {
  test("carga muestra estado y luego bloques y excepciones", async () => {
    let resolveList!: (value: Awaited<ReturnType<AgendaPort["listAvailability"]>>) => void;
    const pendiente = new Promise<Awaited<ReturnType<AgendaPort["listAvailability"]>>>(
      (resolve) => {
        resolveList = resolve;
      },
    );
    const port = puertoOk();
    port.listAvailability = () => pendiente;
    comoProfesional(port);
    renderAt("/profesional/disponibilidad");

    expect(await screen.findByText("Cargando la disponibilidad…")).toBeDefined();

    resolveList({
      status: "ok",
      blocks: [
        {
          id: "bloque-ficticio-1",
          professionalId: "pro-ficticio-1",
          weekday: 1,
          startMinute: 540,
          endMinute: 720,
          slotMinutes: 60,
          modality: "inPerson",
          spaceId: "esp-1",
          version: "v1",
        },
      ],
      exceptions: [{ date: "2026-05-04", kind: "cancelled", version: "v1" }],
    });

    expect(await screen.findByText("2026-05-04")).toBeDefined();
    expect(await screen.findByRole("heading", { name: "Bloques recurrentes" })).toBeDefined();
    expect(screen.getAllByText("Lunes").length).toBeGreaterThan(0);
  });

  test("fallo de lectura muestra error y reintenta", async () => {
    const port = puertoOk();
    port.listAvailability = () =>
      Promise.resolve({
        status: "error",
        message: "No pudimos cargar la disponibilidad. Inténtalo de nuevo.",
      });
    comoProfesional(port);
    renderAt("/profesional/disponibilidad");

    expect(
      await screen.findByText("No pudimos cargar la disponibilidad. Inténtalo de nuevo."),
    ).toBeDefined();

    port.listAvailability = () => Promise.resolve({ status: "empty" });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Sin bloques ni excepciones.")).toBeDefined();
  });

  test("denegación muestra aviso genérico sin detalles", async () => {
    const port = puertoOk();
    port.listAvailability = () => Promise.resolve({ status: "denied" });
    comoProfesional(port);
    renderAt("/profesional/disponibilidad");

    expect(
      await screen.findByText("No autorizado. Pide acceso por el canal oficial si corresponde."),
    ).toBeDefined();
    expect(screen.queryByText("Lunes")).toBeNull();
  });

  test("formulario vacío muestra errores de campo legibles", async () => {
    comoProfesional();
    renderAt("/profesional/disponibilidad");

    expect(await screen.findByRole("heading", { name: "Bloques recurrentes" })).toBeDefined();
    expect(screen.getAllByText("Lunes").length).toBeGreaterThan(0);

    const guardarBloque = screen.getByRole("button", { name: "Guardar bloque" });
    fireEvent.click(guardarBloque);

    expect(
      await screen.findByText("Elige un día de la semana entre domingo y sábado."),
    ).toBeDefined();
    expect(screen.getAllByText("Usa el formato HH:MM de 24 horas.").length).toBeGreaterThan(0);
  });

  test("rango invertido y modalidad inconsistente muestran errores asociados", async () => {
    comoProfesional();
    renderAt("/profesional/disponibilidad");

    expect(await screen.findByRole("heading", { name: "Bloques recurrentes" })).toBeDefined();
    expect(screen.getAllByText("Lunes").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Día de la semana"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Inicio (HH:MM)"), { target: { value: "12:00" } });
    fireEvent.change(screen.getByLabelText("Término (HH:MM)"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("Duración del cupo (minutos)"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Modalidad"), { target: { value: "online" } });
    fireEvent.change(screen.getByLabelText("Referencia al espacio (solo presencial)"), {
      target: { value: "esp-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar bloque" }));

    expect(
      await screen.findByText("La hora de término debe ser posterior al inicio."),
    ).toBeDefined();
    expect(
      await screen.findByText("La atención en línea no lleva referencia a espacio."),
    ).toBeDefined();
  });

  test("guardado válido confirma con nota ficticia por teclado", async () => {
    comoProfesional();
    renderAt("/profesional/disponibilidad");

    expect(await screen.findByRole("heading", { name: "Bloques recurrentes" })).toBeDefined();
    expect(screen.getAllByText("Lunes").length).toBeGreaterThan(0);

    completarBloqueValido();
    const guardar = screen.getByRole("button", { name: "Guardar bloque" });
    guardar.focus();
    expect(document.activeElement).toBe(guardar);
    fireEvent.click(guardar);

    expect(await screen.findByText("Bloque guardado")).toBeDefined();
    expect(
      await screen.findByText("Código bloque-ficticio-9. Guardado simulado con datos ficticios.", {
        exact: false,
      }),
    ).toBeDefined();
  });

  test("fallo de guardado conserva el formulario y muestra el mensaje", async () => {
    const port = puertoOk();
    port.saveBlock = () =>
      Promise.resolve({
        status: "error",
        error: {
          code: "conflict",
          message: "La solicitud entra en conflicto con el estado actual.",
        },
      });
    comoProfesional(port);
    renderAt("/profesional/disponibilidad");

    expect(await screen.findByRole("heading", { name: "Bloques recurrentes" })).toBeDefined();
    expect(screen.getAllByText("Lunes").length).toBeGreaterThan(0);

    completarBloqueValido();
    fireEvent.click(screen.getByRole("button", { name: "Guardar bloque" }));

    expect(
      await screen.findByText("La solicitud entra en conflicto con el estado actual."),
    ).toBeDefined();
    expect(screen.queryByText("Bloque guardado")).toBeNull();
  });

  test("guardado denegado muestra aviso sin filtrar", async () => {
    const port = puertoOk();
    port.saveBlock = () => Promise.resolve({ status: "denied" });
    comoProfesional(port);
    renderAt("/profesional/disponibilidad");

    expect(await screen.findByRole("heading", { name: "Bloques recurrentes" })).toBeDefined();
    expect(screen.getAllByText("Lunes").length).toBeGreaterThan(0);

    completarBloqueValido();
    fireEvent.click(screen.getByRole("button", { name: "Guardar bloque" }));

    expect(
      await screen.findByText("No autorizado. Pide acceso por el canal oficial si corresponde."),
    ).toBeDefined();
  });

  test("agregado con bloque muestra error de formato", async () => {
    comoProfesional();
    renderAt("/profesional/disponibilidad");

    expect(await screen.findByRole("heading", { name: "Bloques recurrentes" })).toBeDefined();
    expect(screen.getAllByText("Lunes").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Fecha (AAAA-MM-DD)"), {
      target: { value: "2026-05-05" },
    });
    fireEvent.change(screen.getByLabelText("Clase"), { target: { value: "added" } });
    fireEvent.change(screen.getByLabelText("Bloque afectado (solo cancelación puntual)"), {
      target: { value: "bloque-ficticio-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar excepción" }));

    expect(
      await screen.findByText("El agregado trae su propia ventana, no un bloque."),
    ).toBeDefined();
  });

  test("excepción válida confirma con nota ficticia y conserva el detalle", async () => {
    comoProfesional();
    renderAt("/profesional/disponibilidad");

    expect(await screen.findByRole("heading", { name: "Bloques recurrentes" })).toBeDefined();
    expect(screen.getAllByText("Lunes").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Fecha (AAAA-MM-DD)"), {
      target: { value: "2026-05-07" },
    });
    fireEvent.change(screen.getByLabelText("Clase"), { target: { value: "cancelled" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar excepción" }));

    const confirmationHeading = await screen.findByText("Excepción guardada");
    const confirmation = confirmationHeading.closest("div");
    if (confirmation === null) {
      throw new Error("Se esperaba el bloque de confirmación de la excepción");
    }
    const view = within(confirmation);
    // El detalle sobrevive al limpiarse el formulario.
    expect(view.getByText("2026-05-07")).toBeDefined();
    expect(view.getByText("Día completo")).toBeDefined();
    expect(view.getByText("Guardado simulado con datos ficticios.")).toBeDefined();
  });

  test("distingue el alcance de las cancelaciones y detalla el agregado", async () => {
    comoProfesional();
    renderAt("/profesional/disponibilidad");

    const heading = await screen.findByRole("heading", { name: "Excepciones" });
    const section = heading.closest("section");
    if (section === null) {
      throw new Error("Se esperaba la sección de excepciones");
    }
    const view = within(section);

    expect(view.getByText("2026-05-04")).toBeDefined();
    expect(view.getByText("Día completo")).toBeDefined();
    expect(view.getByText("2026-05-05")).toBeDefined();
    expect(view.getByText("Bloque bloque-ficticio-1")).toBeDefined();
    expect(view.getByText("2026-05-06")).toBeDefined();
    expect(view.getByText("10:00 – 11:00", { exact: false })).toBeDefined();
    expect(view.getByText("30 minutos", { exact: false })).toBeDefined();
    expect(view.getByText("Presencial", { exact: false })).toBeDefined();
    expect(view.getByText("Espacio esp-2", { exact: false })).toBeDefined();
  });

  test("controles cumplen alto táctil, foco por teclado y ancho fluido", async () => {
    comoProfesional();
    renderAt("/profesional/disponibilidad");

    await screen.findByRole("heading", { name: "Nuevo bloque recurrente" });
    // Revela los campos del agregado para cubrir ambos formularios.
    fireEvent.change(screen.getByLabelText("Clase"), { target: { value: "added" } });

    const fields = [...screen.getAllByRole("textbox"), ...screen.getAllByRole("combobox")];
    expect(fields.length).toBe(14);
    for (const field of fields) {
      // Alto táctil de 44px según DESIGN.md mediante la clase compartida.
      expect(field.className).toContain("min-h-[44px]");
      // Ancho fluido sin anchos fijos para refluir en ventanas estrechas.
      expect(field.className).toContain("w-full");
      expect(field.getAttribute("style") ?? "").not.toContain("width");
      // Operable por teclado.
      field.focus();
      expect(document.activeElement).toBe(field);
    }
  });
});

describe("guard de la ruta de disponibilidad (TI2-103)", () => {
  test("sin sesión redirige al acceso conservando el retorno", async () => {
    mockedSession = SIN_SESION;
    mockedPair = PAR_SIN_SESION;
    const { router } = renderAt("/profesional/disponibilidad");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({
      redirect: "/profesional/disponibilidad",
    });
    expect(screen.queryByRole("heading", { name: "Disponibilidad" })).toBeNull();
  });

  test("otro rol va a denegado sin contenido del editor", async () => {
    mockedSession = SESION_INTERN;
    mockedPair = PAR_INTERN;
    const { router } = renderAt("/profesional/disponibilidad");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: "Disponibilidad" })).toBeNull();
  });
});
