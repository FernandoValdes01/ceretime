// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_ERROR_MESSAGE } from "../../../../../convex/domain/index.ts";
import type {
  FollowUpHistoryPage,
  FollowUpRecordView,
} from "../shared/follow-up/follow-up-data.ts";
import { StudentAppointmentFollowUp, StudentFollowUpHistory } from "./student-follow-up.tsx";

/**
 * Seguimiento visto por el Estudiante (TI2-166).
 *
 * La lectura sale de un doble de `follow-up-data.ts`: que el Backend entregue
 * al Estudiante solo la vista `shared` lo cubren las pruebas de Convex de
 * TI2-146. Acá se prueba que la pantalla no muestra la nota interna aunque la
 * respuesta la trajera, que el historial no mezcla acompañamientos y los
 * estados de la sección. Datos ficticios.
 */

const store = vi.hoisted(() => ({
  record: undefined as unknown,
  historyCalls: [] as string[],
  history: new Map<string, unknown>(),
}));

vi.mock("../shared/follow-up/follow-up-data.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../shared/follow-up/follow-up-data.ts")>();
  return {
    ...original,
    useFollowUpRecord: () => {
      if (store.record instanceof Error) throw store.record;
      return store.record;
    },
    useFollowUpHistory: (accompanimentId: string) => {
      store.historyCalls.push(accompanimentId);
      return store.history.get(accompanimentId);
    },
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

const NOTA_INTERNA = "Nota interna ficticia que no se comparte";

function registro(overrides: Partial<FollowUpRecordView> = {}): FollowUpRecordView {
  return {
    appointmentId: "apt-1",
    accompanimentId: "acc-1",
    appointmentStatus: "completed",
    // Lunes 16-11-2026, 10:00 en Santiago.
    appointmentStartsAt: Date.UTC(2026, 10, 16, 13),
    agreements: [{ description: "Acuerdo ficticio" }],
    tasks: [{ description: "Tarea ficticia", responsible: "student", status: "pending" }],
    nextSteps: "Próximos pasos ficticios",
    suggestedNextAppointmentDate: "2027-01-11",
    // El Backend no la entrega al Estudiante; se incluye para probar la pantalla.
    internalNote: NOTA_INTERNA,
    view: "professional",
    ...overrides,
  } as FollowUpRecordView;
}

function pagina(items: FollowUpRecordView[]): FollowUpHistoryPage {
  return { items, hasMore: false, nextCursor: null, version: "v1" } as FollowUpHistoryPage;
}

async function renderInRouter(ui: ReactNode) {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
}

beforeEach(() => {
  store.record = undefined;
  store.historyCalls = [];
  store.history = new Map();
});

afterEach(() => {
  cleanup();
});

describe("seguimiento de una atención", () => {
  test("muestra acuerdos, tareas y próximos pasos, y nunca la nota interna", async () => {
    store.record = registro();
    await renderInRouter(
      <StudentAppointmentFollowUp appointmentId="apt-1" appointmentStatus="completed" />,
    );

    const section = await screen.findByRole("region", { name: "Seguimiento de esta atención" });
    expect(within(section).getByText("Acuerdo ficticio")).toBeTruthy();
    expect(within(section).getByText("Tarea ficticia")).toBeTruthy();
    expect(within(section).getByText("Próximos pasos ficticios")).toBeTruthy();
    expect(screen.queryByText(NOTA_INTERNA)).toBeNull();
    expect(screen.queryByText(/nota interna/i)).toBeNull();
    expect(screen.queryByText(/Se comparte con el estudiante/)).toBeNull();
    expect(
      within(section).getByRole("link", { name: "Ver el acompañamiento" }).getAttribute("href"),
    ).toBe("/estudiante/acompanamientos/acc-1");
  });

  test("sin seguimiento registrado lo dice sin inventar contenido", async () => {
    store.record = null;
    await renderInRouter(
      <StudentAppointmentFollowUp appointmentId="apt-1" appointmentStatus="no_show" />,
    );
    expect(
      await screen.findByText("Esta atención todavía no tiene seguimiento registrado."),
    ).toBeTruthy();
  });

  test("una atención que no admite seguimiento no muestra la sección", async () => {
    store.record = registro();
    await renderInRouter(
      <>
        <p>Detalle</p>
        <StudentAppointmentFollowUp appointmentId="apt-1" appointmentStatus="scheduled" />
      </>,
    );
    await screen.findByText("Detalle");
    expect(screen.queryByRole("region", { name: "Seguimiento de esta atención" })).toBeNull();
  });

  test("la denegación del Backend se muestra sin reintento", async () => {
    store.record = new ConvexError(UNAUTHORIZED_ERROR_MESSAGE);
    await renderInRouter(
      <StudentAppointmentFollowUp appointmentId="apt-1" appointmentStatus="completed" />,
    );
    expect(
      await screen.findByText("No tienes acceso al seguimiento de esta atención."),
    ).toBeTruthy();
  });
});

describe("historial de seguimiento del acompañamiento", () => {
  test("solo lee el acompañamiento pedido y no mezcla otros", async () => {
    store.history.set(
      "acc-1",
      pagina([registro({ agreements: [{ description: "Acuerdo del primero" }] })]),
    );
    store.history.set(
      "acc-2",
      pagina([
        registro({
          appointmentId: "apt-9",
          accompanimentId: "acc-2",
          agreements: [{ description: "Acuerdo del segundo" }],
        }),
      ]),
    );
    await renderInRouter(<StudentFollowUpHistory accompanimentId="acc-1" />);

    expect(await screen.findByText("Acuerdo del primero")).toBeTruthy();
    expect(screen.queryByText("Acuerdo del segundo")).toBeNull();
    expect(new Set(store.historyCalls)).toEqual(new Set(["acc-1"]));
    expect(screen.queryByText(NOTA_INTERNA)).toBeNull();
    expect(screen.getByRole("link", { name: "Ver la atención" }).getAttribute("href")).toBe(
      "/estudiante/atenciones/apt-1",
    );
  });

  test("cada seguimiento del historial se distingue por la fecha de su atención", async () => {
    store.history.set(
      "acc-1",
      pagina([
        registro({ appointmentId: "apt-2", appointmentStartsAt: Date.UTC(2026, 10, 23, 13) }),
        registro(),
      ]),
    );
    await renderInRouter(<StudentFollowUpHistory accompanimentId="acc-1" />);

    expect(
      await screen.findByText("Atención del lunes, 23 de noviembre de 2026 · Realizada"),
    ).toBeTruthy();
    expect(
      screen.getByText("Atención del lunes, 16 de noviembre de 2026 · Realizada"),
    ).toBeTruthy();
    expect(
      screen.getByRole("article", {
        name: "Seguimiento de la atención del lunes, 16 de noviembre de 2026",
      }),
    ).toBeTruthy();
  });

  test("sin seguimientos explica quién los registra", async () => {
    store.history.set("acc-1", pagina([]));
    await renderInRouter(<StudentFollowUpHistory accompanimentId="acc-1" />);
    expect(
      await screen.findByText("Este acompañamiento todavía no tiene seguimientos."),
    ).toBeTruthy();
    expect(
      screen.getByText("Tu profesional registra el seguimiento después de cada atención."),
    ).toBeTruthy();
  });
});
