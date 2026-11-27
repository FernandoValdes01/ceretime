// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { OwnNotification } from "./notifications-data.ts";
import { NotificationsPage } from "./notifications-page.tsx";

/**
 * Bandeja Web de avisos (TI2-172) con dobles de `notifications-data.ts`, del
 * navegador (Web Push) y de Better Auth. Que el Backend entregue solo avisos
 * propios y vuelva a exigir el permiso al abrir lo cubren las pruebas de
 * Convex de TI2-154; acá se prueba lo que hace la pantalla con cada respuesta.
 * Datos ficticios.
 */

const store = vi.hoisted(() => ({
  page: { results: [] as unknown[], status: "Exhausted" as string },
  listCalls: [] as Array<string | undefined>,
  open: vi.fn(),
  markRead: vi.fn(),
  push: undefined as unknown,
  activate: vi.fn(),
  deactivate: vi.fn(),
  calendar: undefined as unknown,
  confirm: vi.fn(),
  disconnect: vi.fn(),
  linkSocial: vi.fn(),
  browser: {
    supported: true,
    endpoint: null as string | null,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  },
}));

vi.mock("./notifications-data.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./notifications-data.ts")>();
  return {
    ...original,
    useOwnNotifications: (readStatus: string | undefined) => {
      store.listCalls.push(readStatus);
      return { ...store.page, loadMore: vi.fn() };
    },
    useOpenNotification: () => store.open,
    useMarkNotificationRead: () => store.markRead,
    useOwnPushStatus: () => store.push,
    useActivatePushSubscription: () => store.activate,
    useDeactivatePushSubscription: () => store.deactivate,
    useCalendarLinkStatus: () => store.calendar,
    useConfirmCalendarLink: () => store.confirm,
    useDisconnectCalendarLink: () => store.disconnect,
  };
});

vi.mock("../../infrastructure/notifications/web-push.ts", () => ({
  isWebPushSupported: () => store.browser.supported,
  readBrowserPushEndpoint: async () => store.browser.endpoint,
  subscribeBrowserPush: store.browser.subscribe,
  unsubscribeBrowserPush: store.browser.unsubscribe,
}));

vi.mock("../../infrastructure/auth/auth-client.ts", () => ({
  authClient: { linkSocial: store.linkSocial, useSession: () => ({ isPending: false }) },
}));

vi.mock("../../infrastructure/convex/convex-client", () => ({
  convexUrl: "https://test.convex.cloud",
  convexSiteUrl: "https://test.convex.site",
  isBackendConfigured: true,
  convexClient: {},
}));

function aviso(overrides: Partial<Record<string, unknown>> = {}): OwnNotification {
  return {
    id: "n-1",
    kind: "appointment_rescheduled",
    appointmentId: "apt-1",
    recipientId: "u-1",
    occurredAt: Date.UTC(2026, 10, 20, 15),
    readStatus: "pending",
    version: "v1",
    ...overrides,
  } as OwnNotification;
}

/** Router con la bandeja y los destinos a los que puede navegar. */
async function renderPage(
  audience: "student" | "professional" = "student",
  calendarStatus?: "connected" | "error",
) {
  const rootRoute = createRootRoute();
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <NotificationsPage audience={audience} calendarStatus={calendarStatus} />,
  });
  const targets = [
    "/estudiante/atenciones/$appointmentId",
    "/estudiante/solicitudes/$requestId",
    "/profesional/agenda/$appointmentId",
    "/profesional/solicitudes/$requestId",
  ].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <p>Destino {path}</p>,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([page, ...targets]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
  return router;
}

beforeEach(() => {
  store.page = { results: [], status: "Exhausted" };
  store.listCalls = [];
  store.push = { enabled: false, subscriptionCount: 0, vapidPublicKey: "clave-publica-ficticia" };
  store.calendar = { connected: false, staleEventsMayRemain: false };
  store.browser.supported = true;
  store.browser.endpoint = null;
  for (const fn of [
    store.open,
    store.markRead,
    store.activate,
    store.deactivate,
    store.confirm,
    store.disconnect,
    store.linkSocial,
    store.browser.subscribe,
    store.browser.unsubscribe,
  ]) {
    fn.mockReset();
  }
});

afterEach(() => {
  cleanup();
});

describe("bandeja de avisos", () => {
  test("muestra el texto de cada clase y distingue pendientes de leídos", async () => {
    store.page = {
      results: [
        aviso(),
        aviso({ id: "n-2", kind: "request_accepted", requestId: "req-1", readStatus: "read" }),
      ],
      status: "Exhausted",
    };
    await renderPage();
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Una atención cambió de horario")).toBeDefined();
    expect(within(items[0]).getByText("Pendiente")).toBeDefined();
    expect(within(items[1]).getByText("Se aceptó una solicitud")).toBeDefined();
    expect(within(items[1]).getByText("Leído")).toBeDefined();
    expect(within(items[1]).queryByRole("button", { name: /Marcar como leído/ })).toBeNull();
  });

  test("el filtro pide solo pendientes o leídos al Backend", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Pendientes" }));
    expect(screen.getByRole("button", { name: "Pendientes" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(store.listCalls.at(-1)).toBe("pending");
    expect(screen.getByText("No tienes avisos pendientes.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Leídos" }));
    expect(store.listCalls.at(-1)).toBe("read");
  });

  test("abrir un aviso con permiso vigente lo marca y lleva al detalle del área", async () => {
    store.page = { results: [aviso()], status: "Exhausted" };
    store.open.mockResolvedValue(aviso());
    store.markRead.mockResolvedValue({ id: "n-1", readStatus: "read", readAt: 1 });
    const router = await renderPage("professional");

    fireEvent.click(screen.getByRole("button", { name: /Ver el detalle/ }));
    await waitFor(() => expect(store.markRead).toHaveBeenCalledWith("n-1"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/profesional/agenda/apt-1"));
  });

  test("un aviso de solicitud del Estudiante lleva a su solicitud", async () => {
    const solicitud = aviso({ kind: "request_accepted", requestId: "req-9", readStatus: "read" });
    delete (solicitud as Record<string, unknown>).appointmentId;
    store.page = { results: [solicitud], status: "Exhausted" };
    store.open.mockResolvedValue(solicitud);
    const router = await renderPage("student");

    fireEvent.click(screen.getByRole("button", { name: /Ver el detalle/ }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/estudiante/solicitudes/req-9"),
    );
    expect(store.markRead).not.toHaveBeenCalled();
  });

  test("sin permiso vigente avisa sin revelar el motivo y no navega ni marca", async () => {
    store.page = { results: [aviso()], status: "Exhausted" };
    store.open.mockRejectedValue(
      new ConvexError({ code: "unauthorized", message: "No autorizado" }),
    );
    const router = await renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Ver el detalle/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Ya no tienes acceso al detalle de este aviso/,
    );
    expect(router.state.location.pathname).toBe("/");
    expect(store.markRead).not.toHaveBeenCalled();
  });

  test("marcar como leído no exige abrir el recurso", async () => {
    store.page = { results: [aviso()], status: "Exhausted" };
    store.markRead.mockResolvedValue({ id: "n-1", readStatus: "read", readAt: 1 });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Marcar como leído/ }));
    await waitFor(() => expect(store.markRead).toHaveBeenCalledWith("n-1"));
    expect(store.open).not.toHaveBeenCalled();
  });
});

describe("avisos push", () => {
  test("activar pide permiso al navegador y guarda la suscripción", async () => {
    const subscription = { endpoint: "https://push.example/1", p256dh: "p", auth: "a" };
    store.browser.subscribe.mockResolvedValue({ status: "subscribed", subscription });
    store.activate.mockResolvedValue({ created: true });
    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Activar avisos en este navegador" }),
    );
    await waitFor(() => expect(store.activate).toHaveBeenCalledWith(subscription));
    expect(store.browser.subscribe).toHaveBeenCalledWith("clave-publica-ficticia");
    expect(await screen.findByText("Activamos los avisos en este navegador.")).toBeDefined();
  });

  test("si el navegador niega el permiso, lo explica y no guarda nada", async () => {
    store.browser.subscribe.mockResolvedValue({ status: "permission_denied" });
    await renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Activar avisos en este navegador" }),
    );
    expect(await screen.findByText(/no permitió las notificaciones/)).toBeDefined();
    expect(store.activate).not.toHaveBeenCalled();
  });

  test("desactivar borra la suscripción de este navegador", async () => {
    store.browser.endpoint = "https://push.example/1";
    store.browser.unsubscribe.mockResolvedValue("https://push.example/1");
    store.deactivate.mockResolvedValue({ deleted: true });
    await renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Desactivar avisos en este navegador" }),
    );
    await waitFor(() =>
      expect(store.deactivate).toHaveBeenCalledWith({ endpoint: "https://push.example/1" }),
    );
  });

  test("sin soporte o sin clave del servidor, la bandeja sigue disponible", async () => {
    store.browser.supported = false;
    await renderPage();
    expect(screen.getByText(/Este navegador no admite avisos push/)).toBeDefined();
    cleanup();

    store.browser.supported = true;
    store.push = { enabled: false, subscriptionCount: 0, vapidPublicKey: null };
    await renderPage();
    expect(await screen.findByText(/no están disponibles por ahora/)).toBeDefined();
    expect(screen.getByRole("heading", { name: "Todos los avisos" })).toBeDefined();
  });
});

describe("Google Calendar", () => {
  test("conectar pide solo el permiso de eventos y vuelve a la bandeja", async () => {
    store.linkSocial.mockResolvedValue({ error: null });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Conectar Google Calendar" }));
    await waitFor(() => expect(store.linkSocial).toHaveBeenCalledTimes(1));
    const request = store.linkSocial.mock.calls[0][0] as { scopes: string[]; callbackURL: string };
    expect(request.scopes).toEqual(["https://www.googleapis.com/auth/calendar.events"]);
    expect(request.callbackURL).toBe("/?calendar=connected");
  });

  test("al volver de Google confirma el vínculo en el Backend", async () => {
    store.confirm.mockResolvedValue({ connected: true, linkedAt: 1, status: "linked" });
    await renderPage("student", "connected");
    expect(await screen.findByText(/Google Calendar quedó conectado/)).toBeDefined();
    expect(store.confirm).toHaveBeenCalledTimes(1);
  });

  test("sin el permiso concedido explica que puede seguir con el .ics", async () => {
    store.confirm.mockResolvedValue({ connected: false, status: "not_connected" });
    await renderPage("student", "connected");
    expect(await screen.findByText(/Google no concedió el permiso de eventos/)).toBeDefined();
  });

  test("desconectar pide confirmación y avisa de los eventos anteriores", async () => {
    store.calendar = {
      connected: true,
      linkedAt: Date.UTC(2026, 10, 1),
      staleEventsMayRemain: false,
    };
    store.disconnect.mockResolvedValue({
      disconnected: true,
      status: "unlinked",
      staleEventsMayRemain: true,
    });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Desconectar Google Calendar" }));
    expect(screen.getByText(/los eventos que ya creamos pueden quedar/)).toBeDefined();
    expect(store.disconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar la desconexión" }));
    expect(await screen.findByText(/pueden quedar sin actualizar; puedes borrarlos/)).toBeDefined();
  });

  test("si la desconexión falla, el vínculo sigue igual", async () => {
    store.calendar = { connected: true, staleEventsMayRemain: false };
    store.disconnect.mockRejectedValue(new ConvexError({ code: "conflict", message: "x" }));
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Desconectar Google Calendar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar la desconexión" }));
    expect(await screen.findByText(/No pudimos desconectar Google Calendar/)).toBeDefined();
  });
});
