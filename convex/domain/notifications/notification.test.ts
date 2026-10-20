import { describe, expect, expectTypeOf, test } from "vitest";
import {
  APPOINTMENT_TRANSITIONS,
  type AppointmentStateChange,
  type AppointmentStatus,
} from "../appointments/appointment";
import {
  NOTIFICATION_CONTRACT_VERSION,
  NOTIFICATION_EMITTING_KIND_BY_STATUS,
  NOTIFICATION_EVENT_KIND_VALUES,
  isNotificationEventKind,
  notificationEventForCreation,
  notificationEventForTransition,
  notificationIdempotencyKey,
  toExternalNotification,
  toNotificationEvent,
  type ExternalNotification,
  type NotificationEvent,
  type NotificationEventInput,
  type NotificationReference,
} from "./notification";
import {
  NOTIFICATION_CONTRACT_VERSION as BARREL_VERSION,
  NOTIFICATION_EMITTING_KIND_BY_STATUS as BARREL_EMITTING,
  isNotificationEventKind as barrelIsKind,
  notificationEventForCreation as barrelForCreation,
  notificationEventForTransition as barrelForTransition,
  notificationIdempotencyKey as barrelKey,
  toExternalNotification as barrelToExternal,
  toNotificationEvent as barrelToEvent,
  type ExternalNotification as BarrelExternal,
  type NotificationEvent as BarrelEvent,
  type NotificationReference as BarrelReference,
} from "../index";

const reference: NotificationReference = {
  appointmentId: "atencion-ficticia-1",
  recipientId: "destinatario-ficticio-1",
};

function event(kind: NotificationEvent["kind"]): NotificationEvent {
  return toNotificationEvent({ kind, ...reference, occurredAt: 1000 });
}

function change(
  from: AppointmentStatus,
  to: AppointmentStatus,
  occurredAt = 2000,
): AppointmentStateChange {
  return {
    from,
    to,
    actorId: "actor-ficticio-1",
    occurredAt,
    reason: "Motivo sensible del acompañamiento",
  };
}

describe("Evento de notificación para consumidores (TI2-100)", () => {
  test("la versión vigente es v1 y sale por el barrel sin duplicar la fuente", () => {
    expect(NOTIFICATION_CONTRACT_VERSION).toBe("v1");
    expect(BARREL_VERSION).toBe(NOTIFICATION_CONTRACT_VERSION);
    expect(barrelToExternal).toBe(toExternalNotification);
    expect(barrelIsKind).toBe(isNotificationEventKind);
    expect(barrelToEvent).toBe(toNotificationEvent);
    expect(barrelForCreation).toBe(notificationEventForCreation);
    expect(barrelForTransition).toBe(notificationEventForTransition);
    expect(barrelKey).toBe(notificationIdempotencyKey);
    expect(BARREL_EMITTING).toBe(NOTIFICATION_EMITTING_KIND_BY_STATUS);
    expectTypeOf<BarrelEvent>().toEqualTypeOf<NotificationEvent>();
    expectTypeOf<BarrelExternal>().toEqualTypeOf<ExternalNotification>();
    expectTypeOf<BarrelReference>().toEqualTypeOf<NotificationReference>();
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
        title: "Tienes una actualización pendiente",
        body: "Revisa las novedades en la aplicación.",
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
      expect(`${external.title} ${external.body}`).not.toContain("inasistencia");
      expect(`${external.title} ${external.body}`).not.toContain("justific");
    }
  });

  test("la inasistencia no se revela fuera de sesión", () => {
    const external = toExternalNotification(event("appointment_no_show"));
    expect(external.title).toBe("Tienes una actualización pendiente");
    expect(external.body).toBe("Revisa las novedades en la aplicación.");
    expect(`${external.title} ${external.body}`).not.toContain("inasistencia");
    expect(`${external.title} ${external.body}`).not.toContain("justific");
  });

  test("una clase desconocida es error, no texto libre", () => {
    expect(() => toExternalNotification(event("appointment_deleted" as never))).toThrow(
      "desconocida",
    );
    expect(() =>
      toNotificationEvent({
        kind: "appointment_deleted" as never,
        ...reference,
        occurredAt: 1000,
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

describe("Emisión de eventos de la atención (TI2-105)", () => {
  test("la creación emite la confirmación con forma exacta y referencias mínimas", () => {
    const created = notificationEventForCreation(reference, 1000);
    expect(created).toEqual({
      kind: "appointment_scheduled",
      appointmentId: "atencion-ficticia-1",
      recipientId: "destinatario-ficticio-1",
      occurredAt: 1000,
      version: "v1",
    });
    expect(Object.keys(created).sort()).toEqual([
      "appointmentId",
      "kind",
      "occurredAt",
      "recipientId",
      "version",
    ]);
    expect("professionalId" in created).toBe(false);
    expect("accompanimentId" in created).toBe(false);
    expect("accessNeeds" in created).toBe(false);
    expect("reason" in created).toBe(false);
    expect("internalNote" in created).toBe(false);
  });

  test("el constructor descarta campos colados por el adaptador", () => {
    const input: NotificationEventInput & { professionalId: string; reason: string } = {
      kind: "appointment_scheduled",
      ...reference,
      occurredAt: 1000,
      professionalId: "profesional-ficticio-1",
      reason: "Motivo sensible del acompañamiento",
    };
    const built = toNotificationEvent(input);
    expect(Object.keys(built).sort()).toEqual([
      "appointmentId",
      "kind",
      "occurredAt",
      "recipientId",
      "version",
    ]);
  });

  test("toda transición declarada emite o queda en silencio según la política", () => {
    const emitted = new Set<NotificationEvent["kind"]>();
    const silent = new Set<AppointmentStatus>();
    for (const transition of APPOINTMENT_TRANSITIONS) {
      const emittedEvent = notificationEventForTransition(
        reference,
        change(transition.from, transition.to),
      );
      const expected = NOTIFICATION_EMITTING_KIND_BY_STATUS[transition.to];
      expect(emittedEvent?.kind ?? null).toBe(expected ?? null);
      expect(emittedEvent?.occurredAt ?? null).toBe(expected === undefined ? null : 2000);
      if (expected === undefined) {
        silent.add(transition.to);
      } else {
        emitted.add(expected);
      }
    }

    const creation = notificationEventForCreation(reference, 1000);
    const covered = [...emitted, creation.kind].sort();
    expect(covered).toEqual(
      [...NOTIFICATION_EVENT_KIND_VALUES].filter((kind) => kind !== "appointment_reminder").sort(),
    );
    expect([...silent].sort()).toEqual(["completed", "no_show_justified", "no_show_unjustified"]);
  });

  test("una transición no declarada no se notifica", () => {
    expect(() =>
      notificationEventForTransition(reference, change("completed", "scheduled")),
    ).toThrow("no está declarada");
    expect(() =>
      notificationEventForTransition(reference, change("scheduled", "no_show_justified")),
    ).toThrow("no está declarada");
    expect(() => notificationEventForTransition(reference, change("no_show", "no_show"))).toThrow(
      "no está declarada",
    );
  });

  test("el motivo del cambio no viaja al evento ni al texto externo", () => {
    const cancellation = notificationEventForTransition(
      reference,
      change("scheduled", "cancelled_by_cereti"),
    );
    expect(cancellation).not.toBeNull();
    expect(JSON.stringify(cancellation)).not.toContain("Motivo sensible");
    const external = toExternalNotification(cancellation as NotificationEvent);
    expect(`${external.title} ${external.body}`).not.toContain("Motivo sensible");
    expect(Object.keys(external).sort()).toEqual(["body", "title"]);
  });

  test("los reintentos de la misma emisión reutilizan la clave", () => {
    const first = notificationEventForTransition(
      reference,
      change("scheduled", "cancelled_by_student"),
    ) as NotificationEvent;
    const retry = notificationEventForTransition(
      reference,
      change("scheduled", "cancelled_by_student"),
    ) as NotificationEvent;
    expect(notificationIdempotencyKey(first)).toBe(notificationIdempotencyKey(retry));

    const otherRecipient = notificationEventForTransition(
      { ...reference, recipientId: "destinatario-ficticio-2" },
      change("scheduled", "cancelled_by_student"),
    ) as NotificationEvent;
    const otherInstant = notificationEventForTransition(
      reference,
      change("scheduled", "cancelled_by_student", 2001),
    ) as NotificationEvent;
    const otherKind = notificationEventForTransition(
      reference,
      change("scheduled", "rescheduled"),
    ) as NotificationEvent;
    const creation = notificationEventForCreation(reference, 2000);

    const keys = new Set([
      notificationIdempotencyKey(first),
      notificationIdempotencyKey(otherRecipient),
      notificationIdempotencyKey(otherInstant),
      notificationIdempotencyKey(otherKind),
      notificationIdempotencyKey(creation),
    ]);
    expect(keys.size).toBe(5);
  });

  test("las referencias vacías y el instante inválido son error", () => {
    expect(() =>
      toNotificationEvent({
        kind: "appointment_scheduled",
        appointmentId: "  ",
        recipientId: "destinatario-ficticio-1",
        occurredAt: 1000,
      }),
    ).toThrow("atención");
    expect(() =>
      toNotificationEvent({
        kind: "appointment_scheduled",
        appointmentId: "atencion-ficticia-1",
        recipientId: " ",
        occurredAt: 1000,
      }),
    ).toThrow("destinatario");
    expect(() =>
      toNotificationEvent({
        kind: "appointment_scheduled",
        ...reference,
        occurredAt: 0,
      }),
    ).toThrow("instante");
  });
});
