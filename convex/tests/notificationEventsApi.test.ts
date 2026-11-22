/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { conflictError, noAvailabilityError } from "../domain/errors/api_error";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

/**
 * Avisos de solicitudes, reservas, cambios, cancelaciones y justificaciones
 * (TI2-150), por la API pública y con datos ficticios.
 *
 * Cada prueba recorre el flujo real y lee `notificationEvents`: quién recibe
 * cada clase, que un reintento no deja otra fila, que un cambio rechazado no
 * deja aviso y que ninguna fila copia motivos, respuestas, explicaciones ni
 * necesidades. La agenda es el lunes 2027-01-04 en `America/Santiago`
 * (UTC−3), con el reloj fijado antes; el responsable atiende en línea de
 * 12:00 a 14:00 y el adicional de 12:00 a 14:00, y solo el responsable de
 * 15:00 a 17:00. El acompañamiento necesita subtítulos, que declara la
 * coordinación.
 */

const ISSUER = "https://accounts.google.com";
const at = (hour: number) => Date.UTC(2027, 0, 4, hour + 3);
const CAPTIONS = { id: "Subtítulos en la atención", label: "Subtítulos en la atención" };

/** Varias mutations por prueba con la suite en paralelo, como TI2-142. */
const API_TEST_TIMEOUT_MS = 20_000;

/** Viernes 2027-01-01 a mediodía UTC: antes de toda la agenda de estas pruebas. */
const NOW = Date.UTC(2027, 0, 1, 12);

beforeEach(() => {
  // Solo `Date`: los temporizadores siguen reales para no detener `convex-test`.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

const CONFLICT = { code: "conflict", message: conflictError().message };
const NO_AVAILABILITY = { code: "no_availability", message: noAvailabilityError().message };

/** Campos que puede tener una fila de aviso: referencias, clase, instante y versión. */
const NOTIFICATION_FIELDS = [
  "_creationTime",
  "_id",
  "appointmentId",
  "idempotencyKey",
  "kind",
  "occurredAt",
  "recipientId",
  "requestId",
  "version",
];

const SENSITIVE = "Texto sensible ficticio";

function identityFor(subject: string) {
  return { subject, issuer: ISSUER, tokenIdentifier: `${ISSUER}|${subject}`, name: "Ficticio" };
}

async function publicError(promise: Promise<unknown>) {
  return await promise.then(
    () => {
      throw new Error("Se esperaba un error público");
    },
    (error: unknown) => (error instanceof ConvexError ? error.data : error),
  );
}

async function notificationRows(
  t: TestConvex<typeof schema>,
): Promise<Doc<"notificationEvents">[]> {
  return await t.run(async (ctx) => await ctx.db.query("notificationEvents").take(100));
}

/** Clase y destinatario de cada aviso, en orden de registro. */
async function notices(t: TestConvex<typeof schema>) {
  return (await notificationRows(t)).map((row) => [row.kind, row.recipientId]);
}

/** Ninguna fila trae otro campo ni copia el texto que escribió una persona. */
async function expectOnlyMinimalReferences(t: TestConvex<typeof schema>) {
  const rows = await notificationRows(t);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    for (const field of Object.keys(row)) expect(NOTIFICATION_FIELDS).toContain(field);
  }
  expect(JSON.stringify(rows)).not.toContain(SENSITIVE);
  expect(JSON.stringify(rows)).not.toContain(CAPTIONS.label);
}

async function user(
  t: TestConvex<typeof schema>,
  subject: string,
  role: "student" | "professional",
): Promise<Id<"users">> {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("users", {
        email: `${subject}@uct.cl`,
        fullName: "Ficticio",
        role,
        institutionalStatus: "enabled",
        accountStatus: "active",
        tokenIdentifier: `${ISSUER}|${subject}`,
      }),
  );
}

async function seedAgenda(t: TestConvex<typeof schema>) {
  const student = await user(t, "ti150-est-1", "student");
  const responsible = await user(t, "ti150-pro-1", "professional");
  const additional = await user(t, "ti150-pro-2", "professional");
  const accompanimentId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("accompaniments", {
      studentId: student,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: CAPTIONS.label,
    });
    for (const userId of [responsible, additional]) {
      await ctx.db.insert("accompanimentAssignments", {
        accompanimentId: id,
        userId,
        assignedRole: "professional",
        status: "active",
      });
    }
    const block = async (professionalId: Id<"users">, slotMinutes: number, start: number) =>
      await ctx.db.insert("availabilityBlocks", {
        professionalId,
        weekday: 1,
        startMinute: start,
        endMinute: start + 120,
        slotMinutes,
        modality: "online",
        isActive: true,
      });
    await block(responsible, 60, 720);
    await block(additional, 30, 720);
    await block(responsible, 60, 900);
    return id;
  });
  return { student, responsible, additional, accompanimentId };
}

test(
  "TI2-150 API: reservar, reagendar y cancelar avisan a los demás participantes una sola vez",
  async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedAgenda(t);
    const asStudent = t.withIdentity(identityFor("ti150-est-1"));
    const asResponsible = t.withIdentity(identityFor("ti150-pro-1"));
    const booking = {
      accompanimentId: seeded.accompanimentId as string,
      professionalId: seeded.responsible as string,
      modality: "online" as const,
      startAt: at(12),
      endAt: at(13),
      additionalProfessionalIds: [seeded.additional as string],
      onlineSupports: [CAPTIONS],
      version: "v1" as const,
    };

    // El responsable coordina: el Estudiante recibe la confirmación y el
    // adicional el aviso; quien reservó no se avisa a sí mismo.
    const { appointmentId } = await asResponsible.mutation(
      api.presentation.appointments.bookAppointment,
      booking,
    );
    expect(await notices(t)).toEqual([
      ["appointment_scheduled", seeded.student],
      ["appointment_scheduled", seeded.additional],
    ]);

    // Repetir la reserva choca con la atención creada y no deja otro aviso.
    expect(
      await publicError(
        asResponsible.mutation(api.presentation.appointments.bookAppointment, booking),
      ),
    ).toStrictEqual(CONFLICT);
    expect(await notices(t)).toHaveLength(2);

    // Un cambio rechazado no deja aviso: el adicional no atiende a las 15:00.
    const reschedule = {
      appointmentId,
      professionalId: seeded.responsible as string,
      modality: "online" as const,
      version: "v1" as const,
    };
    expect(
      await publicError(
        asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
          ...reschedule,
          startAt: at(15),
          endAt: at(16),
        }),
      ),
    ).toStrictEqual(NO_AVAILABILITY);
    expect(await notices(t)).toHaveLength(2);

    await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, {
      ...reschedule,
      startAt: at(13),
      endAt: at(14),
    });
    await asStudent.mutation(api.presentation.appointments.cancelAppointment, {
      appointmentId,
      reason: SENSITIVE,
      version: "v1",
    });
    expect((await notices(t)).slice(2)).toEqual([
      ["appointment_rescheduled", seeded.responsible],
      ["appointment_rescheduled", seeded.additional],
      ["appointment_cancelled", seeded.responsible],
      ["appointment_cancelled", seeded.additional],
    ]);

    // Cancelar otra vez se rechaza y no repite el aviso.
    expect(
      await publicError(
        asStudent.mutation(api.presentation.appointments.cancelAppointment, {
          appointmentId,
          version: "v1",
        }),
      ),
    ).toStrictEqual(CONFLICT);
    expect(await notices(t)).toHaveLength(6);
    expect((await notificationRows(t)).every((row) => row.appointmentId === appointmentId)).toBe(
      true,
    );
    await expectOnlyMinimalReferences(t);
  },
  API_TEST_TIMEOUT_MS,
);

test(
  "TI2-150 API: la inasistencia, la justificación y su revisión avisan sin copiar la explicación",
  async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedAgenda(t);
    const asStudent = t.withIdentity(identityFor("ti150-est-1"));
    const asResponsible = t.withIdentity(identityFor("ti150-pro-1"));
    const { appointmentId } = await asResponsible.mutation(
      api.presentation.appointments.bookAppointment,
      {
        accompanimentId: seeded.accompanimentId as string,
        professionalId: seeded.responsible as string,
        modality: "online",
        startAt: at(12),
        endAt: at(13),
        additionalProfessionalIds: [seeded.additional as string],
        onlineSupports: [CAPTIONS],
        version: "v1",
      },
    );
    const booked = (await notices(t)).length;

    // El lunes después de la atención el responsable registra la inasistencia.
    vi.setSystemTime(at(15));
    await asResponsible.mutation(api.presentation.appointments.recordAppointmentAttendance, {
      appointmentId,
      outcome: "no_show",
      version: "v1",
    });

    // El martes el Estudiante entrega su explicación; repetirla se rechaza.
    vi.setSystemTime(Date.UTC(2027, 0, 5, 15));
    const justification = {
      appointmentId,
      explanation: SENSITIVE,
      supportingDocumentReceived: true,
      version: "v1" as const,
    };
    await asStudent.mutation(
      api.presentation.appointments.submitAppointmentJustification,
      justification,
    );
    expect(
      await publicError(
        asStudent.mutation(
          api.presentation.appointments.submitAppointmentJustification,
          justification,
        ),
      ),
    ).toStrictEqual(CONFLICT);

    await asResponsible.mutation(api.presentation.appointments.reviewAppointmentJustification, {
      appointmentId,
      review: "accepted",
      version: "v1",
    });
    expect((await notices(t)).slice(booked)).toEqual([
      ["appointment_no_show", seeded.student],
      ["appointment_justification_submitted", seeded.responsible],
      ["appointment_justification_submitted", seeded.additional],
      ["appointment_justification_reviewed", seeded.student],
    ]);
    await expectOnlyMinimalReferences(t);
  },
  API_TEST_TIMEOUT_MS,
);

const SUBMISSION = {
  needSummary: SENSITIVE,
  expectedOutcome: "Acordar ajustes de comunicación con mis docentes",
  accessNeeds: [{ id: "written-communication", label: "Comunicación escrita" }],
  otherAccessNeed: SENSITIVE,
  modalityPreference: "online" as const,
  generalAvailability: {
    preferredWeekdays: [1, 3],
    preferredTimeRange: { from: "09:00", to: "12:00" },
  },
  preferredAccessibleInformationChannel: "Correo con letra grande",
};

async function seedRequestActors(t: TestConvex<typeof schema>) {
  const student = await user(t, "ti150-sol-est", "student");
  const professional = await user(t, "ti150-sol-pro", "professional");
  return {
    student,
    professional,
    asStudent: t.withIdentity(identityFor("ti150-sol-est")),
    asProfessional: t.withIdentity(identityFor("ti150-sol-pro")),
  };
}

test(
  "TI2-150 API: cada paso de la solicitud avisa a su destinatario y el reintento no duplica",
  async () => {
    const t = convexTest(schema, modules);
    const { student, professional, asStudent, asProfessional } = await seedRequestActors(t);
    const requests = api.presentation.requests;

    const submission = { ...SUBMISSION, idempotencyKey: "ti150-clave-1" };
    const created = await asStudent.mutation(requests.createRequest, submission);
    const retried = await asStudent.mutation(requests.createRequest, submission);
    expect(retried._id).toBe(created._id);
    expect(await notices(t)).toEqual([["request_received", student]]);

    const requestId = created._id;
    await asProfessional.mutation(requests.takeRequest, { requestId });
    await asProfessional.mutation(requests.requestAdditionalInformation, {
      requestId,
      reason: SENSITIVE,
    });
    await asStudent.mutation(requests.respondToInformationRequest, {
      requestId,
      response: SENSITIVE,
    });
    await asProfessional.mutation(requests.closeRequestWithoutAccompaniment, {
      requestId,
      reason: SENSITIVE,
    });
    // Cerrar otra vez se rechaza y no deja otro aviso.
    expect(
      await publicError(
        asProfessional.mutation(requests.closeRequestWithoutAccompaniment, {
          requestId,
          reason: SENSITIVE,
        }),
      ),
    ).toMatchObject({ code: "conflict" });

    expect(await notices(t)).toEqual([
      ["request_received", student],
      ["request_under_review", student],
      ["request_information_requested", student],
      ["request_information_provided", professional],
      ["request_closed", student],
    ]);
    expect((await notificationRows(t)).every((row) => row.requestId === requestId)).toBe(true);
    await expectOnlyMinimalReferences(t);
  },
  API_TEST_TIMEOUT_MS,
);

test(
  "TI2-150 API: aceptar, derivar y cancelar avisan a quien corresponde",
  async () => {
    const t = convexTest(schema, modules);
    const { student, professional, asStudent, asProfessional } = await seedRequestActors(t);
    const requests = api.presentation.requests;
    const create = async (key: string) =>
      (await asStudent.mutation(requests.createRequest, { ...SUBMISSION, idempotencyKey: key }))
        ._id;

    const toAccept = await create("ti150-aceptar");
    await asProfessional.mutation(requests.takeRequest, { requestId: toAccept });
    await asProfessional.mutation(requests.acceptRequest, {
      requestId: toAccept,
      objective: "Objetivo ficticio",
    });

    const toRefer = await create("ti150-derivar");
    await asProfessional.mutation(requests.takeRequest, { requestId: toRefer });
    await asProfessional.mutation(requests.referRequest, {
      requestId: toRefer,
      destinationUnit: "Unidad ficticia",
      reason: SENSITIVE,
    });

    // Sin toma no hay quién revise: cancelar no avisa a nadie.
    const withoutReviewer = await create("ti150-sin-toma");
    await asStudent.mutation(requests.cancelRequest, {
      requestId: withoutReviewer,
      reason: SENSITIVE,
    });

    const taken = await create("ti150-con-toma");
    await asProfessional.mutation(requests.takeRequest, { requestId: taken });
    await asStudent.mutation(requests.cancelRequest, { requestId: taken, reason: SENSITIVE });

    const byRequest = (requestId: Id<"requests">) =>
      notificationRows(t).then((rows) =>
        rows.filter((row) => row.requestId === requestId).map((row) => [row.kind, row.recipientId]),
      );
    expect(await byRequest(toAccept)).toEqual([
      ["request_received", student],
      ["request_under_review", student],
      ["request_accepted", student],
    ]);
    expect(await byRequest(toRefer)).toEqual([
      ["request_received", student],
      ["request_under_review", student],
      ["request_referred", student],
    ]);
    expect(await byRequest(withoutReviewer)).toEqual([["request_received", student]]);
    expect(await byRequest(taken)).toEqual([
      ["request_received", student],
      ["request_under_review", student],
      ["request_cancelled", professional],
    ]);
    await expectOnlyMinimalReferences(t);
  },
  API_TEST_TIMEOUT_MS,
);

test(
  "TI2-150 API: el registro por canal oficial confirma al Estudiante una sola vez",
  async () => {
    const t = convexTest(schema, modules);
    const { student, asProfessional } = await seedRequestActors(t);
    const official = {
      ...SUBMISSION,
      idempotencyKey: "ti150-oficial",
      studentEmail: "ti150-sol-est@uct.cl",
    };

    const first = await asProfessional.mutation(
      api.presentation.requests.registerOfficialRequest,
      official,
    );
    const retry = await asProfessional.mutation(
      api.presentation.requests.registerOfficialRequest,
      official,
    );
    expect(retry._id).toBe(first._id);

    const rows = await notificationRows(t);
    expect(rows.map((row) => [row.kind, row.requestId, row.recipientId])).toEqual([
      ["request_received", first._id, student],
    ]);
    await expectOnlyMinimalReferences(t);
  },
  API_TEST_TIMEOUT_MS,
);
