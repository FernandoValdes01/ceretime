// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_ERROR_MESSAGE } from "../../../../../convex/domain/index.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { InternAccountsPage } from "./professional-interns-data.ts";

/**
 * Pruebas de la gestión de practicantes desde la Web del Profesional (TI2-170).
 *
 * Integración por el router real (incluye guards). Las lecturas se sustituyen
 * por módulo porque `convex/react` no distingue referencias del `api`
 * generado; el cableado real query→referencia lo cubren `tsc`, el build y la
 * verificación manual. Todos los datos son ficticios. La autorización efectiva
 * vive en Convex; acá se prueba que la Web habilita, asigna, modifica y
 * retira, y que el acceso retirado se muestra como acceso denegado en la
 * vista del practicante (TI2-116).
 */

const enableMock = vi.fn();
const assignMock = vi.fn();
const updateMock = vi.fn();
const revokeMock = vi.fn();

let mockedSession: WebSessionState;
let mockedPair: { session: WebSessionState; role: WebSessionRole } | undefined;

let internPage: InternAccountsPage | undefined;
let internsDetail:
  | { assigned: unknown[]; assignable: unknown[]; assignableComplete: boolean }
  | undefined;
let listThrows: Error | null = null;
let internsThrows: Error | null = null;

vi.mock("convex/react", () => ({ useQuery: () => mockedSession }));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () => mockedPair,
}));

vi.mock("./professional-interns-data.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./professional-interns-data.ts")>();
  return {
    ...actual,
    useInternAccounts: () => {
      if (listThrows !== null) throw listThrows;
      return internPage;
    },
    useEnableIntern: () => enableMock,
    useAccompanimentInterns: () => {
      if (internsThrows !== null) throw internsThrows;
      return internsDetail;
    },
    useAssignInternAccess: () => assignMock,
    useUpdateInternAccess: () => updateMock,
    useRevokeInternAccess: () => revokeMock,
  };
});

vi.mock("../../infrastructure/auth/auth-client", () => ({
  authClient: { useSession: () => ({ isPending: false }) },
}));

vi.mock("../../infrastructure/convex/convex-client", () => ({
  convexUrl: "https://test.convex.cloud",
  convexSiteUrl: "https://test.convex.site",
  isBackendConfigured: true,
  convexClient: {},
}));

const SESION_PROFESIONAL: WebSessionState = {
  status: "authenticated",
  email: "profesional@uct.cl",
  name: "Profesional Ficticio",
  population: "personal",
};

const PAR_PROFESIONAL = {
  session: SESION_PROFESIONAL,
  role: { status: "authenticated", role: "professional", email: "profesional@uct.cl" },
} as const;

function cuenta(
  overrides: Partial<{
    _id: string;
    email: string;
    fullName: string;
    institutionalStatus: "enabled" | "disabled" | "pending";
    accountStatus: "active" | "inactive";
  }> = {},
) {
  return {
    _id: (overrides._id ?? "intern-1") as Id<"users">,
    email: overrides.email ?? "practicante1@alu.uct.cl",
    fullName: overrides.fullName ?? "Practicante Uno Ficticio",
    role: "intern" as const,
    institutionalStatus: overrides.institutionalStatus ?? ("pending" as const),
    accountStatus: overrides.accountStatus ?? ("active" as const),
  };
}

function pagina(items: ReturnType<typeof cuenta>[]): InternAccountsPage {
  return { page: items, isDone: true, continueCursor: "" };
}

function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return { router };
}

async function openRowMenu(accountName: string, itemName: string) {
  const menu = await screen.findByRole("button", { name: `Acciones para ${accountName}` });
  fireEvent.click(menu);
  return await screen.findByRole("menuitem", { name: itemName });
}

beforeEach(() => {
  mockedSession = SESION_PROFESIONAL;
  mockedPair = PAR_PROFESIONAL;
  internPage = undefined;
  internsDetail = undefined;
  listThrows = null;
  internsThrows = null;
  for (const mock of [enableMock, assignMock, updateMock, revokeMock]) {
    mock.mockReset();
  }
  enableMock.mockResolvedValue({ userId: "intern-1" });
  assignMock.mockResolvedValue("assignment-1");
  updateMock.mockResolvedValue("assignment-1");
  revokeMock.mockResolvedValue(1);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("habilitación de practicantes (TI2-170)", () => {
  test("muestra carga mientras el Backend responde", async () => {
    renderAt("/profesional/practicantes");
    expect(await screen.findByRole("status")).toBeDefined();
  });

  test("lista pendientes y habilita con su operación", async () => {
    internPage = pagina([cuenta({}), cuenta({ _id: "intern-2", fullName: "Practicante Dos" })]);
    renderAt("/profesional/practicantes");

    expect(await screen.findByText("Practicante Uno Ficticio")).toBeDefined();
    const option = await openRowMenu("Practicante Uno Ficticio", "Habilitar cuenta");
    fireEvent.click(option);

    await waitFor(() => expect(enableMock).toHaveBeenCalledWith({ userId: "intern-1" }));
    expect(await screen.findByRole("status")).toBeDefined();
  });

  test("la denegación del Backend muestra acceso denegado sin reintento técnico", async () => {
    listThrows = new ConvexError(UNAUTHORIZED_ERROR_MESSAGE);
    renderAt("/profesional/practicantes");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No autorizado");
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  test("una cuenta habilitada no ofrece habilitar ni muestra acciones", async () => {
    internPage = pagina([cuenta({ institutionalStatus: "enabled" })]);
    renderAt("/profesional/practicantes");

    await screen.findByText("Practicante Uno Ficticio");
    expect(
      screen.queryByRole("button", { name: "Acciones para Practicante Uno Ficticio" }),
    ).toBeNull();
  });
});

describe("asignación por acompañamiento (TI2-170)", () => {
  test("asigna con vigencia opcional y muestra el aviso", async () => {
    const { AccompanimentInternsSection } = await import("./accompaniment-interns.tsx");
    internsDetail = {
      assigned: [],
      assignable: [{ userId: "intern-1", fullName: "Practicante Uno Ficticio" }],
      assignableComplete: true,
    };
    const { render: renderComponent } = await import("@testing-library/react");
    renderComponent(
      <AccompanimentInternsSection
        accompanimentId={"acc-1" as Id<"accompaniments">}
        status="active"
      />,
    );

    fireEvent.change(await screen.findByLabelText("Asignar a otro practicante"), {
      target: { value: "intern-1" },
    });
    fireEvent.change(screen.getByLabelText("Inicio de la vigencia (opcional)"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.change(screen.getByLabelText("Fin de la vigencia (opcional)"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Asignar" }));

    await waitFor(() =>
      expect(assignMock).toHaveBeenCalledWith({
        accompanimentId: "acc-1",
        userId: "intern-1",
        assignedRole: "intern",
        validFrom: Date.UTC(2026, 11, 1),
        validUntil: Date.UTC(2026, 11, 31),
      }),
    );
    expect(await screen.findByRole("status")).toBeDefined();
  });

  test("modificar la vigencia con fin vacío quita ese límite con null", async () => {
    const { AccompanimentInternsSection } = await import("./accompaniment-interns.tsx");
    internsDetail = {
      assigned: [
        {
          userId: "intern-1",
          fullName: "Practicante Uno Ficticio",
          validFrom: Date.UTC(2026, 11, 1),
          validUntil: Date.UTC(2026, 11, 31),
        },
      ],
      assignable: [],
      assignableComplete: true,
    };
    const { render: renderComponent } = await import("@testing-library/react");
    renderComponent(
      <AccompanimentInternsSection
        accompanimentId={"acc-1" as Id<"accompaniments">}
        status="active"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Modificar vigencia" }));
    const fin = await screen.findByLabelText("Fin de la vigencia (opcional)");
    fireEvent.change(fin, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar vigencia" }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith({
        accompanimentId: "acc-1",
        userId: "intern-1",
        assignedRole: "intern",
        validFrom: Date.UTC(2026, 11, 1),
        validUntil: null,
      }),
    );
  });

  test("revocar pide confirmación y llama con rol intern", async () => {
    const { AccompanimentInternsSection } = await import("./accompaniment-interns.tsx");
    internsDetail = {
      assigned: [{ userId: "intern-1", fullName: "Practicante Uno Ficticio" }],
      assignable: [],
      assignableComplete: true,
    };
    const { render: renderComponent } = await import("@testing-library/react");
    renderComponent(
      <AccompanimentInternsSection
        accompanimentId={"acc-1" as Id<"accompaniments">}
        status="active"
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Retirar a Practicante Uno Ficticio" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar el retiro" }));

    await waitFor(() =>
      expect(revokeMock).toHaveBeenCalledWith({
        accompanimentId: "acc-1",
        userId: "intern-1",
        assignedRole: "intern",
      }),
    );
    expect(await screen.findByRole("status")).toBeDefined();
  });

  test("un acompañamiento cerrado no ofrece asignar ni modificar, solo retiros", async () => {
    const { AccompanimentInternsSection } = await import("./accompaniment-interns.tsx");
    internsDetail = {
      assigned: [{ userId: "intern-1", fullName: "Practicante Uno Ficticio" }],
      assignable: [{ userId: "intern-2", fullName: "Practicante Dos" }],
      assignableComplete: true,
    };
    const { render: renderComponent } = await import("@testing-library/react");
    renderComponent(
      <AccompanimentInternsSection
        accompanimentId={"acc-1" as Id<"accompaniments">}
        status="closed"
      />,
    );

    await screen.findByText("Practicante Uno Ficticio");
    expect(screen.queryByLabelText("Asignar a otro practicante")).toBeNull();
    expect(screen.queryByRole("button", { name: "Modificar vigencia" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Retirar a Practicante Uno Ficticio" }),
    ).toBeDefined();
  });
});

describe("cableado de queries del Profesional (TI2-170)", () => {
  test("usa las lecturas nuevas y las mutaciones de TI2-140", async () => {
    const actual = await vi.importActual<typeof import("./professional-interns-data.ts")>(
      "./professional-interns-data.ts",
    );
    expect(actual.INTERN_ACCOUNTS_PAGE_SIZE).toBe(10);
    expect(typeof actual.useInternAccounts).toBe("function");
    expect(typeof actual.useEnableIntern).toBe("function");
    expect(typeof actual.useAccompanimentInterns).toBe("function");
  });
});
