// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { Space } from "../../../../../convex/domain/index.ts";
import type { AgendaPort } from "../../application/agenda/agenda-port.ts";
import { setAgendaPortForTests } from "./professional-availability-data.ts";

/**
 * Pruebas del editor de espacios del Administrador (TI2-04).
 *
 * Integración por el router real (incluye guards): la sesión simulada es de
 * Administrador, salvo los casos de denegación. El puerto de agenda se
 * inyecta por pruebas porque el adaptador ficticio no distingue referencias;
 * el cableado real puerto→adaptador lo cubren `tsc`, el build y la
 * verificación manual contra el entorno ficticio de TI2-30. Todos los datos
 * son ficticios y el guardado no anuncia persistencia real.
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

const SESION_ADMIN: WebSessionState = {
  status: "authenticated",
  email: "admin@uct.cl",
  name: "Administrador Ficticio",
  population: "personal",
};

const PAR_ADMIN: { session: WebSessionState; role: WebSessionRole } = {
  session: SESION_ADMIN,
  role: { status: "authenticated", role: "admin", email: "admin@uct.cl" },
};

const SIN_SESION: WebSessionState = { status: "unauthenticated" };

const PAR_SIN_SESION = {
  session: SIN_SESION,
  role: { status: "unauthenticated" },
} as const;

const ESPACIOS_FICTICIOS: ReadonlyArray<Space> = [
  {
    id: "esp-1",
    campus: "Campus Norte",
    building: "Edificio A",
    floor: "Piso 1",
    room: "Sala 101",
    accessConditions: "Acceso sin escaleras por rampa lateral.",
    arrivalInstructions:
      "Entrar por el acceso norte y seguir la señalización táctil hasta la sala.",
    version: "v1",
  },
  {
    id: "esp-2",
    campus: "Campus Norte",
    building: "Edificio B",
    floor: "Piso 2",
    room: "Sala 205",
    accessConditions: "Ascensor disponible junto al acceso principal.",
    arrivalInstructions: "Subir al segundo piso y girar a la derecha al salir del ascensor.",
    version: "v1",
  },
];

function puertoOk(): AgendaPort {
  return {
    searchSlots: () => Promise.resolve({ status: "empty" }),
    reserveSlot: () =>
      Promise.resolve({
        status: "error",
        error: { code: "no_availability", message: "El cupo ya no está disponible." },
      }),
    listAvailability: () => Promise.resolve({ status: "empty" }),
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
    listSpaces: () => Promise.resolve({ status: "ok", spaces: ESPACIOS_FICTICIOS }),
    saveSpace: (input) =>
      Promise.resolve({
        status: "saved",
        space: {
          id: input.id ?? "esp-ficticio-9",
          campus: input.campus,
          building: input.building,
          floor: input.floor,
          room: input.room,
          accessConditions: input.accessConditions,
          arrivalInstructions: input.arrivalInstructions,
          version: "v1",
        },
      }),
  };
}

function comoAdministrador(port: AgendaPort | null = puertoOk()) {
  mockedSession = SESION_ADMIN;
  mockedPair = PAR_ADMIN;
  setAgendaPortForTests(port);
}

function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(<RouterProvider router={router} />);
  return { router, unmount: view.unmount };
}

function completarEspacioValido() {
  fireEvent.change(screen.getByLabelText("Campus"), { target: { value: "Campus Sur" } });
  fireEvent.change(screen.getByLabelText("Edificio"), { target: { value: "Edificio C" } });
  fireEvent.change(screen.getByLabelText("Piso"), { target: { value: "Piso 3" } });
  fireEvent.change(screen.getByLabelText("Sala"), { target: { value: "Sala 310" } });
  fireEvent.change(screen.getByLabelText("Condiciones de acceso"), {
    target: { value: "Rampa lateral y señalización contrastada." },
  });
  fireEvent.change(screen.getByLabelText("Instrucciones de llegada"), {
    target: { value: "Entrar por el acceso sur y seguir la línea guía hasta el ascensor." },
  });
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

describe("editor de espacios (TI2-04)", () => {
  test("carga muestra estado y luego los espacios con sus campos", async () => {
    let resolveList!: (value: Awaited<ReturnType<AgendaPort["listSpaces"]>>) => void;
    const pendiente = new Promise<Awaited<ReturnType<AgendaPort["listSpaces"]>>>((resolve) => {
      resolveList = resolve;
    });
    const port = puertoOk();
    port.listSpaces = () => pendiente;
    comoAdministrador(port);
    renderAt("/administrador/espacios");

    expect(await screen.findByText("Cargando los espacios…")).toBeDefined();

    resolveList({ status: "ok", spaces: ESPACIOS_FICTICIOS });

    expect(await screen.findByText("Campus Norte · Edificio A · Piso 1 · Sala 101")).toBeDefined();
    expect(screen.getByText("Campus Norte · Edificio B · Piso 2 · Sala 205")).toBeDefined();
    expect(screen.getAllByText("Presencial").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Condiciones de acceso: Acceso sin escaleras por rampa lateral\./),
    ).toBeDefined();
    expect(screen.getByText(/Instrucciones de llegada: Subir al segundo piso/)).toBeDefined();
  });

  test("fallo de lectura muestra error y reintenta", async () => {
    const port = puertoOk();
    port.listSpaces = () =>
      Promise.resolve({
        status: "error",
        message: "No pudimos cargar los espacios. Inténtalo de nuevo.",
      });
    comoAdministrador(port);
    renderAt("/administrador/espacios");

    expect(
      await screen.findByText("No pudimos cargar los espacios. Inténtalo de nuevo."),
    ).toBeDefined();

    port.listSpaces = () => Promise.resolve({ status: "empty" });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Sin espacios registrados.")).toBeDefined();
  });

  test("denegación de lectura muestra aviso genérico sin datos", async () => {
    const port = puertoOk();
    port.listSpaces = () => Promise.resolve({ status: "denied" });
    comoAdministrador(port);
    renderAt("/administrador/espacios");

    expect(
      await screen.findByText("No autorizado. Pide acceso por el canal oficial si corresponde."),
    ).toBeDefined();
    expect(screen.queryByText("Sala 101")).toBeNull();
  });

  test("catálogo vacío muestra estado vacío", async () => {
    const port = puertoOk();
    port.listSpaces = () => Promise.resolve({ status: "empty" });
    comoAdministrador(port);
    renderAt("/administrador/espacios");

    expect(await screen.findByText("Sin espacios registrados.")).toBeDefined();
    expect(screen.queryByText("Sala 101")).toBeNull();
  });

  test("formulario vacío muestra errores de campo legibles", async () => {
    comoAdministrador();
    renderAt("/administrador/espacios");

    expect(await screen.findByText("Campus Norte · Edificio A · Piso 1 · Sala 101")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Guardar espacio" }));

    expect(await screen.findByText("Indica el campus del espacio.")).toBeDefined();
    expect(screen.getByText("Indica el edificio del espacio.")).toBeDefined();
    expect(screen.getByText("Indica el piso del espacio.")).toBeDefined();
    expect(screen.getByText("Indica la sala del espacio.")).toBeDefined();
    expect(screen.getByText("Describe las condiciones de acceso del espacio.")).toBeDefined();
    expect(screen.getByText("Describe las instrucciones de llegada al espacio.")).toBeDefined();
  });

  test("guardado válido de un espacio nuevo confirma con nota ficticia y lo agrega", async () => {
    comoAdministrador();
    renderAt("/administrador/espacios");

    expect(await screen.findByText("Campus Norte · Edificio A · Piso 1 · Sala 101")).toBeDefined();

    completarEspacioValido();
    const guardar = screen.getByRole("button", { name: "Guardar espacio" });
    guardar.focus();
    expect(document.activeElement).toBe(guardar);
    fireEvent.click(guardar);

    expect(await screen.findByText("Espacio guardado")).toBeDefined();
    expect(
      await screen.findByText(/Código esp-ficticio-9\. Guardado simulado con datos ficticios/, {
        exact: false,
      }),
    ).toBeDefined();
    expect(
      screen.getAllByText(/la escritura real del catálogo no está entregada/).length,
    ).toBeGreaterThan(0);
    const catalogo = screen
      .getByRole("heading", { name: "Espacios registrados" })
      .closest("section");
    if (catalogo === null) {
      throw new Error("Se esperaba la sección del catálogo");
    }
    expect(
      await within(catalogo).findByText("Campus Sur · Edificio C · Piso 3 · Sala 310"),
    ).toBeDefined();
  });

  test("editar un espacio completa el formulario, conserva identidad y actualiza la lista", async () => {
    comoAdministrador();
    renderAt("/administrador/espacios");

    expect(await screen.findByText("Campus Norte · Edificio A · Piso 1 · Sala 101")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Editar espacio esp-1" }));

    expect(await screen.findByRole("heading", { name: "Editar espacio" })).toBeDefined();
    expect(
      screen.getByText(/Estás editando Campus Norte · Edificio A · Piso 1 · Sala 101/),
    ).toBeDefined();
    const campus = screen.getByLabelText("Campus") as HTMLInputElement;
    expect(campus.value).toBe("Campus Norte");

    fireEvent.change(screen.getByLabelText("Condiciones de acceso"), {
      target: { value: "Rampa lateral y ascensor amplio en el hall." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar espacio" }));

    expect(await screen.findByText("Espacio guardado")).toBeDefined();
    expect(
      screen.getAllByText(/Rampa lateral y ascensor amplio en el hall\./).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Acceso sin escaleras por rampa lateral\./)).toBeNull();
    // La lista del catálogo refleja el espacio actualizado; el mismo texto
    // también aparece en la confirmación, así que se consulta por sección.
    const catalogo = screen
      .getByRole("heading", { name: "Espacios registrados" })
      .closest("section");
    if (catalogo === null) {
      throw new Error("Se esperaba la sección del catálogo");
    }
    expect(
      within(catalogo).getByText("Campus Norte · Edificio A · Piso 1 · Sala 101"),
    ).toBeDefined();
  });

  test("cancelar la edición vuelve al modo nuevo sin datos del espacio", async () => {
    comoAdministrador();
    renderAt("/administrador/espacios");

    expect(await screen.findByText("Campus Norte · Edificio A · Piso 1 · Sala 101")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Editar espacio esp-1" }));
    expect(await screen.findByRole("heading", { name: "Editar espacio" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar edición" }));

    const heading = await screen.findByRole("heading", { name: "Nuevo espacio" });
    expect(heading).toBeDefined();
    const campus = screen.getByLabelText("Campus") as HTMLInputElement;
    expect(campus.value).toBe("");
  });

  test("fallo de guardado conserva el formulario y muestra el mensaje", async () => {
    const port = puertoOk();
    port.saveSpace = () =>
      Promise.resolve({
        status: "error",
        error: {
          code: "conflict",
          message: "El espacio entra en conflicto con el estado actual.",
        },
      });
    comoAdministrador(port);
    renderAt("/administrador/espacios");

    expect(await screen.findByText("Campus Norte · Edificio A · Piso 1 · Sala 101")).toBeDefined();

    completarEspacioValido();
    fireEvent.click(screen.getByRole("button", { name: "Guardar espacio" }));

    expect(
      await screen.findByText("El espacio entra en conflicto con el estado actual."),
    ).toBeDefined();
    expect(screen.queryByText("Espacio guardado")).toBeNull();
  });

  test("guardado denegado muestra aviso sin filtrar", async () => {
    const port = puertoOk();
    port.saveSpace = () => Promise.resolve({ status: "denied" });
    comoAdministrador(port);
    renderAt("/administrador/espacios");

    expect(await screen.findByText("Campus Norte · Edificio A · Piso 1 · Sala 101")).toBeDefined();

    completarEspacioValido();
    fireEvent.click(screen.getByRole("button", { name: "Guardar espacio" }));

    expect(
      await screen.findByText("No autorizado. Pide acceso por el canal oficial si corresponde."),
    ).toBeDefined();
    expect(screen.queryByText("Espacio guardado")).toBeNull();
  });

  test("la modalidad se anuncia como presencial y sin opción híbrida", async () => {
    comoAdministrador();
    renderAt("/administrador/espacios");

    expect(await screen.findByText("Campus Norte · Edificio A · Piso 1 · Sala 101")).toBeDefined();

    expect(screen.getByText(/Modalidad: Presencial\./)).toBeDefined();
    expect(screen.queryByText(/Híbrida/)).toBeNull();
    // El formulario de espacios no decide modalidades: no hay selector.
    const formHeading = screen.getByRole("heading", { name: "Nuevo espacio" });
    const formSection = formHeading.closest("section");
    if (formSection === null) {
      throw new Error("Se esperaba la sección del formulario");
    }
    expect(within(formSection).queryByRole("combobox")).toBeNull();
  });

  test("controles cumplen alto táctil, foco por teclado y ancho fluido", async () => {
    comoAdministrador();
    renderAt("/administrador/espacios");

    await screen.findByRole("heading", { name: "Nuevo espacio" });

    const fields = [...screen.getAllByRole("textbox")];
    // Cuatro campos de ubicación y dos cuadros de varias líneas de acceso.
    expect(fields.length).toBe(6);
    for (const field of fields) {
      // Ancho fluido y min-w-0 para refluir dentro de la cuadrícula estrecha.
      expect(field.className).toContain("w-full");
      expect(field.className).toContain("min-w-0");
      // Alto táctil mínimo de 44px según DESIGN.md mediante las clases compartidas.
      expect(field.className.includes("min-h-[44px]") || field.className.includes("min-h-32")).toBe(
        true,
      );
      expect(field.getAttribute("style") ?? "").not.toContain("width");
      // Operable por teclado.
      field.focus();
      expect(document.activeElement).toBe(field);
    }

    for (const id of ["esp-1", "esp-2"]) {
      const button = screen.getByRole("button", { name: `Editar espacio ${id}` });
      button.focus();
      expect(document.activeElement).toBe(button);
    }
  });

  test("navegación del administrador conserva enlaces visibles y operables por teclado", async () => {
    comoAdministrador();
    renderAt("/administrador/espacios");

    const nav = await screen.findByRole("navigation", { name: "Portal de Administración" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent?.trim())).toEqual(["Inicio", "Espacios", "Sesión"]);
    for (const link of links) {
      link.focus();
      expect(document.activeElement).toBe(link);
    }
  });

  test("la portada del Administrador enlaza el editor de espacios", async () => {
    comoAdministrador();
    renderAt("/administrador");

    const heading = await screen.findByRole("heading", { name: "Portal de Administración" });
    expect(heading).toBeDefined();
    const espacios = await screen.findByRole("link", { name: "Espacios" });
    expect(espacios.getAttribute("href")).toBe("/administrador/espacios");
  });
});

describe("guard de la ruta de espacios (TI2-04)", () => {
  test("sin sesión redirige al acceso conservando el retorno", async () => {
    mockedSession = SIN_SESION;
    mockedPair = PAR_SIN_SESION;
    const { router } = renderAt("/administrador/espacios");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({
      redirect: "/administrador/espacios",
    });
    expect(screen.queryByRole("heading", { name: "Espacios de atención" })).toBeNull();
  });

  test.each(["professional", "intern", "student"] as const)(
    "el rol %s ve denegado sin contenido del editor",
    async (rolAjeno) => {
      const emailAjeno = rolAjeno === "student" ? "estudiante@alu.uct.cl" : `${rolAjeno}@uct.cl`;
      mockedSession =
        rolAjeno === "student"
          ? {
              status: "authenticated",
              email: emailAjeno,
              name: "Estudiante Ficticio",
              population: "estudiante",
            }
          : {
              status: "authenticated",
              email: emailAjeno,
              name: "Personal Ficticio",
              population: "personal",
            };
      mockedPair = {
        session: mockedSession,
        role: { status: "authenticated", role: rolAjeno, email: emailAjeno },
      };
      const { router } = renderAt("/administrador/espacios");

      await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
      expect(screen.queryByRole("heading", { name: "Espacios de atención" })).toBeNull();
    },
  );
});
