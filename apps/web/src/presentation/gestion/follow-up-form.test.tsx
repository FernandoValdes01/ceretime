// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UNAUTHORIZED_ERROR_MESSAGE } from "../../../../../convex/domain/index.ts";
import type { FollowUpRecordView } from "../shared/follow-up/follow-up-data.ts";
import { AppointmentFollowUpSection } from "./follow-up-form.tsx";

/**
 * Pruebas del formulario de seguimiento de la agenda (TI2-165).
 *
 * La lectura sale de un store reactivo simulado y el guardado es un espía: la
 * confirmación, la idempotencia y la autorización las cubren las pruebas de
 * Convex de TI2-146. Acá se prueba la separación visible entre lo compartido
 * y la nota interna, el paso de confirmación, lo que se envía y que el
 * registro confirmado se muestra en solo lectura. Datos ficticios.
 */

const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    record: null as unknown,
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
  };
});

const save = vi.hoisted(() => vi.fn());

vi.mock("../shared/follow-up/follow-up-data.ts", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useFollowUpRecord: () => {
      useSyncExternalStore(store.subscribe, store.getVersion);
      if (store.record instanceof Error) throw store.record;
      return store.record;
    },
    useSaveFollowUpRecord: () => save,
  };
});

function registro(): FollowUpRecordView {
  return {
    appointmentId: "apt-1",
    accompanimentId: "acc-1",
    appointmentStatus: "completed",
    agreements: [{ description: "Acuerdo ficticio" }],
    tasks: [],
    nextSteps: "Próximos pasos ficticios",
    internalNote: "Nota interna ficticia",
    version: "v1",
    view: "professional",
  };
}

function renderSection(
  status: Parameters<typeof AppointmentFollowUpSection>[0]["appointmentStatus"] = "completed",
) {
  render(<AppointmentFollowUpSection appointmentId="apt-1" appointmentStatus={status} />);
}

beforeEach(() => {
  store.record = null;
  save.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("formulario de seguimiento (TI2-165)", () => {
  test("separa lo compartido de la nota interna con grupos y leyendas", () => {
    renderSection();

    const shared = screen.getByRole("group", { name: "Se comparte con el estudiante" });
    const internal = screen.getByRole("group", { name: "Nota interna: no se comparte" });
    expect(within(shared).getByLabelText("Próximos pasos (obligatorio)")).toBeDefined();
    expect(within(shared).queryByLabelText(/Nota interna/)).toBeNull();
    expect(within(internal).getByLabelText("Nota interna (opcional)")).toBeDefined();
    expect(internal.textContent).toContain("El estudiante no la ve");
  });

  test("agrega tareas con responsable y estado, confirma y envía el contenido recortado", async () => {
    save.mockResolvedValue({ appointmentId: "apt-1" });
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Agregar un acuerdo" }));
    fireEvent.change(screen.getByLabelText("Acuerdo 1"), {
      target: { value: "  Recibir apuntes  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar una tarea" }));
    fireEvent.change(screen.getByLabelText("Tarea 1"), { target: { value: "Enviar apuntes" } });
    fireEvent.change(screen.getByLabelText("Responsable de la tarea 1"), {
      target: { value: "professional" },
    });
    fireEvent.change(screen.getByLabelText("Estado de la tarea 1"), {
      target: { value: "in_progress" },
    });
    fireEvent.change(screen.getByLabelText("Próximos pasos (obligatorio)"), {
      target: { value: "Revisar el avance" },
    });
    fireEvent.change(screen.getByLabelText("Fecha sugerida para la próxima atención (opcional)"), {
      target: { value: "2026-11-23" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar antes de guardar" }));

    const heading = screen.getByRole("heading", { name: "Confirmar el seguimiento" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText(/al confirmarlo queda guardado/)).toBeDefined();
    expect(
      screen.getByText("Responsable: Profesional. Estado: En curso.", { exact: false }),
    ).toBeDefined();
    expect(save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar y guardar" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        appointmentId: "apt-1",
        agreements: [{ description: "Recibir apuntes" }],
        tasks: [
          { description: "Enviar apuntes", responsible: "professional", status: "in_progress" },
        ],
        nextSteps: "Revisar el avance",
        suggestedNextAppointmentDate: "2026-11-23",
        version: "v1",
      }),
    );
  });

  test("sin próximos pasos no llega a la confirmación", () => {
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Revisar antes de guardar" }));
    expect(screen.getByRole("alert").textContent).toContain("Completa los próximos pasos");
    expect(screen.queryByRole("heading", { name: "Confirmar el seguimiento" })).toBeNull();
  });

  test("la nota interna solo se envía si se escribe", async () => {
    save.mockResolvedValue({ appointmentId: "apt-1" });
    renderSection();

    fireEvent.change(screen.getByLabelText("Próximos pasos (obligatorio)"), {
      target: { value: "Revisar el avance" },
    });
    fireEvent.change(screen.getByLabelText("Nota interna (opcional)"), {
      target: { value: " Nota ficticia " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar antes de guardar" }));
    expect(
      screen.getByRole("region", { name: "Nota interna: no se comparte" }).textContent,
    ).toContain("Nota ficticia");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar y guardar" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ internalNote: "Nota ficticia" })),
    );
  });

  test("un rechazo del Backend muestra su mensaje y deja volver a editar", async () => {
    const message =
      "El seguimiento no admite diagnósticos, evaluaciones psicológicas ni documentos clínicos.";
    save.mockRejectedValue(new ConvexError({ code: "follow_up_fields_invalid", message }));
    renderSection();

    fireEvent.change(screen.getByLabelText("Próximos pasos (obligatorio)"), {
      target: { value: "Texto ficticio" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar antes de guardar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar y guardar" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    fireEvent.click(screen.getByRole("button", { name: "Volver a editar" }));
    expect(
      (screen.getByLabelText("Próximos pasos (obligatorio)") as HTMLTextAreaElement).value,
    ).toBe("Texto ficticio");
  });

  test("un fallo sin código no muestra el texto del SDK", async () => {
    save.mockRejectedValue(new Error("[CONVEX M(saveFollowUpRecord)] texto interno"));
    renderSection();

    fireEvent.change(screen.getByLabelText("Próximos pasos (obligatorio)"), {
      target: { value: "Texto ficticio" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar antes de guardar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar y guardar" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "No pudimos guardar el seguimiento. Inténtalo de nuevo.",
    );
  });
});

describe("seguimiento confirmado (TI2-165)", () => {
  test("se muestra en solo lectura y sin formulario", () => {
    store.record = registro();
    renderSection();

    expect(screen.getByText("Seguimiento confirmado: no se puede editar.")).toBeDefined();
    expect(screen.getByText("Nota interna ficticia")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  test("al confirmar, el registro reemplaza al formulario", async () => {
    save.mockResolvedValue({ appointmentId: "apt-1" });
    renderSection();

    fireEvent.change(screen.getByLabelText("Próximos pasos (obligatorio)"), {
      target: { value: "Próximos pasos ficticios" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar antes de guardar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar y guardar" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    act(() => {
      store.record = registro();
      store.notify();
    });
    expect(await screen.findByText("Seguimiento confirmado: no se puede editar.")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("una atención que no admite seguimiento no ofrece el formulario", () => {
    renderSection("scheduled");

    expect(screen.getByText(/se registra cuando la atención está realizada/)).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("una denegación muestra el aviso genérico", () => {
    store.record = new ConvexError(UNAUTHORIZED_ERROR_MESSAGE);
    renderSection();

    expect(screen.getByRole("alert").textContent).toBe(
      "No tienes acceso al seguimiento de esta atención.",
    );
  });
});
