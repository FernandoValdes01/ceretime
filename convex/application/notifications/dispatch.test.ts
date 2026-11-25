import { describe, expect, test, vi } from "vitest";
import { toNotificationEvent } from "../../domain/notifications/notification";
import { dispatchEmailDelivery } from "./dispatch";
import type { EmailDeliveryClaim, EmailDeliveryStore, EmailMessage, EmailSender } from "./ports";

const NOW = Date.UTC(2027, 0, 4, 15, 0, 0);

function makeEvent() {
  return toNotificationEvent({
    kind: "appointment_scheduled",
    appointmentId: "appt-1",
    recipientId: "user-1",
    occurredAt: NOW - 1000,
  });
}

describe("despacho de avisos por correo (TI2-159)", () => {
  test("envía solo el texto genérico y registra el resultado exitoso", async () => {
    const sent: EmailMessage[] = [];
    const recorded: unknown[] = [];
    const store: EmailDeliveryStore = {
      claim: async (): Promise<EmailDeliveryClaim> => ({
        status: "claimed",
        eventId: "event-1",
        event: makeEvent(),
        recipientEmail: "estudiante@alu.uct.cl",
      }),
      recordAttempt: async (eventId, result, attemptedAt) => {
        recorded.push({ eventId, result, attemptedAt });
      },
    };
    const sender: EmailSender = {
      send: async (message) => {
        sent.push(message);
        return { status: "sent" };
      },
    };

    const outcome = await dispatchEmailDelivery({ store, sender, now: () => NOW }, "delivery-1");

    expect(outcome).toBe("sent");
    expect(sent).toEqual([
      {
        to: "estudiante@alu.uct.cl",
        subject: "Tienes una atención programada",
        text: "Revisa el detalle en la aplicación.",
      },
    ]);
    expect(recorded).toEqual([
      { eventId: "event-1", result: { status: "sent" }, attemptedAt: NOW },
    ]);
  });

  test("omite el envío si la entrega ya fue tomada o enviada", async () => {
    const send = vi.fn<EmailSender["send"]>();
    const recordAttempt = vi.fn<EmailDeliveryStore["recordAttempt"]>();
    const store: EmailDeliveryStore = {
      claim: async () => ({ status: "skipped" }),
      recordAttempt,
    };

    const outcome = await dispatchEmailDelivery(
      { store, sender: { send }, now: () => NOW },
      "delivery-1",
    );

    expect(outcome).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    expect(recordAttempt).not.toHaveBeenCalled();
  });

  test("registra invalid_destination si el destinatario no tiene correo", async () => {
    const send = vi.fn<EmailSender["send"]>();
    const recordAttempt = vi.fn<EmailDeliveryStore["recordAttempt"]>();
    const store: EmailDeliveryStore = {
      claim: async () => ({ status: "no_destination", eventId: "event-1" }),
      recordAttempt,
    };

    const outcome = await dispatchEmailDelivery(
      { store, sender: { send }, now: () => NOW },
      "delivery-1",
    );

    expect(outcome).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith(
      "event-1",
      { status: "failed", errorCode: "invalid_destination" },
      NOW,
    );
  });

  test("captura un fallo inesperado del remitente como provider_unavailable", async () => {
    const recordAttempt = vi.fn<EmailDeliveryStore["recordAttempt"]>();
    const store: EmailDeliveryStore = {
      claim: async () => ({
        status: "claimed",
        eventId: "event-1",
        event: makeEvent(),
        recipientEmail: "estudiante@alu.uct.cl",
      }),
      recordAttempt,
    };
    const sender: EmailSender = {
      send: async () => {
        throw new Error("fallo interno no controlado");
      },
    };

    const outcome = await dispatchEmailDelivery({ store, sender, now: () => NOW }, "delivery-1");

    expect(outcome).toBe("failed");
    expect(recordAttempt).toHaveBeenCalledWith(
      "event-1",
      { status: "failed", errorCode: "provider_unavailable" },
      NOW,
    );
  });
});
