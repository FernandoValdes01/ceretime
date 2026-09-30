// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AccessibilityProvider } from "../accessibility/AccessibilityProvider";
import { StudentHome } from "./student-portal";
import {
  accompanimentStatusLabel,
  formatPanelDate,
  requestStatusLabel,
} from "./student-panel-labels";

// El mock responde por hook: es puro entre renders (React puede reintentar
// un render tras un error y un mock con consumo rompería ese flujo).
let mockSession: unknown;
let mockRequests: unknown;
let mockAccompaniments: unknown;
let shouldThrowRequests = false;
let shouldThrowAccompaniments = false;

vi.mock("./student-panel-data", () => ({
  useStudentSession: () => mockSession,
  useStudentRequests: () => {
    if (shouldThrowRequests) {
      throw new Error("backend caído");
    }
    return mockRequests;
  },
  useStudentAccompaniments: () => {
    if (shouldThrowAccompaniments) {
      throw new Error("backend caído");
    }
    return mockAccompaniments;
  },
}));

function renderPanel() {
  return render(
    <AccessibilityProvider>
      <StudentHome />
    </AccessibilityProvider>,
  );
}

const SESSION = {
  status: "authenticated",
  email: "estudiante@alu.uct.cl",
  name: "Estudiante Ficticio",
  population: "estudiante",
} as const;

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: null };

/** El saludo reparte su texto entre el párrafo y el nombre en negrita. */
function greetingText() {
  return (_content: string, element: Element | null) =>
    element?.tagName === "P" && /hola, estudiante ficticio/i.test(element.textContent ?? "");
}

beforeEach(() => {
  mockSession = undefined;
  mockRequests = undefined;
  mockAccompaniments = undefined;
  shouldThrowRequests = false;
  shouldThrowAccompaniments = false;
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("panel inicial del Estudiante", () => {
  test("muestra carga mientras las queries no resuelven", async () => {
    renderPanel();

    await screen.findByRole("heading", { name: "Portal del Estudiante" });
    expect(screen.getAllByRole("status")[0].textContent).toMatch(/cargando/i);
    expect(screen.queryByText(greetingText())).toBeNull();
  });

  test("sin datos muestra vacíos explícitos y saludo", async () => {
    mockSession = SESSION;
    mockRequests = EMPTY_PAGE;
    mockAccompaniments = EMPTY_PAGE;
    renderPanel();

    expect(await screen.findByText(greetingText())).toBeDefined();
    expect(screen.getByText("Aún no tienes solicitudes registradas.")).toBeDefined();
    expect(screen.getByText("Aún no tienes acompañamientos asignados.")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("con datos muestra estados con etiquetas en español", async () => {
    mockSession = SESSION;
    mockRequests = {
      page: [
        {
          _id: "request1",
          studentId: "student1",
          status: "under_review",
          accessNeeds: "Intérprete de lengua de señas",
          createdAt: new Date(2026, 8, 12).getTime(),
        },
      ],
      isDone: true,
      continueCursor: null,
    };
    mockAccompaniments = {
      page: [
        {
          _id: "acc1",
          status: "active",
          objective: "Organizar el estudio semanal",
          view: "minimized",
        },
      ],
      isDone: false,
      continueCursor: "acc1",
    };
    renderPanel();

    expect(await screen.findByText("En revisión")).toBeDefined();
    expect(screen.getByText("Activo")).toBeDefined();
    expect(screen.getByText("Organizar el estudio semanal")).toBeDefined();
    expect(screen.getByText("Mostrando los más recientes.")).toBeDefined();
    // Las necesidades de acceso no se vuelcan en el resumen.
    expect(screen.queryByText(/intérprete/i)).toBeNull();
  });

  test("una sección caída no tumba el resto y su reintento recupera", async () => {
    mockSession = SESSION;
    mockRequests = EMPTY_PAGE;
    mockAccompaniments = {
      page: [
        {
          _id: "acc1",
          status: "active",
          objective: "Organizar el estudio semanal",
          view: "minimized",
        },
      ],
      isDone: true,
      continueCursor: null,
    };
    shouldThrowRequests = true;
    renderPanel();

    expect(await screen.findByText(greetingText())).toBeDefined();
    expect(screen.getByText(/no pudimos cargar tus solicitudes/i)).toBeDefined();
    expect(screen.getByText("Organizar el estudio semanal")).toBeDefined();

    shouldThrowRequests = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Aún no tienes solicitudes registradas.")).toBeDefined();
  });

  test("sin sesión no expone contenido protegido", async () => {
    mockSession = { status: "unauthenticated" };
    mockRequests = EMPTY_PAGE;
    mockAccompaniments = EMPTY_PAGE;
    renderPanel();

    await screen.findByRole("heading", { name: "Portal del Estudiante" });
    expect(screen.getByText(/vuelve al acceso/i)).toBeDefined();
    expect(screen.queryByText(greetingText())).toBeNull();
    expect(screen.queryByText("Solicitar acompañamiento")).toBeNull();
  });

  test("ante una query caída muestra error con reintento", async () => {
    shouldThrowRequests = true;
    mockSession = SESSION;
    mockAccompaniments = EMPTY_PAGE;
    renderPanel();

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText(/no pudimos cargar tus solicitudes/i)).toBeDefined();

    shouldThrowRequests = false;
    mockRequests = EMPTY_PAGE;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Aún no tienes solicitudes registradas.")).toBeDefined();
  });

  test("ambas secciones denegadas muestran pendiente de habilitación sin reintento", async () => {
    mockSession = SESSION;
    shouldThrowRequests = true;
    shouldThrowAccompaniments = true;
    renderPanel();

    expect(await screen.findByText(greetingText())).toBeDefined();
    expect(await screen.findByText("Cuenta pendiente de habilitación")).toBeDefined();
    expect(
      screen.getByText("Tu cuenta aún no está habilitada para ver tus recursos."),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("etiquetas del panel", () => {
  test("traducen estados conocidos y conservan desconocidos", () => {
    expect(requestStatusLabel("received")).toBe("Recibida");
    expect(requestStatusLabel("awaiting_information_or_acceptance")).toBe(
      "Esperando información o aceptación",
    );
    expect(requestStatusLabel("futuro")).toBe("futuro");
    expect(accompanimentStatusLabel("paused")).toBe("Pausado");
    expect(accompanimentStatusLabel("closed")).toBe("Cerrado");
  });

  test("la fecha incluye día, mes y año", () => {
    const text = formatPanelDate(new Date(2026, 8, 12).getTime());
    expect(text).toMatch(/12/);
    expect(text).toMatch(/2026/);
  });
});
