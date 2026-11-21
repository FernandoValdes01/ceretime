// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CONFLICT_ERROR_CODE,
  UNAUTHORIZED_ERROR_MESSAGE,
} from "../../../../../convex/domain/index.ts";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { AssignedAccompanimentsPage } from "./practitioner-accompaniments-data.ts";
import type { FollowUpHistoryPage, FollowUpRecordView } from "./follow-up-data.ts";
import type { ClosurePreviewState } from "./professional-accompaniments-data.ts";
import { accompanimentActions } from "./professional-accompaniments-data.ts";

/**
 * Pruebas de los acompañamientos del Profesional (TI2-165).
 *
 * Integración por el router real, con guardias. Las lecturas salen de un
 * store reactivo simulado y las mutaciones son espías: la política de estados
 * y la autorización las cubren las pruebas de Convex de TI2-152. Acá se
 * prueba qué acciones ofrece la vista según el estado, qué envía y cómo
 * muestra el resultado. Todos los datos son ficticios.
 */

type AccompanimentView = AssignedAccompanimentsPage["items"][number];
type Outcome<T> = T | undefined | Error;

const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    pages: new Map<string, unknown>(),
    details: new Map<string, unknown>(),
    preview: { status: "loading" } as unknown,
    team: undefined as unknown,
    history: new Map<string, unknown>(),
    historyCalls: [] as Array<string | null>,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
    notify: () => {
      version += 1;
      listeners.forEach((listener) => listener());
    },
    reset() {
      this.pages.clear();
      this.details.clear();
      this.preview = { status: "loading" };
      this.team = EQUIPO;
      this.history.clear();
      this.historyCalls.length = 0;
      listeners.clear();
    },
  };
});

const EQUIPO = vi.hoisted(() => ({
  assigned: [
    { userId: "pro-1", fullName: "Profesional Uno Ficticio", assignedAt: 1, isCaller: true },
    { userId: "pro-2", fullName: "Profesional Dos Ficticio", isCaller: false },
  ],
  assignable: [{ userId: "pro-3", fullName: "Profesional Tres Ficticio" }],
  assignableComplete: true,
}));

const mutations = vi.hoisted(() => ({
  assign: vi.fn(),
  revoke: vi.fn(),
  pause: vi.fn(),
  reactivate: vi.fn(),
  close: vi.fn(),
}));

let mockedSession: WebSessionState;
let mockedPair: { session: WebSessionState; role: WebSessionRole } | undefined;

vi.mock("convex/react", () => ({
  useQuery: () => mockedSession,
  useMutation: () => vi.fn(),
}));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () => mockedPair,
}));

vi.mock("./practitioner-accompaniments-data.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./practitioner-accompaniments-data.ts")>();
  const { useSyncExternalStore } = await import("react");
  function resolve<T>(outcome: Outcome<T>): T | undefined {
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  }
  return {
    ...original,
    useAssignedAccompaniments: (after: string | undefined) => {
      useSyncExternalStore(store.subscribe, store.getVersion);
      return resolve(store.pages.get(after ?? "first") as Outcome<AssignedAccompanimentsPage>);
    },
    useAssignedAccompanimentDetail: (accompanimentId: string) => {
      useSyncExternalStore(store.subscribe, store.getVersion);
      return resolve(store.details.get(accompanimentId) as Outcome<AccompanimentView>);
    },
  };
});

vi.mock("./professional-accompaniments-data.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./professional-accompaniments-data.ts")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...original,
    usePauseAccompaniment: () => mutations.pause,
    useReactivateAccompaniment: () => mutations.reactivate,
    useCloseAccompaniment: () => mutations.close,
    useAssignAccompanimentAccess: () => mutations.assign,
    useRevokeAccompanimentAccess: () => mutations.revoke,
    useAccompanimentProfessionals: () => {
      useSyncExternalStore(store.subscribe, store.getVersion);
      if (store.team instanceof Error) throw store.team;
      return store.team;
    },
    useClosurePreview: () => {
      useSyncExternalStore(store.subscribe, store.getVersion);
      return store.preview as ClosurePreviewState;
    },
  };
});

vi.mock("./follow-up-data.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./follow-up-data.ts")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...original,
    useFollowUpHistory: (_accompanimentId: string, cursor: string | null) => {
      useSyncExternalStore(store.subscribe, store.getVersion);
      store.historyCalls.push(cursor);
      return store.history.get(cursor ?? "first") ?? (cursor === null ? EMPTY_HISTORY : undefined);
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

const EMPTY_HISTORY = vi.hoisted(() => ({
  items: [],
  hasMore: false,
  nextCursor: null,
  version: "v1",
}));

const OBJETIVO_1 = "Objetivo ficticio uno";
const OBJETIVO_2 = "Objetivo ficticio dos";
const NECESIDAD = "Necesidad de acceso ficticia";

function completo(
  id: string,
  objective: string,
  status: AccompanimentView["status"] = "active",
): AccompanimentView {
  return {
    _id: id as Id<"accompaniments">,
    studentId: "stu-ficticio" as Id<"users">,
    status,
    objective,
    accessNeeds: NECESIDAD,
    referenceCode: "CER-7KQ2-M9XD",
    view: "full",
  };
}

function seguimiento(appointmentId: string, internalNote?: string): FollowUpRecordView {
  return {
    appointmentId,
    accompanimentId: "acc-1",
    appointmentStatus: "completed",
    agreements: [{ description: "Acuerdo ficticio" }],
    tasks: [{ description: "Tarea ficticia", responsible: "student", status: "pending" }],
    nextSteps: "Próximos pasos ficticios",
    suggestedNextAppointmentDate: "2026-11-23",
    ...(internalNote === undefined ? {} : { internalNote }),
    version: "v1",
    view: "professional",
  };
}

function historial(
  items: FollowUpRecordView[],
  nextCursor: string | null = null,
): FollowUpHistoryPage {
  return { items, hasMore: nextCursor !== null, nextCursor, version: "v1" };
}

function pagina(items: AccompanimentView[]): AssignedAccompanimentsPage {
  return { items, hasMore: false, lastId: (items.at(-1)?._id ?? null) as Id<"accompaniments"> };
}

function update(change: () => void) {
  act(() => {
    change();
    store.notify();
  });
}

function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return { router };
}

function statusSection() {
  return screen.getByRole("region", { name: "Estado del acompañamiento" });
}

beforeEach(() => {
  store.reset();
  mutations.pause.mockReset();
  mutations.reactivate.mockReset();
  mutations.close.mockReset();
  mutations.assign.mockReset();
  mutations.revoke.mockReset();
  mockedSession = SESION_PROFESIONAL;
  mockedPair = PAR_PROFESIONAL;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("acciones según el estado (TI2-165)", () => {
  test("salen de la tabla canónica y un cerrado no tiene ninguna", () => {
    expect(accompanimentActions("active")).toEqual(["pause", "close"]);
    expect(accompanimentActions("paused")).toEqual(["reactivate", "close"]);
    expect(accompanimentActions("closed")).toEqual([]);
  });
});

describe("listado del Profesional (TI2-165)", () => {
  test("cada fila abre su propio detalle y no muestra las necesidades de acceso", async () => {
    store.pages.set(
      "first",
      pagina([completo("acc-1", OBJETIVO_1), completo("acc-2", OBJETIVO_2, "paused")]),
    );
    renderAt("/profesional/acompanamientos");

    const first = await screen.findByRole("link", { name: /Objetivo ficticio uno/ });
    const second = screen.getByRole("link", { name: /Objetivo ficticio dos/ });
    expect(first.getAttribute("href")).toBe("/profesional/acompanamientos/acc-1");
    expect(second.getAttribute("href")).toBe("/profesional/acompanamientos/acc-2");
    expect(within(second).getByText("Pausado")).toBeDefined();
    expect(document.body.textContent).not.toContain(NECESIDAD);
    const nav = screen.getByRole("navigation", { name: /Portal del Profesional/ });
    expect(
      within(nav).getByRole("link", { name: "Acompañamientos" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  test("sin acompañamientos muestra el vacío", async () => {
    store.pages.set("first", pagina([]));
    renderAt("/profesional/acompanamientos");

    expect(await screen.findByText("No tienes acompañamientos asignados.")).toBeDefined();
  });

  test("el Practicante no entra al listado del Profesional", async () => {
    mockedPair = {
      session: SESION_PROFESIONAL,
      role: { status: "authenticated", role: "intern", email: "profesional@uct.cl" },
    };
    store.pages.set("first", pagina([completo("acc-1", OBJETIVO_1)]));
    const { router } = renderAt("/profesional/acompanamientos");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByText(OBJETIVO_1)).toBeNull();
  });
});

describe("detalle del Profesional (TI2-165)", () => {
  test("activo: ofrece pausar y cerrar, y pausar envía solo el acompañamiento", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1));
    mutations.pause.mockResolvedValue({ accompanimentId: "acc-1", status: "paused" });
    renderAt("/profesional/acompanamientos/acc-1");

    expect(await screen.findByText(NECESIDAD)).toBeDefined();
    const section = statusSection();
    expect(within(section).queryByRole("button", { name: /Reactivar/ })).toBeNull();
    fireEvent.click(within(section).getByRole("button", { name: "Pausar el acompañamiento" }));

    expect(await within(section).findByRole("status")).toHaveProperty(
      "textContent",
      "Acompañamiento pausado.",
    );
    expect(mutations.pause).toHaveBeenCalledWith({ accompanimentId: "acc-1" });
  });

  test("pausado: ofrece reactivar y cerrar, no pausar", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1, "paused"));
    mutations.reactivate.mockResolvedValue({ accompanimentId: "acc-1", status: "active" });
    renderAt("/profesional/acompanamientos/acc-1");

    await screen.findByText(OBJETIVO_1);
    const section = statusSection();
    expect(within(section).queryByRole("button", { name: /Pausar/ })).toBeNull();
    expect(within(section).getByRole("button", { name: "Cerrar el acompañamiento" })).toBeDefined();
    fireEvent.click(within(section).getByRole("button", { name: "Reactivar el acompañamiento" }));
    await waitFor(() =>
      expect(mutations.reactivate).toHaveBeenCalledWith({ accompanimentId: "acc-1" }),
    );
  });

  test("cerrado: no ofrece ninguna acción de cambio", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1, "closed"));
    renderAt("/profesional/acompanamientos/acc-1");

    await screen.findByText(OBJETIVO_1);
    const section = statusSection();
    expect(within(section).queryAllByRole("button")).toHaveLength(0);
    expect(section.textContent).toContain("no se reabre");
  });

  test("un rechazo del Backend se muestra con un mensaje propio, sin el texto del SDK", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1));
    mutations.pause.mockRejectedValue(
      new ConvexError({ code: CONFLICT_ERROR_CODE, message: "texto interno ficticio" }),
    );
    renderAt("/profesional/acompanamientos/acc-1");

    await screen.findByText(OBJETIVO_1);
    fireEvent.click(screen.getByRole("button", { name: "Pausar el acompañamiento" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "El acompañamiento cambió mientras lo revisabas",
    );
    expect(document.body.textContent).not.toContain("texto interno ficticio");
  });

  test("otra cuenta o un acompañamiento inexistente reciben la misma denegación", async () => {
    store.details.set("acc-ajeno", new ConvexError(UNAUTHORIZED_ERROR_MESSAGE));
    renderAt("/profesional/acompanamientos/acc-ajeno");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No tienes acceso a este acompañamiento.",
    );
  });
});

describe("cierre del acompañamiento (TI2-165)", () => {
  test("muestra cuántas atenciones cancela y envía el motivo recortado", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1));
    mutations.close.mockResolvedValue({
      accompanimentId: "acc-1",
      status: "closed",
      cancelledAppointments: 2,
    });
    renderAt("/profesional/acompanamientos/acc-1");

    await screen.findByText(OBJETIVO_1);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar el acompañamiento" }));
    const confirm = screen.getByRole("button", { name: "Confirmar el cierre" });
    expect(confirm.hasAttribute("disabled")).toBe(true);

    update(() => {
      store.preview = { status: "ok", appointmentsToCancel: 2, unrecordedAppointments: 0 };
    });
    expect(screen.getByText(/Se cancelarán 2 atenciones futuras/)).toBeDefined();
    fireEvent.change(screen.getByLabelText("Motivo del cierre (opcional)"), {
      target: { value: "  Objetivo cumplido  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar el cierre" }));

    expect((await within(statusSection()).findByRole("status")).textContent).toBe(
      "Acompañamiento cerrado. Se cancelaron 2 atenciones futuras.",
    );
    expect(mutations.close).toHaveBeenCalledWith({
      accompanimentId: "acc-1",
      reason: "Objetivo cumplido",
    });
  });

  test("sin motivo no envía la clave", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1));
    store.preview = { status: "ok", appointmentsToCancel: 0, unrecordedAppointments: 0 };
    mutations.close.mockResolvedValue({
      accompanimentId: "acc-1",
      status: "closed",
      cancelledAppointments: 0,
    });
    renderAt("/profesional/acompanamientos/acc-1");

    await screen.findByText(OBJETIVO_1);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar el acompañamiento" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar el cierre" }));
    await waitFor(() => expect(mutations.close).toHaveBeenCalledWith({ accompanimentId: "acc-1" }));
  });

  test("con una atención pasada sin registrar no deja confirmar y explica qué hacer", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1, "paused"));
    store.preview = { status: "ok", appointmentsToCancel: 1, unrecordedAppointments: 1 };
    renderAt("/profesional/acompanamientos/acc-1");

    await screen.findByText(OBJETIVO_1);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar el acompañamiento" }));
    expect(screen.getByRole("alert").textContent).toContain("Reactiva el acompañamiento");
    expect(
      screen.getByRole("button", { name: "Confirmar el cierre" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "No cerrar" }));
    expect(screen.queryByRole("button", { name: "Confirmar el cierre" })).toBeNull();
    expect(mutations.close).not.toHaveBeenCalled();
  });
});

describe("historial de seguimiento (TI2-165)", () => {
  test("separa lo compartido de la nota interna con texto, sin depender del color", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1, "closed"));
    store.history.set("first", historial([seguimiento("apt-1", "Nota interna ficticia")]));
    renderAt("/profesional/acompanamientos/acc-1");

    const history = await screen.findByRole("region", { name: "Historial de seguimiento" });
    const shared = within(history).getByRole("region", { name: "Se comparte con el estudiante" });
    const internal = within(history).getByRole("region", { name: "Nota interna: no se comparte" });
    expect(shared.textContent).toContain("Acuerdo ficticio");
    expect(shared.textContent).toContain("Responsable: Estudiante. Estado: Pendiente.");
    expect(shared.textContent).not.toContain("Nota interna ficticia");
    expect(internal.textContent).toContain("Nota interna ficticia");
    expect(history.textContent).toContain("no se puede editar");
    expect(within(history).queryAllByRole("button")).toHaveLength(0);
    expect(
      within(history).getByRole("link", { name: "Ver la atención" }).getAttribute("href"),
    ).toBe("/profesional/agenda/apt-1");
  });

  test("sin nota interna no muestra el bloque interno", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1));
    store.history.set("first", historial([seguimiento("apt-1")]));
    renderAt("/profesional/acompanamientos/acc-1");

    await screen.findByText("Acuerdo ficticio");
    expect(screen.queryByRole("region", { name: "Nota interna: no se comparte" })).toBeNull();
  });

  test("sin seguimientos muestra el vacío", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1));
    renderAt("/profesional/acompanamientos/acc-1");

    expect(
      await screen.findByText("Este acompañamiento todavía no tiene seguimientos."),
    ).toBeDefined();
  });

  test("Cargar más pide la página siguiente con el cursor recibido", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1));
    store.history.set("first", historial([seguimiento("apt-1")], "cursor-1"));
    renderAt("/profesional/acompanamientos/acc-1");

    fireEvent.click(await screen.findByRole("button", { name: "Cargar más" }));
    expect(store.historyCalls).toContain("cursor-1");
    update(() => store.history.set("cursor-1", historial([seguimiento("apt-2")])));
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "Ver la atención" })).toHaveLength(2),
    );
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });
});

describe("cambio de profesionales (TI2-165)", () => {
  function teamSection() {
    return screen.getByRole("region", { name: "Profesionales del acompañamiento" });
  }

  test("muestra a los asignados con nombre y asigna a quien se elige", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1));
    mutations.assign.mockResolvedValue("asignacion-1");
    renderAt("/profesional/acompanamientos/acc-1");

    await screen.findByText(OBJETIVO_1);
    const team = teamSection();
    expect(team.textContent).toContain("Profesional Uno Ficticio (tú)");
    expect(team.textContent).toContain("Profesional Dos Ficticio");
    const assign = within(team).getByRole("button", { name: "Asignar" });
    expect(assign.hasAttribute("disabled")).toBe(true);
    fireEvent.change(within(team).getByLabelText("Asignar a otro profesional"), {
      target: { value: "pro-3" },
    });
    fireEvent.click(within(team).getByRole("button", { name: "Asignar" }));

    expect((await within(team).findByRole("status")).textContent).toBe(
      "Se asignó el acompañamiento a Profesional Tres Ficticio.",
    );
    expect(mutations.assign).toHaveBeenCalledWith({
      accompanimentId: "acc-1",
      userId: "pro-3",
      assignedRole: "professional",
    });
  });

  test("retirar pide confirmación antes de enviar", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1, "paused"));
    mutations.revoke.mockResolvedValue(1);
    renderAt("/profesional/acompanamientos/acc-1");

    await screen.findByText(OBJETIVO_1);
    const team = teamSection();
    fireEvent.click(
      within(team).getByRole("button", { name: "Retirar a Profesional Dos Ficticio" }),
    );
    expect(mutations.revoke).not.toHaveBeenCalled();
    expect(team.textContent).toContain("Sus atenciones futuras siguen a su nombre");
    fireEvent.click(within(team).getByRole("button", { name: "Confirmar el retiro" }));

    await waitFor(() =>
      expect(mutations.revoke).toHaveBeenCalledWith({
        accompanimentId: "acc-1",
        userId: "pro-2",
        assignedRole: "professional",
      }),
    );
  });

  test("retirarse avisa que se pierde el acceso", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1));
    renderAt("/profesional/acompanamientos/acc-1");

    await screen.findByText(OBJETIVO_1);
    const team = teamSection();
    fireEvent.click(within(team).getByRole("button", { name: "Retirarme" }));
    expect(team.textContent).toContain("dejas de ver este acompañamiento");
    fireEvent.click(within(team).getByRole("button", { name: "No retirar" }));
    expect(within(team).getByRole("button", { name: "Retirarme" })).toBeDefined();
  });

  test("un acompañamiento cerrado muestra el equipo sin acciones", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1, "closed"));
    renderAt("/profesional/acompanamientos/acc-1");

    await screen.findByText(OBJETIVO_1);
    const team = teamSection();
    expect(team.textContent).toContain("Profesional Dos Ficticio");
    expect(within(team).queryAllByRole("button")).toHaveLength(0);
    expect(within(team).queryByRole("combobox")).toBeNull();
  });

  test("un rechazo al asignar se muestra sin el texto del SDK", async () => {
    store.details.set("acc-1", completo("acc-1", OBJETIVO_1));
    mutations.assign.mockRejectedValue(
      new ConvexError({ code: CONFLICT_ERROR_CODE, message: "texto interno ficticio" }),
    );
    renderAt("/profesional/acompanamientos/acc-1");

    await screen.findByText(OBJETIVO_1);
    const team = teamSection();
    fireEvent.change(within(team).getByLabelText("Asignar a otro profesional"), {
      target: { value: "pro-3" },
    });
    fireEvent.click(within(team).getByRole("button", { name: "Asignar" }));
    expect((await within(team).findByRole("alert")).textContent).toContain(
      "sus asignaciones cambiaron",
    );
    expect(document.body.textContent).not.toContain("texto interno ficticio");
  });
});
