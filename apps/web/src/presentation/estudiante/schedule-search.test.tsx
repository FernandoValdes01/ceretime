// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { SlotSearchResult } from "../../application/agenda/agenda-port.ts";

/**
 * Pruebas de búsqueda de horarios del Estudiante (TI2-101).
 *
 * Integración por el router real (incluye guards): la sesión simulada es de
 * Estudiante, salvo denegación y acceso. La lectura se mockea por módulo
 * porque el adaptador es ficticio; el cableado real lo cubren `tsc`, el build
 * y la verificación manual contra el entorno ficticio de TI2-30. Los datos
 * de cada caso son ficticios.
 */

let mockedSession: WebSessionState;
let mockedPair:
  | {
      session: WebSessionState;
      role: WebSessionRole;
    }
  | undefined;
let mockedBackendConfigured = true;

let mockedResult: SlotSearchResult | undefined;
let resultThrows: Error | null = null;

vi.mock("convex/react", () => ({ useQuery: () => mockedSession }));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () => mockedPair,
}));

vi.mock("./student-booking-context.tsx", () => {
  const context = { accompanimentId: "acompanamiento-1", professionalIds: ["pro-1"] };
  return {
    BookingContextGate: ({ children }: { children: (value: typeof context) => ReactNode }) =>
      children(context),
  };
});

vi.mock("./schedule-search-data.ts", () => ({
  useSlotSearch: () => {
    if (resultThrows !== null) {
      throw resultThrows;
    }
    return mockedResult;
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
  name: "Profesional Ficticio",
  population: "personal",
};

const PAR_PROFESIONAL = {
  session: SESION_PERSONAL,
  role: { status: "authenticated", role: "professional", email: "pro@uct.cl" },
} as const;

const SIN_SESION: WebSessionState = { status: "unauthenticated" };

const PAR_SIN_SESION = {
  session: SIN_SESION,
  role: { status: "unauthenticated" },
} as const;

function cupoFicticio(
  overrides: Partial<{
    id: string;
    modality: "inPerson" | "online";
    spaceLabel: string;
    date: string;
    startAt: number;
  }> = {},
) {
  const modality = overrides.modality ?? ("inPerson" as const);
  return {
    id: overrides.id ?? "cupo-1",
    professionalId: "pro-ficticio-1",
    date: overrides.date ?? "2026-10-20",
    startAt: overrides.startAt ?? 1760925600000,
    endAt: (overrides.startAt ?? 1760925600000) + 3_600_000,
    modality,
    spaceLabel:
      overrides.spaceLabel ??
      (modality === "online" ? undefined : "Campus Norte · Edificio A · Piso 1 · Sala 101"),
  };
}

beforeEach(() => {
  vi.stubEnv("VITE_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("VITE_CONVEX_SITE_URL", "https://test.convex.site");
  sessionStorage.clear();
  mockedSession = undefined;
  mockedPair = undefined;
  mockedBackendConfigured = true;
  mockedResult = undefined;
  resultThrows = null;
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

function comoEstudiante() {
  mockedSession = SESION_ESTUDIANTE;
  mockedPair = PAR_ESTUDIANTE;
}

describe("búsqueda de horarios (TI2-101)", () => {
  test("muestra filtros y lista de cupos con modalidad y espacio", async () => {
    comoEstudiante();
    mockedResult = {
      status: "ok",
      slots: [cupoFicticio({ id: "cupo-1" }), cupoFicticio({ id: "cupo-2", modality: "online" })],
    };
    renderAt("/estudiante/horarios");

    expect(await screen.findByRole("heading", { name: "Buscar horarios" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "Todas" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "Presencial" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "En línea" })).toBeDefined();
    // Filtro y ficha de la fila comparten etiqueta de modalidad.
    expect(await screen.findAllByText("Presencial")).toHaveLength(2);
    expect(screen.getByText("Sala 101", { exact: false })).toBeDefined();
  });

  test("cada cupo enlaza directo a la confirmación, con su día en el nombre", async () => {
    comoEstudiante();
    mockedResult = { status: "ok", slots: [cupoFicticio({ id: "cupo-1" })] };
    renderAt("/estudiante/horarios");

    const enlace = await screen.findByRole("link", { name: /Martes 20 de octubre.*Sala 101/ });
    expect(enlace.getAttribute("href")).toBe(
      "/estudiante/reservar?slotId=cupo-1&accompanimentId=acompanamiento-1",
    );
    expect(screen.queryByRole("radio", { name: /Sala 101/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Continuar" })).toBeNull();
  });

  test("muestra una semana a la vez, salta las vacías y mueve el foco al encabezado", async () => {
    comoEstudiante();
    mockedResult = {
      status: "ok",
      slots: [
        cupoFicticio({ id: "cupo-lejano", date: "2026-11-30", startAt: 1796000000000 }),
        cupoFicticio({ id: "cupo-1", date: "2026-10-20", startAt: 1760925600000 }),
        cupoFicticio({ id: "cupo-2", date: "2026-10-25", startAt: 1761400000000 }),
      ],
    };
    renderAt("/estudiante/horarios");

    expect(
      await screen.findByRole("heading", { name: "Semana del 19 al 25 de octubre" }),
    ).toBeDefined();
    expect(screen.getByRole("heading", { name: "Martes 20 de octubre" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Domingo 25 de octubre" })).toBeDefined();
    expect(screen.queryByRole("link", { name: /Lunes 30 de noviembre/ })).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Semana anterior" }).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Semana siguiente" }));

    const siguiente = await screen.findByRole("heading", {
      name: "Semana del 30 de noviembre al 6 de diciembre",
    });
    expect(document.activeElement).toBe(siguiente);
    expect(screen.getByRole("link", { name: /Lunes 30 de noviembre/ })).toBeDefined();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Semana siguiente" }).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Semana anterior" }));

    expect(
      await screen.findByRole("heading", { name: "Semana del 19 al 25 de octubre" }),
    ).toBeDefined();
  });

  test("cargando muestra el aviso explícito", async () => {
    comoEstudiante();
    mockedResult = undefined;
    renderAt("/estudiante/horarios");

    expect(await screen.findByText("Cargando horarios…")).toBeDefined();
    expect(screen.getByRole("status").textContent?.trim()).toBe("Buscando horarios disponibles.");
  });

  test("anuncia la cantidad de cupos en la región de estado", async () => {
    comoEstudiante();
    mockedResult = {
      status: "ok",
      slots: [cupoFicticio({ id: "cupo-1" }), cupoFicticio({ id: "cupo-2" })],
    };
    renderAt("/estudiante/horarios");

    expect(await screen.findByRole("status")).toBeDefined();
    expect(screen.getByRole("status").textContent?.trim()).toBe("2 cupos disponibles.");
  });

  test("vacío muestra mensaje distinto del fallo técnico", async () => {
    comoEstudiante();
    mockedResult = { status: "empty" };
    renderAt("/estudiante/horarios");

    expect(await screen.findByText("No hay horarios para esta modalidad.")).toBeDefined();
    expect(screen.queryByText("No pudimos cargar los horarios. Inténtalo de nuevo.")).toBeNull();
    expect(screen.getByRole("status").textContent?.trim()).toBe(
      "Sin resultados para la modalidad elegida.",
    );
  });

  test("falta de cupo no se presenta como fallo técnico", async () => {
    comoEstudiante();
    mockedResult = { status: "no_availability", code: "no_availability" };
    renderAt("/estudiante/horarios");

    expect(await screen.findByText("No hay cupos compatibles por ahora.")).toBeDefined();
    expect(screen.queryByText("No pudimos cargar los horarios. Inténtalo de nuevo.")).toBeNull();
    expect(screen.getByRole("status").textContent?.trim()).toBe(
      "Sin cupos compatibles en este momento.",
    );
  });

  test("una denegación no ofrece cupos ni revela el motivo", async () => {
    comoEstudiante();
    mockedResult = { status: "denied" };
    renderAt("/estudiante/horarios");

    expect(await screen.findByText("No tienes acceso a estos horarios.")).toBeDefined();
    expect(screen.queryByText("Cupo elegido")).toBeNull();
    expect(screen.getByRole("status").textContent?.trim()).toBe("Sin acceso a los horarios.");
  });

  test("fallo técnico muestra mensaje y permite reintentar", async () => {
    comoEstudiante();
    mockedResult = {
      status: "error",
      message: "No pudimos cargar los horarios. Inténtalo de nuevo.",
    };
    renderAt("/estudiante/horarios");

    expect(
      await screen.findByText("No pudimos cargar los horarios. Inténtalo de nuevo."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeDefined();
    expect(screen.getByRole("status").textContent?.trim()).toBe("Error al cargar los horarios.");
  });
});

describe("guard de horarios (TI2-101)", () => {
  test("sin sesión redirige al acceso conservando el retorno", async () => {
    mockedSession = SIN_SESION;
    mockedPair = PAR_SIN_SESION;
    const { router } = renderAt("/estudiante/horarios");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({
      redirect: "/estudiante/horarios",
    });
    expect(screen.queryByRole("heading", { name: "Buscar horarios" })).toBeNull();
  });

  test("otro rol va a denegado sin contenido de horarios", async () => {
    mockedSession = SESION_PERSONAL;
    mockedPair = PAR_PROFESIONAL;
    const { router } = renderAt("/estudiante/horarios");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: "Buscar horarios" })).toBeNull();
  });
});
