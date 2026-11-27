// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PrivacyRequestView } from "./privacy-data.ts";
import { PrivacyNoticePage } from "./privacy-notice-page.tsx";
import { StudentPrivacyPage, StudentPrivacyRequestDetailPage } from "./student-privacy.tsx";
import { AdminPrivacyPage, AdminPrivacyRequestDetailPage } from "./admin-privacy.tsx";

/**
 * Pantallas de privacidad (TI2-171) con un doble de `privacy-data.ts`. Que el
 * Backend deniegue solicitudes ajenas y a otros roles lo cubren las pruebas de
 * Convex de TI2-167; acá se prueba que la Web ofrece solo lo que el contrato
 * admite, muestra fechas, prórroga y plazo de reclamo, y no deja resolver sin
 * la vista del responsable. Datos ficticios.
 */

const store = vi.hoisted(() => ({
  request: undefined as unknown,
  own: { results: [] as unknown[], status: "Exhausted" as string },
  queue: { results: [] as unknown[], status: "Exhausted" as string } as unknown,
  submit: vi.fn(),
  start: vi.fn(),
  resolve: vi.fn(),
  extend: vi.fn(),
  record: vi.fn(),
}));

vi.mock("./privacy-data.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./privacy-data.ts")>();
  return {
    ...original,
    usePrivacyRequest: () => {
      if (store.request instanceof Error) throw store.request;
      return store.request;
    },
    useOwnPrivacyRequests: () => ({ ...store.own, loadMore: vi.fn() }),
    usePrivacyRequestQueue: () => {
      if (store.queue instanceof Error) throw store.queue;
      return { ...(store.queue as object), loadMore: vi.fn() };
    },
    useSubmitPrivacyRequest: () => store.submit,
    useStartPrivacyRequestReview: () => store.start,
    useResolvePrivacyRequest: () => store.resolve,
    useExtendPrivacyRequestDeadline: () => store.extend,
    useRecordPrivacyResponseDelivery: () => store.record,
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

const denied = () => new ConvexError({ code: "unauthorized", message: "No autorizado" });

function solicitud(overrides: Partial<Record<string, unknown>> = {}): PrivacyRequestView {
  return {
    id: "pr-1",
    kind: "access",
    status: "received",
    channel: "student_app",
    receivedAt: Date.UTC(2026, 10, 2, 13),
    receivedDate: "2026-11-02",
    initialDueDate: "2026-12-02",
    initialDueAt: Date.UTC(2026, 11, 3, 3),
    dueAt: Date.UTC(2026, 11, 3, 3),
    responseRule: "calendar_30",
    timeZone: "America/Santiago",
    version: "v1",
    view: "own",
    ...overrides,
  } as PrivacyRequestView;
}

function revision(overrides: Partial<Record<string, unknown>> = {}): PrivacyRequestView {
  return solicitud({ view: "review", requesterId: "u-1", requesterRole: "student", ...overrides });
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
  store.request = undefined;
  store.own = { results: [], status: "Exhausted" };
  store.queue = { results: [], status: "Exhausted" };
  for (const fn of [store.submit, store.start, store.resolve, store.extend, store.record]) {
    fn.mockReset();
  }
});

afterEach(() => {
  cleanup();
});

describe("aviso de privacidad público", () => {
  test("se lee sin sesión, con su versión, su estado y las decisiones pendientes", async () => {
    await renderInRouter(<PrivacyNoticePage />);
    const title = screen.getByRole("heading", { level: 1, name: "Aviso de privacidad de CERETI" });
    expect(document.activeElement).toBe(title);
    expect(screen.getByText(/0\.2, borrador del/)).toBeDefined();
    expect(screen.getByText(/no publicado/)).toBeDefined();
    expect(screen.getByRole("heading", { name: "Pendientes antes de publicar" })).toBeDefined();
    expect(screen.getAllByText("Pendiente").length).toBeGreaterThan(5);
  });

  test("cada tabla se recorre con el teclado dentro de su propia región", async () => {
    await renderInRouter(<PrivacyNoticePage />);
    const regions = screen.getAllByRole("region", { name: /^Tabla:/ });
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(region.getAttribute("tabindex")).toBe("0");
      expect(within(region).getByRole("table")).toBeDefined();
    }
  });
});

describe("Estudiante", () => {
  test("ofrece solo los derechos que el Backend recibe", async () => {
    await renderInRouter(<StudentPrivacyPage />);
    const group = screen.getByRole("group", { name: "¿Qué derecho quieres ejercer?" });
    const options = within(group)
      .getAllByRole("radio")
      .map((radio) => (radio as HTMLInputElement).value);
    expect(options).toEqual(["access", "rectification", "erasure", "portability"]);
    expect(within(group).queryByText("Oposición")).toBeNull();
    expect(within(group).queryByText("Bloqueo")).toBeNull();
  });

  test("sin derecho elegido no envía; al presentar muestra el acuse y el plazo", async () => {
    store.submit.mockResolvedValue(solicitud({ kind: "rectification" }));
    await renderInRouter(<StudentPrivacyPage />);

    fireEvent.click(screen.getByRole("button", { name: "Presentar la solicitud" }));
    expect(screen.getByRole("alert").textContent).toBe("Elige el derecho que quieres ejercer.");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /Acceso/ }));
    expect(
      screen
        .getByRole("group", { name: "¿Qué derecho quieres ejercer?" })
        .getAttribute("aria-describedby"),
    ).toBe("student-privacy-kind-error");
    expect(store.submit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: /Rectificación/ }));
    fireEvent.click(screen.getByRole("button", { name: "Presentar la solicitud" }));
    await waitFor(() => expect(store.submit).toHaveBeenCalledWith("rectification"));
    expect(await screen.findByText("Recibimos tu solicitud de rectificación.")).toBeDefined();
    expect(screen.getByText(/Te responderemos hasta el .*2 de diciembre de 2026/)).toBeDefined();
  });

  test("dice qué derechos todavía no se presentan y enlaza el aviso como enlace", async () => {
    await renderInRouter(<StudentPrivacyPage />);
    expect(
      screen.getByText("Oposición y bloqueo todavía no se presentan desde la aplicación."),
    ).toBeDefined();
    const link = screen.getByRole("link", { name: "Leer el aviso de privacidad" });
    expect(link.getAttribute("href")).toBe("/privacidad");
    expect(link.className).toContain("underline");
  });

  test("un rechazo del Backend muestra su mensaje público, no el del SDK", async () => {
    store.submit.mockRejectedValue(
      new ConvexError({
        code: "privacy_request_fields_invalid",
        message: "El derecho elegido todavía no está disponible en la aplicación.",
      }),
    );
    await renderInRouter(<StudentPrivacyPage />);
    fireEvent.click(screen.getByRole("radio", { name: /Acceso/ }));
    fireEvent.click(screen.getByRole("button", { name: "Presentar la solicitud" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "El derecho elegido todavía no está disponible en la aplicación.",
    );
  });

  test("sin solicitudes explica que aparecerán con su plazo", async () => {
    await renderInRouter(<StudentPrivacyPage />);
    expect(screen.getByText("Todavía no presentas solicitudes de privacidad.")).toBeDefined();
  });

  test("una solicitud ajena muestra acceso denegado", async () => {
    store.request = denied();
    await renderInRouter(<StudentPrivacyRequestDetailPage requestId="pr-ajena" />);
    expect(screen.getByText("No tienes acceso a esta solicitud de privacidad.")).toBeDefined();
  });

  test("el detalle muestra la prórroga, la respuesta fundada y el plazo para reclamar", async () => {
    store.request = solicitud({
      status: "resolved",
      extension: {
        days: 10,
        extendedUntilDate: "2026-12-12",
        extendedUntilAt: 0,
        extendedAt: 0,
        reason: "Motivo ficticio de prórroga",
      },
      response: {
        outcome: "denied",
        reasons: "Fundamento ficticio",
        respondedAt: Date.UTC(2026, 11, 1, 15),
      },
      deliveryReceipt: {
        channel: "student_app",
        sentAt: Date.UTC(2026, 11, 1, 16),
        reference: "FOLIO-FICTICIO-1",
        agencyClaimDueDate: "2027-01-13",
        agencyClaimDueAt: 0,
      },
      effect: "preserved",
    });
    await renderInRouter(<StudentPrivacyRequestDetailPage requestId="pr-1" />);
    expect(screen.getByText(/Hasta el .*12 de diciembre de 2026 \(con prórroga\)/)).toBeDefined();
    expect(screen.getByText(/10 días más .*Motivo ficticio de prórroga/)).toBeDefined();
    expect(screen.getByText("Denegada")).toBeDefined();
    expect(screen.getByText("Fundamento ficticio")).toBeDefined();
    expect(screen.getByText(/13 de enero de 2027.*30 días hábiles/)).toBeDefined();
    expect(screen.getByText(/conserva los datos/)).toBeDefined();
  });

  test("una denegación sin constancia ya explica el reclamo, sin el paso interno", async () => {
    store.request = solicitud({
      status: "resolved",
      response: { outcome: "denied", reasons: "Fundamento ficticio", respondedAt: 0 },
    });
    await renderInRouter(<StudentPrivacyRequestDetailPage requestId="pr-1" />);
    expect(screen.getByText("Reclamo ante la Agencia")).toBeDefined();
    expect(
      screen.getByText(/30 días hábiles siguientes a la notificación de esta respuesta/),
    ).toBeDefined();
    expect(screen.queryByText("Pendiente de registrar.")).toBeNull();
  });

  test("una concesión no muestra el plazo para reclamar", async () => {
    store.request = solicitud({
      status: "resolved",
      response: { outcome: "granted", reasons: "Fundamento", respondedAt: 0 },
      deliveryReceipt: {
        channel: "email",
        sentAt: 0,
        reference: "F-1",
        agencyClaimDueDate: "2027-01-13",
        agencyClaimDueAt: 0,
      },
    });
    await renderInRouter(<StudentPrivacyRequestDetailPage requestId="pr-1" />);
    expect(screen.queryByText("Plazo para reclamar ante la Agencia")).toBeNull();
  });
});

describe("Administrador", () => {
  test("otro rol recibe acceso denegado en la cola", async () => {
    store.queue = denied();
    await renderInRouter(<AdminPrivacyPage />);
    expect(screen.getByText(/Solo el responsable de privacidad/)).toBeDefined();
  });

  test("sin la vista del responsable no ofrece acciones", async () => {
    store.request = solicitud({ view: "own" });
    await renderInRouter(<AdminPrivacyRequestDetailPage requestId="pr-1" />);
    expect(screen.getByText("No tienes acceso a esta solicitud de privacidad.")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("una solicitud recibida se toma para revisión", async () => {
    store.request = revision();
    store.start.mockResolvedValue(undefined);
    await renderInRouter(<AdminPrivacyRequestDetailPage requestId="pr-1" />);
    expect(screen.queryByRole("heading", { name: "Resolver" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tomar para revisión" }));
    await waitFor(() => expect(store.start).toHaveBeenCalledWith("pr-1"));
    expect(await screen.findByText("La solicitud quedó en revisión.")).toBeDefined();
  });

  test("resolver exige resultado y fundamento, y envía la respuesta", async () => {
    store.request = revision({ status: "in_review" });
    store.resolve.mockResolvedValue(undefined);
    await renderInRouter(<AdminPrivacyRequestDetailPage requestId="pr-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Resolver la solicitud" }));
    expect(screen.getByRole("alert").textContent).toBe("Elige el resultado de la respuesta.");
    expect(screen.getByRole("group", { name: "Resultado" }).getAttribute("aria-describedby")).toBe(
      "privacy-outcome-error",
    );
    expect(screen.getByLabelText("Fundamento").getAttribute("aria-describedby")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Concedida" }));
    fireEvent.click(screen.getByRole("radio", { name: "Denegada" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolver la solicitud" }));
    expect(screen.getByRole("alert").textContent).toBe("Escribe el fundamento de la respuesta.");
    const reasons = screen.getByLabelText("Fundamento");
    expect(reasons.getAttribute("aria-describedby")).toBe("privacy-reasons-error");
    expect(reasons.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(reasons);
    expect(store.resolve).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Fundamento"), {
      target: { value: "  Fundamento ficticio  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolver la solicitud" }));
    await waitFor(() =>
      expect(store.resolve).toHaveBeenCalledWith({
        requestId: "pr-1",
        outcome: "denied",
        reasons: "Fundamento ficticio",
      }),
    );
  });

  test("un conflicto del Backend muestra su mensaje", async () => {
    store.request = revision({ status: "in_review" });
    store.extend.mockRejectedValue(
      new ConvexError({ code: "conflict", message: "La solicitud ya tiene una prórroga." }),
    );
    await renderInRouter(<AdminPrivacyRequestDetailPage requestId="pr-1" />);
    fireEvent.change(screen.getByLabelText("Días de prórroga"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Motivo ficticio" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar la prórroga" }));
    await waitFor(() =>
      expect(store.extend).toHaveBeenCalledWith({
        requestId: "pr-1",
        days: 5,
        reason: "Motivo ficticio",
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La solicitud ya tiene una prórroga.",
    );
  });

  test("con prórroga aplicada ya no la ofrece", async () => {
    store.request = revision({
      status: "in_review",
      extension: {
        days: 5,
        extendedUntilDate: "2026-12-07",
        extendedUntilAt: 0,
        extendedAt: 0,
        reason: "Motivo",
      },
    });
    await renderInRouter(<AdminPrivacyRequestDetailPage requestId="pr-1" />);
    expect(screen.queryByRole("heading", { name: "Prorrogar el plazo" })).toBeNull();
  });

  test("una solicitud resuelta sin constancia registra el envío", async () => {
    store.request = revision({
      status: "resolved",
      response: { outcome: "partially_granted", reasons: "Fundamento", respondedAt: 0 },
    });
    store.record.mockResolvedValue(undefined);
    await renderInRouter(<AdminPrivacyRequestDetailPage requestId="pr-1" />);
    expect(screen.getByText("Pendiente de registrar.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Registrar el envío" }));
    const folio = screen.getByLabelText("Folio o referencia");
    expect(screen.getByRole("alert").textContent).toBe(
      "Escribe el folio o la referencia del envío.",
    );
    expect(folio.getAttribute("aria-describedby")).toBe(
      "privacy-delivery-hint privacy-delivery-error",
    );
    expect(document.activeElement).toBe(folio);
    expect(store.record).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Canal"), { target: { value: "email" } });
    fireEvent.change(screen.getByLabelText("Folio o referencia"), {
      target: { value: "FOLIO-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar el envío" }));
    await waitFor(() =>
      expect(store.record).toHaveBeenCalledWith({
        requestId: "pr-1",
        channel: "email",
        reference: "FOLIO-1",
      }),
    );
  });
});
