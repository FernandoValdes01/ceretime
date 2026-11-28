import { describe, expect, expectTypeOf, test } from "vitest";
import {
  APPOINTMENT_TRANSITIONS,
  type AppointmentStateChange,
  type AppointmentStatus,
} from "../appointments/appointment";
import type { RequestState } from "../requests/state";
import { REQUEST_TRANSITIONS, type RequestStateChange } from "../requests/transitions";
import {
  APPOINTMENT_NOTIFICATION_EVENT_KIND_VALUES,
  NOTIFICATION_CONTRACT_VERSION,
  NOTIFICATION_EVENT_KIND_VALUES,
  NOTIFICATION_READ_STATUS_VALUES,
  PRIVACY_NOTIFICATION_EVENT_KIND_VALUES,
  REQUEST_NOTIFICATION_EVENT_KIND_VALUES,
  isAppointmentNotificationEventKind,
  isNotificationEventKind,
  isNotificationReadStatus,
  isPrivacyNotificationEventKind,
  isRequestNotificationEventKind,
  notificationEventsForCreation,
  notificationEventsForJustificationSubmitted,
  notificationEventsForOnlineAccess,
  notificationEventsForRequestReceived,
  notificationEventsForRequestTransition,
  notificationEventsForTransition,
  notificationEventsForAvailabilityChange,
  notificationEventsForSpaceChange,
  notificationEventsForNeedsUpdated,
  notificationIdempotencyKey,
  toExternalNotification,
  toNotificationEvent,
  type AppointmentNotificationEventKind,
  type ExternalNotification,
  type NotificationAudience,
  type NotificationEvent,
  type NotificationEventInput,
  type NotificationSubject,
  type RequestNotificationEvent,
  type RequestNotificationSubject,
} from "./notification";
import {
  APPOINTMENT_NOTIFICATION_EVENT_KIND_VALUES as BARREL_APPOINTMENT_KINDS,
  NOTIFICATION_CONTRACT_VERSION as BARREL_VERSION,
  NOTIFICATION_READ_STATUS_VALUES as BARREL_READ_STATUS,
  REQUEST_NOTIFICATION_EVENT_KIND_VALUES as BARREL_REQUEST_KINDS,
  isAppointmentNotificationEventKind as barrelIsAppointmentKind,
  isNotificationEventKind as barrelIsKind,
  isRequestNotificationEventKind as barrelIsRequestKind,
  notificationEventsForCreation as barrelEventsForCreation,
  notificationEventsForJustificationSubmitted as barrelEventsForJustification,
  notificationEventsForOnlineAccess as barrelEventsForOnlineAccess,
  notificationEventsForRequestReceived as barrelEventsForRequestReceived,
  notificationEventsForRequestTransition as barrelEventsForRequestTransition,
  notificationEventsForTransition as barrelEventsForTransition,
  notificationIdempotencyKey as barrelKey,
  toExternalNotification as barrelToExternal,
  toNotificationEvent as barrelToEvent,
  type ExternalNotification as BarrelExternal,
  type NotificationAudience as BarrelAudience,
  type NotificationEvent as BarrelEvent,
  type NotificationSubject as BarrelSubject,
  type RequestNotificationSubject as BarrelRequestSubject,
} from "../index";

const subject: NotificationSubject = {
  appointmentId: "atencion-ficticia-1",
  studentId: "estudiante-ficticio-1",
  professionalId: "profesional-ficticio-1",
};

function event(kind: AppointmentNotificationEventKind): NotificationEvent {
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

/**
 * Quién hace cada cambio en la aplicación: el Estudiante cancela o cambia de
 * horario lo suyo; el profesional cancela por CERETI, registra y revisa.
 */
function actorFor(to: AppointmentStatus): string {
  return to === "cancelled_by_student" || to === "rescheduled"
    ? subject.studentId
    : subject.professionalId;
}

/** Resultado esperado de cada par declarado, con el actor de `actorFor`. */
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
  "no_show->no_show_justified": [
    { kind: "appointment_justification_reviewed", recipient: "student" },
  ],
  "no_show->no_show_unjustified": [
    { kind: "appointment_justification_reviewed", recipient: "student" },
  ],
};

describe("Evento de notificación para consumidores (TI2-100)", () => {
  test("la versión vigente es v1 y sale por el barrel sin duplicar la fuente", () => {
    expect(NOTIFICATION_CONTRACT_VERSION).toBe("v1");
    expect(BARREL_VERSION).toBe(NOTIFICATION_CONTRACT_VERSION);
    expect(barrelToExternal).toBe(toExternalNotification);
    expect(barrelIsKind).toBe(isNotificationEventKind);
    expect(barrelToEvent).toBe(toNotificationEvent);
    expect(barrelEventsForCreation).toBe(notificationEventsForCreation);
    expect(barrelEventsForOnlineAccess).toBe(notificationEventsForOnlineAccess);
    expect(barrelEventsForRequestReceived).toBe(notificationEventsForRequestReceived);
    expect(barrelEventsForRequestTransition).toBe(notificationEventsForRequestTransition);
    expect(barrelEventsForJustification).toBe(notificationEventsForJustificationSubmitted);
    expect(barrelEventsForTransition).toBe(notificationEventsForTransition);
    expect(barrelKey).toBe(notificationIdempotencyKey);
    expect(BARREL_APPOINTMENT_KINDS).toBe(APPOINTMENT_NOTIFICATION_EVENT_KIND_VALUES);
    expect(BARREL_REQUEST_KINDS).toBe(REQUEST_NOTIFICATION_EVENT_KIND_VALUES);
    expect(barrelIsAppointmentKind).toBe(isAppointmentNotificationEventKind);
    expect(barrelIsRequestKind).toBe(isRequestNotificationEventKind);
    expect(BARREL_READ_STATUS).toBe(NOTIFICATION_READ_STATUS_VALUES);
    expect(isNotificationReadStatus("pending")).toBe(true);
    expect(isNotificationReadStatus("read")).toBe(true);
    expect(isNotificationReadStatus("unread")).toBe(false);
    expect([...NOTIFICATION_READ_STATUS_VALUES]).toEqual(["pending", "read"]);
    expectTypeOf<BarrelEvent>().toEqualTypeOf<NotificationEvent>();
    expectTypeOf<BarrelExternal>().toEqualTypeOf<ExternalNotification>();
    expectTypeOf<BarrelSubject>().toEqualTypeOf<NotificationSubject>();
    expectTypeOf<BarrelAudience>().toEqualTypeOf<NotificationAudience>();
    expectTypeOf<BarrelRequestSubject>().toEqualTypeOf<RequestNotificationSubject>();
  });

  test("las clases cubren el ciclo sin emisión ni envío", () => {
    expect([...NOTIFICATION_EVENT_KIND_VALUES]).toEqual([
      "appointment_scheduled",
      "appointment_rescheduled",
      "appointment_cancelled",
      "appointment_no_show",
      "appointment_reminder",
      "appointment_online_access_ready",
      "appointment_justification_submitted",
      "appointment_justification_reviewed",
      "appointment_availability_changed",
      "appointment_space_changed",
      "appointment_needs_updated",
      "request_received",
      "request_under_review",
      "request_information_requested",
      "request_information_provided",
      "request_accepted",
      "request_referred",
      "request_closed",
      "request_cancelled",
      "privacy_request_granted",
      "privacy_request_denied",
    ]);
    expect(isNotificationEventKind("appointment_reminder")).toBe(true);
    expect(isNotificationEventKind("request_received")).toBe(true);
    expect(isNotificationEventKind("appointment_deleted")).toBe(false);
    expect([...APPOINTMENT_NOTIFICATION_EVENT_KIND_VALUES]).not.toContain("request_received");
    // Las comunicaciones de privacidad tienen clase y recurso propios.
    expect([...PRIVACY_NOTIFICATION_EVENT_KIND_VALUES]).toEqual([
      "privacy_request_granted",
      "privacy_request_denied",
    ]);
    expect(isPrivacyNotificationEventKind("privacy_request_granted")).toBe(true);
    expect(isPrivacyNotificationEventKind("request_received")).toBe(false);
    expect(
      REQUEST_NOTIFICATION_EVENT_KIND_VALUES.every((kind) => kind.startsWith("request_")),
    ).toBe(true);
    expect(
      APPOINTMENT_NOTIFICATION_EVENT_KIND_VALUES.every((kind) => kind.startsWith("appointment_")),
    ).toBe(true);
    expect(isAppointmentNotificationEventKind("appointment_reminder")).toBe(true);
    expect(isAppointmentNotificationEventKind("request_received")).toBe(false);
    expect(isRequestNotificationEventKind("request_received")).toBe(true);
    expect(isRequestNotificationEventKind("appointment_reminder")).toBe(false);
  });

  test("la variante externa es genérica y no filtra datos", () => {
    const PENDING: ExternalNotification = {
      title: "Tienes una actualización pendiente",
      body: "Revisa las novedades en la aplicación.",
    };
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
      appointment_online_access_ready: {
        title: "Tu atención tiene su acceso disponible",
        body: "Revisa cómo ingresar en la aplicación.",
      },
      appointment_justification_submitted: PENDING,
      appointment_justification_reviewed: PENDING,
      appointment_availability_changed: PENDING,
      appointment_space_changed: PENDING,
      appointment_needs_updated: PENDING,
      request_received: PENDING,
      request_under_review: PENDING,
      request_information_requested: PENDING,
      request_information_provided: PENDING,
      request_accepted: PENDING,
      request_referred: PENDING,
      request_closed: PENDING,
      request_cancelled: PENDING,
      privacy_request_granted: PENDING,
      privacy_request_denied: PENDING,
    };
    for (const kind of APPOINTMENT_NOTIFICATION_EVENT_KIND_VALUES) {
      const external = toExternalNotification(event(kind));
      expect(external).toEqual(texts[kind]);
      expect(`${external.title} ${external.body}`).not.toContain("atencion-ficticia-1");
      expect(`${external.title} ${external.body}`).not.toContain("inasistencia");
      expect(`${external.title} ${external.body}`).not.toContain("justificación");
    }
    for (const kind of REQUEST_NOTIFICATION_EVENT_KIND_VALUES) {
      const requestExternal = toExternalNotification(
        toNotificationEvent({
          kind,
          requestId: "solicitud-ficticia-1",
          recipientId: "estudiante-ficticio-1",
          occurredAt: 6000,
        }),
      );
      expect(requestExternal).toEqual(texts[kind]);
      expect(`${requestExternal.title} ${requestExternal.body}`).not.toContain("solicitud");
    }
  });

  test("la inasistencia no se revela fuera de sesión", () => {
    const external = toExternalNotification(event("appointment_no_show"));
    expect(external.title).toBe("Tienes una actualización pendiente");
    expect(external.body).toBe("Revisa las novedades en la aplicación.");
    expect(`${external.title} ${external.body}`).not.toContain("inasistencia");
    expect(`${external.title} ${external.body}`).not.toContain("justificación");
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
  test("la reserva del estudiante le confirma con forma exacta y avisa al profesional", () => {
    const created = notificationEventsForCreation(subject, 1000, subject.studentId);
    expect(describeAll(created)).toEqual([
      { kind: "appointment_scheduled", recipient: "student" },
      { kind: "appointment_scheduled", recipient: "professional" },
    ]);
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
          notificationEventsForTransition(
            subject,
            change(transition.from, transition.to, 2000, actorFor(transition.to)),
          ),
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
      change("scheduled", "cancelled_by_cereti", 2000, subject.professionalId),
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
    const otherKind = notificationEventsForTransition(
      subject,
      change("scheduled", "no_show", 2000, subject.professionalId),
    );
    const otherRecipient = notificationEventsForTransition(
      subject,
      change("scheduled", "rescheduled", 2000, "tercero-ficticio-1"),
    );
    const creation = notificationEventsForCreation(subject, 2000, subject.professionalId);

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
    expect(() =>
      notificationEventsForCreation({ ...subject, studentId: " " }, 1000, subject.professionalId),
    ).toThrow("destinatario");
    expect(() =>
      notificationEventsForCreation({ ...subject, appointmentId: "" }, 1000, subject.studentId),
    ).toThrow("atención");
  });
});

describe("Aviso del acceso en línea (TI2-142)", () => {
  test("agregar o reemplazar el enlace avisa solo al estudiante, sin el enlace", () => {
    const emitted = notificationEventsForOnlineAccess(subject, 3000);
    expect(emitted).toEqual([
      {
        kind: "appointment_online_access_ready",
        appointmentId: "atencion-ficticia-1",
        recipientId: "estudiante-ficticio-1",
        occurredAt: 3000,
        version: "v1",
      },
    ]);
    const external = toExternalNotification(emitted[0]);
    expect(`${external.title} ${external.body}`).not.toContain("meet");
    expect(`${external.title} ${external.body}`).not.toContain("http");
  });

  test("un reemplazo posterior produce otra clave y un reintento repite la misma", () => {
    const [first] = notificationEventsForOnlineAccess(subject, 3000);
    const [retry] = notificationEventsForOnlineAccess(subject, 3000);
    const [replacement] = notificationEventsForOnlineAccess(subject, 4000);
    expect(notificationIdempotencyKey(retry)).toBe(notificationIdempotencyKey(first));
    expect(notificationIdempotencyKey(replacement)).not.toBe(notificationIdempotencyKey(first));
  });

  test("la solicitud es un recurso propio y no se confunde con una atención", () => {
    const [emitted] = notificationEventsForRequestReceived(
      { requestId: "solicitud-ficticia-1", studentId: "estudiante-ficticio-1" },
      5000,
    );
    const requestEvent = emitted as RequestNotificationEvent;
    expect(requestEvent).toEqual({
      kind: "request_received",
      requestId: "solicitud-ficticia-1",
      recipientId: "estudiante-ficticio-1",
      occurredAt: 5000,
      version: "v1",
    });
    expectTypeOf(requestEvent).toMatchTypeOf<RequestNotificationEvent>();
    expect("appointmentId" in requestEvent).toBe(false);
    expect(notificationIdempotencyKey(requestEvent)).toBe(
      JSON.stringify([
        "v1",
        "request_received",
        "request",
        "solicitud-ficticia-1",
        "estudiante-ficticio-1",
        5000,
      ]),
    );
    expect(notificationIdempotencyKey(requestEvent)).not.toBe(
      JSON.stringify([
        "v1",
        "request_received",
        "solicitud-ficticia-1",
        "estudiante-ficticio-1",
        5000,
      ]),
    );
  });

  test("la clase debe corresponder al recurso", () => {
    expect(() =>
      toNotificationEvent({
        kind: "appointment_scheduled",
        requestId: "solicitud-ficticia-1",
        recipientId: "estudiante-ficticio-1",
        occurredAt: 1000,
      } as never),
    ).toThrow("no corresponde a una solicitud");
    expect(() =>
      toNotificationEvent({
        kind: "request_received",
        appointmentId: "atencion-ficticia-1",
        recipientId: "estudiante-ficticio-1",
        occurredAt: 1000,
      } as never),
    ).toThrow("no corresponde a una atención");
  });

  test("el evento exige exactamente un recurso", () => {
    expect(() =>
      toNotificationEvent({
        kind: "request_received",
        requestId: "  ",
        recipientId: "estudiante-ficticio-1",
        occurredAt: 1000,
      }),
    ).toThrow("solicitud");
    expect(() =>
      toNotificationEvent({
        kind: "request_received",
        appointmentId: "atencion-ficticia-1",
        requestId: "solicitud-ficticia-1",
        recipientId: "estudiante-ficticio-1",
        occurredAt: 1000,
      } as never),
    ).toThrow("exactamente un recurso");
    expect(() =>
      toNotificationEvent({
        kind: "request_received",
        recipientId: "estudiante-ficticio-1",
        occurredAt: 1000,
      } as never),
    ).toThrow("exactamente un recurso");
  });
});

describe("Avisos de la agenda con varios profesionales (TI2-150)", () => {
  const coordinated: NotificationSubject = {
    ...subject,
    additionalProfessionalIds: ["profesional-ficticio-2"],
  };

  function recipients(emitted: readonly NotificationEvent[]): readonly string[] {
    return emitted.map((item) => item.recipientId);
  }

  test("la cancelación del estudiante avisa a cada profesional de la atención", () => {
    const emitted = notificationEventsForTransition(
      coordinated,
      change("scheduled", "cancelled_by_student", 2000, subject.studentId),
    );
    expect(emitted.map((item) => item.kind)).toEqual([
      "appointment_cancelled",
      "appointment_cancelled",
    ]);
    expect(recipients(emitted)).toEqual(["profesional-ficticio-1", "profesional-ficticio-2"]);
  });

  test("quien hace el cambio no se avisa a sí mismo", () => {
    const cancelled = notificationEventsForTransition(
      coordinated,
      change("scheduled", "cancelled_by_cereti", 2000, subject.professionalId),
    );
    expect(recipients(cancelled)).toEqual(["estudiante-ficticio-1", "profesional-ficticio-2"]);

    const created = notificationEventsForCreation(coordinated, 1000, subject.professionalId);
    expect(recipients(created)).toEqual(["estudiante-ficticio-1", "profesional-ficticio-2"]);
  });

  test("un profesional repetido recibe un solo aviso", () => {
    const repeated: NotificationSubject = {
      ...subject,
      additionalProfessionalIds: [" profesional-ficticio-1 ", "profesional-ficticio-2"],
    };
    const emitted = notificationEventsForTransition(
      repeated,
      change("scheduled", "rescheduled", 2000, subject.studentId),
    );
    expect(recipients(emitted)).toEqual(["profesional-ficticio-1", "profesional-ficticio-2"]);
  });

  test("la justificación entregada avisa a los profesionales sin la explicación", () => {
    const emitted = notificationEventsForJustificationSubmitted(coordinated, 3000);
    expect(emitted).toEqual([
      {
        kind: "appointment_justification_submitted",
        appointmentId: "atencion-ficticia-1",
        recipientId: "profesional-ficticio-1",
        occurredAt: 3000,
        version: "v1",
      },
      {
        kind: "appointment_justification_submitted",
        appointmentId: "atencion-ficticia-1",
        recipientId: "profesional-ficticio-2",
        occurredAt: 3000,
        version: "v1",
      },
    ]);
  });
});

describe("Avisos de la solicitud (TI2-150)", () => {
  const STUDENT = "estudiante-ficticio-1";
  const REVIEWER = "profesional-ficticio-1";
  const requestSubject: RequestNotificationSubject = {
    requestId: "solicitud-ficticia-1",
    studentId: STUDENT,
    reviewerId: REVIEWER,
  };

  /** El Estudiante responde y cancela; el Profesional hace los demás pasos. */
  function requestChange(from: RequestState, to: RequestState): RequestStateChange {
    const studentStep =
      to === "cancelled" ||
      (from === "awaiting_information_or_acceptance" && to === "under_review");
    return {
      from,
      to,
      actorId: studentStep ? STUDENT : REVIEWER,
      occurredAt: 7000,
      reason: "Motivo sensible de la solicitud",
    };
  }

  /** `null`: la transición no avisa, como la liberación de la toma (TI4-84). */
  const EXPECTED_REQUEST_TRANSITIONS: Record<string, readonly [string, string] | null> = {
    "received->under_review": ["request_under_review", STUDENT],
    "under_review->received": null,
    "awaiting_information_or_acceptance->received": null,
    "under_review->awaiting_information_or_acceptance": ["request_information_requested", STUDENT],
    "under_review->accepted": ["request_accepted", STUDENT],
    "awaiting_information_or_acceptance->accepted": ["request_accepted", STUDENT],
    "awaiting_information_or_acceptance->under_review": ["request_information_provided", REVIEWER],
    "under_review->referred": ["request_referred", STUDENT],
    "awaiting_information_or_acceptance->referred": ["request_referred", STUDENT],
    "received->cancelled": ["request_cancelled", REVIEWER],
    "under_review->cancelled": ["request_cancelled", REVIEWER],
    "awaiting_information_or_acceptance->cancelled": ["request_cancelled", REVIEWER],
    "under_review->closed_without_accompaniment": ["request_closed", STUDENT],
    "awaiting_information_or_acceptance->closed_without_accompaniment": ["request_closed", STUDENT],
  };

  test("cada transición declarada decide clase y destinatario", () => {
    for (const transition of REQUEST_TRANSITIONS) {
      const key = `${transition.from}->${transition.to}`;
      const expected = EXPECTED_REQUEST_TRANSITIONS[key];
      if (expected === undefined) throw new Error(`Falta la expectativa de aviso para ${key}.`);
      const emitted = notificationEventsForRequestTransition(
        requestSubject,
        requestChange(transition.from, transition.to),
      );
      expect(emitted.map((item) => [item.kind, item.recipientId])).toEqual(
        expected === null ? [] : [expected],
      );
    }
    expect(Object.keys(EXPECTED_REQUEST_TRANSITIONS)).toHaveLength(REQUEST_TRANSITIONS.length);
  });

  test("la recepción confirma al estudiante con el instante de la fila", () => {
    expect(notificationEventsForRequestReceived(requestSubject, 5000)).toEqual([
      {
        kind: "request_received",
        requestId: "solicitud-ficticia-1",
        recipientId: STUDENT,
        occurredAt: 5000,
        version: "v1",
      },
    ]);
  });

  test("sin quien la revise, cancelar no tiene a quién avisar", () => {
    const withoutReviewer: RequestNotificationSubject = {
      requestId: "solicitud-ficticia-1",
      studentId: STUDENT,
    };
    expect(
      notificationEventsForRequestTransition(
        withoutReviewer,
        requestChange("received", "cancelled"),
      ),
    ).toEqual([]);
  });

  test("el evento no copia el motivo ni la respuesta", () => {
    const emitted = notificationEventsForRequestTransition(
      requestSubject,
      requestChange("under_review", "closed_without_accompaniment"),
    );
    expect(Object.keys(emitted[0]).sort()).toEqual([
      "kind",
      "occurredAt",
      "recipientId",
      "requestId",
      "version",
    ]);
    expect(JSON.stringify(emitted)).not.toContain("Motivo sensible");
  });

  test("un reintento del mismo cambio repite la clave", () => {
    const [first] = notificationEventsForRequestTransition(
      requestSubject,
      requestChange("under_review", "accepted"),
    );
    const [retry] = notificationEventsForRequestTransition(
      requestSubject,
      requestChange("under_review", "accepted"),
    );
    expect(notificationIdempotencyKey(retry)).toBe(notificationIdempotencyKey(first));
  });

  test("una transición no declarada no se notifica", () => {
    expect(() =>
      notificationEventsForRequestTransition(
        requestSubject,
        requestChange("accepted", "cancelled"),
      ),
    ).toThrow("no está declarada");
  });
});

describe("Avisos de cambios de configuración (TI2-156)", () => {
  test("el cambio de disponibilidad avisa a todos salvo a quien lo hizo", () => {
    const byProfessional = notificationEventsForAvailabilityChange(
      subject,
      8000,
      subject.professionalId,
    );
    expect(describeAll(byProfessional)).toEqual([
      { kind: "appointment_availability_changed", recipient: "student" },
    ]);

    const byStudent = notificationEventsForAvailabilityChange(subject, 8000, subject.studentId);
    expect(describeAll(byStudent)).toEqual([
      { kind: "appointment_availability_changed", recipient: "professional" },
    ]);

    const byAdmin = notificationEventsForAvailabilityChange(subject, 8000, "admin-ficticio-1");
    expect(describeAll(byAdmin)).toEqual([
      { kind: "appointment_availability_changed", recipient: "student" },
      { kind: "appointment_availability_changed", recipient: "professional" },
    ]);
  });

  test("el cambio de sala avisa a todos salvo a quien lo hizo", () => {
    const byAdmin = notificationEventsForSpaceChange(subject, 8000, "admin-ficticio-1");
    expect(describeAll(byAdmin)).toEqual([
      { kind: "appointment_space_changed", recipient: "student" },
      { kind: "appointment_space_changed", recipient: "professional" },
    ]);
  });

  test("la actualización de necesidades avisa solo a profesionales", () => {
    const emitted = notificationEventsForNeedsUpdated(subject, 8000);
    expect(emitted).toEqual([
      {
        kind: "appointment_needs_updated",
        appointmentId: "atencion-ficticia-1",
        recipientId: "profesional-ficticio-1",
        occurredAt: 8000,
        version: "v1",
      },
    ]);
    const external = toExternalNotification(emitted[0]);
    expect(external).toEqual({
      title: "Tienes una actualización pendiente",
      body: "Revisa las novedades en la aplicación.",
    });
  });
});
