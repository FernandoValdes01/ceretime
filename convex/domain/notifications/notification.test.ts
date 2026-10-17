import { describe, expect, expectTypeOf, test } from "vitest";
import {
  NOTIFICATION_CONTRACT_VERSION,
  NOTIFICATION_EVENT_KIND_VALUES,
  isNotificationEventKind,
  toExternalNotification,
  type ExternalNotification,
  type NotificationEvent,
} from "./notification";
import {
  NOTIFICATION_CONTRACT_VERSION as BARREL_VERSION,
  isNotificationEventKind as barrelIsKind,
  toExternalNotification as barrelToExternal,
  type ExternalNotification as BarrelExternal,
  type NotificationEvent as BarrelEvent,
} from "../index";

function event(kind: NotificationEvent["kind"]): NotificationEvent {
  return {
    kind,
    appointmentId: "atencion-ficticia-1",
    occurredAt: 1000,
    version: "v1",
  };
}

describe("Evento de notificación para consumidores (TI2-100)", () => {
  test("la versión vigente es v1 y sale por el barrel sin duplicar la fuente", () => {
    expect(NOTIFICATION_CONTRACT_VERSION).toBe("v1");
    expect(BARREL_VERSION).toBe(NOTIFICATION_CONTRACT_VERSION);
    expect(barrelToExternal).toBe(toExternalNotification);
    expect(barrelIsKind).toBe(isNotificationEventKind);
    expectTypeOf<BarrelEvent>().toEqualTypeOf<NotificationEvent>();
    expectTypeOf<BarrelExternal>().toEqualTypeOf<ExternalNotification>();
  });

  test("las clases cubren el ciclo sin emisión ni envío", () => {
    expect([...NOTIFICATION_EVENT_KIND_VALUES]).toEqual([
      "appointment_scheduled",
      "appointment_rescheduled",
      "appointment_cancelled",
      "appointment_no_show",
      "appointment_reminder",
    ]);
    expect(isNotificationEventKind("appointment_reminder")).toBe(true);
    expect(isNotificationEventKind("appointment_deleted")).toBe(false);
  });

  test("la variante externa es genérica y no filtra datos", () => {
    const texts: Record<NotificationEvent["kind"], ExternalNotification> = {
      appointment_scheduled: {
        title: "Tienes una atención programada",
        body: "Revisa el detalle en la aplicación.",
      },
      appointment_rescheduled: {
        title: "Tu atención cambió de horario",
        body: "Revisa el nuevo horario en la aplicación.",
      },
      appointment_cancelled: {
        title: "Tu atención fue cancelada",
        body: "Revisa la información en la aplicación.",
      },
      appointment_no_show: {
        title: "Se registró una inasistencia",
        body: "Revisa cómo justificarla en la aplicación.",
      },
      appointment_reminder: {
        title: "Tienes una atención programada",
        body: "Revisa la hora en la aplicación.",
      },
    };
    for (const kind of NOTIFICATION_EVENT_KIND_VALUES) {
      const external = toExternalNotification(event(kind));
      expect(external).toEqual(texts[kind]);
      expect(`${external.title} ${external.body}`).not.toContain("atencion-ficticia-1");
    }
  });

  test("una clase desconocida es error, no texto libre", () => {
    expect(() =>
      toExternalNotification({
        kind: "appointment_deleted" as never,
        appointmentId: "atencion-ficticia-1",
        occurredAt: 1000,
        version: "v1",
      }),
    ).toThrow("desconocida");
  });

  test("el evento y su variante viajan como datos planos (ida y vuelta JSON)", () => {
    const inner = event("appointment_scheduled");
    const outer = toExternalNotification(inner);
    expect(JSON.parse(JSON.stringify(inner))).toEqual(inner);
    expect(JSON.parse(JSON.stringify(outer))).toEqual(outer);
  });
});
