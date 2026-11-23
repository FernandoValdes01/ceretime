// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { OwnRequestSubmission, SubmitOwnRequestOutcome } from "./student-request-form-data.ts";

/**
 * Formulario de solicitud del Estudiante (TI2-149).
 *
 * Integración por el router real (incluye guardias). El envío se simula por
 * módulo; la traducción de errores la prueba `student-request-form-data.test.ts`
 * y el cableado con `createRequest` lo cubren `tsc` y el build. Todos los
 * datos son ficticios.
 */

let mockedSession: WebSessionState;
let mockedPair: { session: WebSessionState; role: WebSessionRole } | undefined;
const submitMock = vi.fn<(submission: OwnRequestSubmission) => Promise<SubmitOwnRequestOutcome>>();
const signOutMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({ useQuery: () => mockedSession }));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () => mockedPair,
}));

vi.mock("./student-request-form-data.ts", () => ({
  useSubmitOwnRequest: () => submitMock,
}));

vi.mock("../../infrastructure/auth/auth-client", () => ({
  authClient: { useSession: () => ({ isPending: false }), signOut: signOutMock },
}));

vi.mock("../../infrastructure/convex/convex-client", () => ({
  convexUrl: "https://test.convex.cloud",
  convexSiteUrl: "https://test.convex.site",
  isBackendConfigured: true,
  convexClient: {},
}));

const SESION_ESTUDIANTE: WebSessionState = {
  status: "authenticated",
  email: "estudiante@alu.uct.cl",
  name: "Estudiante Ficticio",
  population: "estudiante",
};

const PAR_ESTUDIANTE = {
  session: SESION_ESTUDIANTE,
  role: { status: "authenticated", role: "student", email: "estudiante@alu.uct.cl" },
} satisfies { session: WebSessionState; role: WebSessionRole };

function renderForm() {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/estudiante/solicitudes/nueva"] }),
  });
  return { router, ...render(<RouterProvider router={router} />) };
}

async function fillRequiredFields() {
  fireEvent.change(await screen.findByLabelText(/Describe la barrera o necesidad/), {
    target: { value: "Necesidad ficticia" },
  });
  fireEvent.change(screen.getByLabelText(/Qué esperas de CERETI/), {
    target: { value: "Resultado ficticio" },
  });
  fireEvent.click(screen.getByLabelText("Comunicación escrita"));
  fireEvent.click(screen.getByLabelText("En línea"));
  fireEvent.click(screen.getByLabelText("Martes"));
  fireEvent.change(screen.getByLabelText(/Medio accesible para recibir información/), {
    target: { value: "Correo ficticio" },
  });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /Enviar solicitud|Reintentar envío/ }));
}

beforeEach(() => {
  mockedSession = SESION_ESTUDIANTE;
  mockedPair = PAR_ESTUDIANTE;
  submitMock.mockReset();
  signOutMock.mockReset();
  signOutMock.mockResolvedValue({ data: {}, error: null });
});

const DRAFT_KEY = "cereti:solicitud-borrador:estudiante@alu.uct.cl";

/** Tras un envío que el Backend no registró, el foco llega al título del resumen. */
async function expectFocusOnFailedSubmitSummary() {
  const summary = await screen.findByRole("heading", { name: "No se envió la solicitud" });
  await waitFor(() => expect(document.activeElement).toBe(summary));
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("TI2-149: formulario de solicitud", () => {
  test("muestra nombre y correo de la cuenta y marca obligatorios y opcionales sin pedir datos clínicos", async () => {
    renderForm();
    expect(await screen.findByText("Estudiante Ficticio")).toBeTruthy();
    expect(screen.getByText("estudiante@alu.uct.cl")).toBeTruthy();
    expect(screen.getByLabelText(/Describe la barrera o necesidad \(obligatorio\)/)).toBeTruthy();
    expect(screen.getByLabelText(/Otra necesidad de acceso \(opcional\)/)).toBeTruthy();
    expect(screen.queryByLabelText(/RUT|diagnóstico|certificado/i)).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  test("sin datos no envía: resume los errores, recibe el foco y marca cada campo", async () => {
    renderForm();
    await screen.findByLabelText(/Describe la barrera o necesidad/);
    submit();

    const summary = screen.getByRole("heading", { name: "Revisa estos campos antes de enviar" });
    expect(document.activeElement).toBe(summary);
    expect(submitMock).not.toHaveBeenCalled();
    const needSummary = screen.getByLabelText(/Describe la barrera o necesidad/);
    expect(needSummary.getAttribute("aria-invalid")).toBe("true");
    expect(needSummary.getAttribute("aria-describedby")).toContain("request-needSummary-error");

    fireEvent.click(
      screen.getByRole("link", { name: /Días disponibles: Selecciona al menos un día/ }),
    );
    const monday = screen.getByLabelText("Lunes");
    expect(document.activeElement).toBe(monday);
    // El error del grupo se anuncia también en cada opción, no solo en el fieldset.
    expect(monday.getAttribute("aria-invalid")).toBe("true");
    expect(monday.getAttribute("aria-describedby")).toBe("request-preferredWeekdays-error");
    expect(document.getElementById("request-preferredWeekdays-error")?.textContent).toContain(
      "Selecciona al menos un día disponible.",
    );
  });

  test("permite varias necesidades más texto libre y envía la forma completa", async () => {
    submitMock.mockResolvedValue({ status: "sent", requestId: "req-1" });
    renderForm();
    await fillRequiredFields();
    fireEvent.click(screen.getByLabelText("Persona de apoyo"));
    fireEvent.change(screen.getByLabelText(/Otra necesidad de acceso/), {
      target: { value: "Apoyo ficticio adicional" },
    });
    submit();

    await screen.findByRole("heading", { name: "Solicitud enviada" });
    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(submitMock.mock.calls[0]?.[0]).toMatchObject({
      accessNeeds: [
        { id: "written-communication", label: "Comunicación escrita" },
        { id: "support-person", label: "Persona de apoyo" },
      ],
      otherAccessNeed: "Apoyo ficticio adicional",
      modalityPreference: "online",
      generalAvailability: { preferredWeekdays: [2] },
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Solicitud enviada" }),
      ),
    );
    expect(screen.getByRole("link", { name: "Ver la solicitud" }).getAttribute("href")).toBe(
      "/estudiante/solicitudes/req-1",
    );
  });

  test("un fallo recuperable conserva lo escrito y el reintento envía lo mismo", async () => {
    submitMock.mockResolvedValueOnce({ status: "failed" });
    submitMock.mockResolvedValueOnce({ status: "sent", requestId: "req-1" });
    renderForm();
    await fillRequiredFields();
    submit();

    expect(await screen.findByText(/No pudimos enviar tu solicitud/)).toBeTruthy();
    await expectFocusOnFailedSubmitSummary();
    expect(
      (screen.getByLabelText(/Describe la barrera o necesidad/) as HTMLTextAreaElement).value,
    ).toBe("Necesidad ficticia");
    expect((screen.getByLabelText("Comunicación escrita") as HTMLInputElement).checked).toBe(true);

    submit();
    await screen.findByRole("heading", { name: "Solicitud enviada" });
    const [first, second] = submitMock.mock.calls.map(([submission]) => submission);
    expect(second).toEqual(first);
  });

  test("el rechazo del Backend muestra su mensaje público y conserva el formulario", async () => {
    submitMock.mockResolvedValue({
      status: "rejected",
      message: "El horario disponible debe empezar antes de terminar.",
    });
    renderForm();
    await fillRequiredFields();
    submit();

    expect(
      await screen.findByText("El horario disponible debe empezar antes de terminar."),
    ).toBeTruthy();
    await expectFocusOnFailedSubmitSummary();
    expect((screen.getByLabelText(/Qué esperas de CERETI/) as HTMLTextAreaElement).value).toBe(
      "Resultado ficticio",
    );
  });

  test("la denegación muestra el aviso genérico sin revelar el motivo", async () => {
    submitMock.mockResolvedValue({ status: "denied" });
    renderForm();
    await fillRequiredFields();
    submit();

    expect(
      await screen.findByText("No autorizado. Pide acceso por el canal oficial si corresponde."),
    ).toBeTruthy();
    await expectFocusOnFailedSubmitSummary();
  });

  test("un segundo clic durante el envío no repite la solicitud", async () => {
    let resolve: (outcome: SubmitOwnRequestOutcome) => void = () => {};
    submitMock.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderForm();
    await fillRequiredFields();
    submit();
    const button = await screen.findByRole("button", { name: "Enviando…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // Lo enviado es lo que queda guardado: no se puede editar mientras se envía.
    const needSummary = screen.getByLabelText(/Describe la barrera o necesidad/);
    expect(needSummary.matches(":disabled")).toBe(true);
    expect(screen.getByLabelText("Martes").matches(":disabled")).toBe(true);
    fireEvent.submit(button.closest("form") as HTMLFormElement);
    resolve({ status: "sent", requestId: "req-1" });

    await screen.findByRole("heading", { name: "Solicitud enviada" });
    expect(submitMock).toHaveBeenCalledTimes(1);
  });

  test("lo escrito se conserva al recargar y se borra al enviar", async () => {
    submitMock.mockResolvedValue({ status: "sent", requestId: "req-1" });
    const first = renderForm();
    await fillRequiredFields();
    first.unmount();

    renderForm();
    const needSummary = (await screen.findByLabelText(
      /Describe la barrera o necesidad/,
    )) as HTMLTextAreaElement;
    expect(needSummary.value).toBe("Necesidad ficticia");
    expect((screen.getByLabelText("Martes") as HTMLInputElement).checked).toBe(true);
    submit();
    await screen.findByRole("heading", { name: "Solicitud enviada" });
    cleanup();

    renderForm();
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/Describe la barrera o necesidad/) as HTMLTextAreaElement).value,
      ).toBe(""),
    );
  });

  test("cerrar sesión borra el borrador sin enviar", async () => {
    renderForm();
    await fillRequiredFields();
    await waitFor(() =>
      expect(window.sessionStorage.getItem(DRAFT_KEY)).toContain("Necesidad ficticia"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull());
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  test("si el cierre de sesión falla, el borrador se conserva", async () => {
    signOutMock.mockResolvedValue({ data: null, error: { status: 500, message: "fallo" } });
    renderForm();
    await fillRequiredFields();
    await waitFor(() => expect(window.sessionStorage.getItem(DRAFT_KEY)).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toContain("Necesidad ficticia");
  });
});
