import { describe, expect, expectTypeOf, test } from "vitest";
import {
  APPOINTMENT_TRANSITIONS,
  type AppointmentStateChange,
  type AppointmentStatus,
} from "../appointments/appointment";
import {
  NOTIFICATION_CONTRACT_VERSION,
  NOTIFICATION_EVENT_KIND_VALUES,
  isNotificationEventKind,
  notificationEventsForCreation,
  notificationEventsForTransition,
  notificationIdempotencyKey,
  toExternalNotification,
  toNotificationEvent,
  type ExternalNotification,
  type NotificationAudience,
  type NotificationEvent,
  type NotificationEventInput,
  type NotificationSubject,
} from "./notification";
import {
  NOTIFICATION_CONTRACT_VERSION as BARREL_VERSION,
  isNotificationEventKind as barrelIsKind,
  notificationEventsForCreation as barrelEventsForCreation,
  notificationEventsForTransition as barrelEventsForTransition,
  notificationIdempotencyKey as barrelKey,
  toExternalNotification as barrelToExternal,
  toNotificationEvent as barrelToEvent,
  type ExternalNotification as BarrelExternal,
  type NotificationAudience as BarrelAudience,
  type NotificationEvent as BarrelEvent,
  type NotificationSubject as BarrelSubject,
} from "../index";

const subject: NotificationSubject = {
  appointmentId: "atencion-ficticia-1",
  studentId: "estudiante-ficticio-1",
  professionalId: "profesional-ficticio-1",
};

function event(kind: NotificationEvent["kind"]): NotificationEvent {
  return toNotificationEvent({
    kind,
    appointmentId: subject.appointmentId,
    recipientId: subject.studentId,
    occurredAt: 1000,
  });
}

function change(
  from: AppointmentStatus,
  to: AppointmentStatus,
  occurredAt = 2000,
  actorId = subject.studentId,
): AppointmentStateChange {
  return {
    from,
    to,
    actorId,
    occurredAt,
    reason: "Motivo sensible del acompañamiento",
  };
}

type ExpectedEvent = {
  readonly kind: NotificationEvent["kind"];
  readonly recipient: NotificationAudience;
};

function describeEvent(emitted: NotificationEvent): ExpectedEvent {
  return {
    kind: emitted.kind,
    recipient: emitted.recipientId === subject.studentId ? "student" : "professional",
  };
}

function describeAll(emitted: readonly NotificationEvent[]): readonly ExpectedEvent[] {
  return emitted.map(describeEvent);
}

/** Resultado esperado de cada par declarado, con actor estudiante por defecto. */
const EXPECTED_TRANSITIONS: Record<string, readonly ExpectedEvent[]> = {
  "scheduled->completed": [],
  "scheduled->cancelled_by_student": [{ kind: "appointment_cancelled", recipient: "professional" }],
  "scheduled->cancelled_by_cereti": [{ kind: "appointment_cancelled", recipient: "student" }],
  "scheduled->rescheduled": [{ kind: "appointment_rescheduled", recipient: "professional" }],
  "scheduled->no_show": [{ kind: "appointment_no_show", recipient: "student" }],
  "rescheduled->completed": [],
  "rescheduled->cancelled_by_student": [
    { kind: "appointment_cancelled", recipient: "professional" },
  ],
  "rescheduled->cancelled_by_cereti": [{ kind: "appointment_cancelled", recipient: "student" }],
  "rescheduled->rescheduled": [{ kind: "appointment_rescheduled", recipient: "professional" }],
  "rescheduled->no_show": [{ kind: "appointment_no_show", recipient: "student" }],
  "no_show->no_show_justified": [],
  "no_show->no_show_unjustified": [],
};

describe("Evento de notificación para consumidores (TI2-100)", () => {
  test("la versión vigente es v1 y sale por el barrel sin duplicar la fuente", () => {
    expect(NOTIFICATION_CONTRACT_VERSION).toBe("v1");
    expect(BARREL_VERSION).toBe(NOTIFICATION_CONTRACT_VERSION);
    expect(barrelToExternal).toBe(toExternalNotification);
    expect(barrelIsKind).toBe(isNotificationEventKind);
    expect(barrelToEvent).toBe(toNotificationEvent);
    expect(barrelEventsForCreation).toBe(notificationEventsForCreation);
    expect(barrelEventsForTransition).toBe(notificationEventsForTransition);
    expect(barrelKey).toBe(notificationIdempotencyKey);
    expectTypeOf<BarrelEvent>().toEqualTypeOf<NotificationEvent>();
    expectTypeOf<BarrelExternal>().toEqualTypeOf<ExternalNotification>();
    expectTypeOf<BarrelSubject>().toEqualTypeOf<NotificationSubject>();
    expectTypeOf<BarrelAudience>().toEqualTypeOf<NotificationAudience>();
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
        appointmentId: subject.appointmentId,
        recipientId: subject.studentId,
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
  test("la creación emite una confirmación con forma exacta solo al estudiante", () => {
    const created = notificationEventsForCreation(subject, 1000);
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual({
      kind: "appointment_scheduled",
      appointmentId: "atencion-ficticia-1",
      recipientId: "estudiante-ficticio-1",
      occurredAt: 1000,
      version: "v1",
    });
    expect(Object.keys(created[0]).sort()).toEqual([
      "appointmentId",
      "kind",
      "occurredAt",
      "recipientId",
      "version",
    ]);
    expect("professionalId" in created[0]).toBe(false);
    expect("accompanimentId" in created[0]).toBe(false);
    expect("accessNeeds" in created[0]).toBe(false);
    expect("reason" in created[0]).toBe(false);
    expect("internalNote" in created[0]).toBe(false);
  });

  test("el constructor descarta campos colados por el adaptador", () => {
    const input: NotificationEventInput & { professionalId: string; reason: string } = {
      kind: "appointment_scheduled",
      appointmentId: subject.appointmentId,
      recipientId: subject.studentId,
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

  test("cada transición declarada decide clase y destinatarios", () => {
    for (const transition of APPOINTMENT_TRANSITIONS) {
      const key = `${transition.from}->${transition.to}`;
      const expected = EXPECTED_TRANSITIONS[key];
      if (expected === undefined) {
        throw new Error(`Falta la expectativa de notificación para ${key}.`);
      }
      expect(
        describeAll(
          notificationEventsForTransition(subject, change(transition.from, transition.to)),
        ),
      ).toEqual(expected);
    }
    expect(Object.keys(EXPECTED_TRANSITIONS)).toHaveLength(APPOINTMENT_TRANSITIONS.length);
  });

  test("reagendar avisa a la contraparte de quien lo hizo", () => {
    const byStudent = notificationEventsForTransition(
      subject,
      change("scheduled", "rescheduled", 2000, subject.studentId),
    );
    expect(describeAll(byStudent)).toEqual([
      { kind: "appointment_rescheduled", recipient: "professional" },
    ]);

    const byProfessional = notificationEventsForTransition(
      subject,
      change("scheduled", "rescheduled", 2000, subject.professionalId),
    );
    expect(describeAll(byProfessional)).toEqual([
      { kind: "appointment_rescheduled", recipient: "student" },
    ]);

    const byThirdParty = notificationEventsForTransition(
      subject,
      change("scheduled", "rescheduled", 2000, "tercero-ficticio-1"),
    );
    expect(describeAll(byThirdParty)).toEqual([
      { kind: "appointment_rescheduled", recipient: "student" },
      { kind: "appointment_rescheduled", recipient: "professional" },
    ]);
  });

  test("una transición no declarada no se notifica", () => {
    expect(() =>
      notificationEventsForTransition(subject, change("completed", "scheduled")),
    ).toThrow("no está declarada");
    expect(() =>
      notificationEventsForTransition(subject, change("scheduled", "no_show_justified")),
    ).toThrow("no está declarada");
    expect(() => notificationEventsForTransition(subject, change("no_show", "no_show"))).toThrow(
      "no está declarada",
    );
  });

  test("el motivo del cambio no viaja al evento ni al texto externo", () => {
    const cancellation = notificationEventsForTransition(
      subject,
      change("scheduled", "cancelled_by_cereti"),
    );
    expect(cancellation).toHaveLength(1);
    expect(JSON.stringify(cancellation)).not.toContain("Motivo sensible");
    const external = toExternalNotification(cancellation[0]);
    expect(`${external.title} ${external.body}`).not.toContain("Motivo sensible");
    expect(Object.keys(external).sort()).toEqual(["body", "title"]);
  });

  test("los reintentos de la misma emisión reutilizan la clave", () => {
    const first = notificationEventsForTransition(
      subject,
      change("scheduled", "cancelled_by_student"),
    );
    const retry = notificationEventsForTransition(
      subject,
      change("scheduled", "cancelled_by_student"),
    );
    expect(first.map(notificationIdempotencyKey)).toEqual(retry.map(notificationIdempotencyKey));

    const otherInstant = notificationEventsForTransition(
      subject,
      change("scheduled", "cancelled_by_student", 2001),
    );
    const otherKind = notificationEventsForTransition(subject, change("scheduled", "no_show"));
    const otherRecipient = notificationEventsForTransition(
      subject,
      change("scheduled", "rescheduled", 2000, "tercero-ficticio-1"),
    );
    const creation = notificationEventsForCreation(subject, 2000);

    const keys = new Set([
      notificationIdempotencyKey(first[0]),
      notificationIdempotencyKey(otherInstant[0]),
      notificationIdempotencyKey(otherKind[0]),
      notificationIdempotencyKey(otherRecipient[0]),
      notificationIdempotencyKey(otherRecipient[1]),
      notificationIdempotencyKey(creation[0]),
    ]);
    expect(keys.size).toBe(6);
  });

  test("las referencias vacías y el instante inválido son error", () => {
    expect(() =>
      toNotificationEvent({
        kind: "appointment_scheduled",
        appointmentId: "  ",
        recipientId: subject.studentId,
        occurredAt: 1000,
      }),
    ).toThrow("atención");
    expect(() =>
      toNotificationEvent({
        kind: "appointment_scheduled",
        appointmentId: subject.appointmentId,
        recipientId: " ",
        occurredAt: 1000,
      }),
    ).toThrow("destinatario");
    expect(() =>
      toNotificationEvent({
        kind: "appointment_scheduled",
        appointmentId: subject.appointmentId,
        recipientId: subject.studentId,
        occurredAt: 0,
      }),
    ).toThrow("instante");
    expect(() => notificationEventsForCreation({ ...subject, studentId: " " }, 1000)).toThrow(
      "destinatario",
    );
    expect(() => notificationEventsForCreation({ ...subject, appointmentId: "" }, 1000)).toThrow(
      "atención",
    );
  });
});
