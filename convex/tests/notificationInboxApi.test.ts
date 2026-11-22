/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

/**
 * Bandeja de avisos (TI2-154) por la API pública y con datos ficticios.
 *
 * Los avisos nacen del flujo real (TI2-150): una reserva del Estudiante y los
 * pasos de una solicitud. Las pruebas comprueban que cada persona lista y
 * marca solo los suyos, que el filtro distingue leídos de pendientes y que
 * abrir un aviso exige el permiso vigente sobre su recurso. La agenda es el
 * lunes 2027-01-04 en `America/Santiago` (UTC−3), con el reloj fijado antes.
 */

const ISSUER = "https://accounts.google.com";
const at = (hour: number) => Date.UTC(2027, 0, 4, hour + 3);
const NOW = Date.UTC(2027, 0, 1, 12);
const API_TEST_TIMEOUT_MS = 20_000;
const PAGE = { numItems: 10, cursor: null };
const DENIED = { code: "unauthorized", message: "No autorizado" };

beforeEach(() => {
  // Solo `Date`: los temporizadores siguen reales para no detener `convex-test`.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

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

/** El Estudiante reserva con su Profesional: un aviso para cada uno. */
async function seedBookedAppointment(t: TestConvex<typeof schema>) {
  const student = await user(t, "ti154-est", "student");
  const professional = await user(t, "ti154-pro", "professional");
  const { accompanimentId, assignmentId } = await t.run(async (ctx) => {
    const accompanimentId = await ctx.db.insert("accompaniments", {
      studentId: student,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "",
    });
    const assignmentId = await ctx.db.insert("accompanimentAssignments", {
      accompanimentId,
      userId: professional,
      assignedRole: "professional",
      status: "active",
    });
    await ctx.db.insert("availabilityBlocks", {
      professionalId: professional,
      weekday: 1,
      startMinute: 720,
      endMinute: 840,
      slotMinutes: 60,
      modality: "online",
      isActive: true,
    });
    return { accompanimentId, assignmentId };
  });
  const { appointmentId } = await t
    .withIdentity(identityFor("ti154-est"))
    .mutation(api.presentation.appointments.bookAppointment, {
      accompanimentId,
      professionalId: professional,
      modality: "online",
      startAt: at(12),
      endAt: at(13),
      version: "v1",
    });
  return { student, professional, assignmentId, appointmentId };
}

test(
  "TI2-154 API: cada persona lista y marca solo sus avisos, y distingue leídos de pendientes",
  async () => {
    const t = convexTest(schema, modules);
    const { student, professional, appointmentId } = await seedBookedAppointment(t);
    const asStudent = t.withIdentity(identityFor("ti154-est"));
    const asProfessional = t.withIdentity(identityFor("ti154-pro"));
    const inbox = api.presentation.notifications;

    const own = await asStudent.query(inbox.listOwnNotifications, { paginationOpts: PAGE });
    expect(own.page).toEqual([
      {
        id: expect.any(String),
        kind: "appointment_scheduled",
        appointmentId,
        recipientId: student,
        occurredAt: NOW,
        readStatus: "pending",
        version: "v1",
      },
    ]);
    const [studentNotice] = own.page;
    const [professionalNotice] = (
      await asProfessional.query(inbox.listOwnNotifications, { paginationOpts: PAGE })
    ).page;
    expect(professionalNotice).toMatchObject({ recipientId: professional, appointmentId });

    // El aviso de otra persona no se abre ni se marca, igual que uno inexistente.
    const foreign = { notificationId: professionalNotice.id };
    expect(await publicError(asStudent.query(inbox.openNotification, foreign))).toStrictEqual(
      DENIED,
    );
    expect(
      await publicError(asStudent.mutation(inbox.markNotificationRead, foreign)),
    ).toStrictEqual(DENIED);
    expect(
      (await asProfessional.query(inbox.listOwnNotifications, { paginationOpts: PAGE })).page[0],
    ).toMatchObject({ readStatus: "pending" });

    // Sin sesión no hay bandeja.
    expect(
      await publicError(t.query(inbox.listOwnNotifications, { paginationOpts: PAGE })),
    ).toStrictEqual(DENIED);

    // Marcar es idempotente: el reintento conserva el instante de la primera lectura.
    vi.setSystemTime(NOW + 60_000);
    const marked = await asStudent.mutation(inbox.markNotificationRead, {
      notificationId: studentNotice.id,
    });
    expect(marked).toEqual({ id: studentNotice.id, readStatus: "read", readAt: NOW + 60_000 });
    vi.setSystemTime(NOW + 120_000);
    expect(
      await asStudent.mutation(inbox.markNotificationRead, { notificationId: studentNotice.id }),
    ).toEqual(marked);

    const byStatus = async (readStatus: "pending" | "read") =>
      (
        await asStudent.query(inbox.listOwnNotifications, { paginationOpts: PAGE, readStatus })
      ).page.map((item) => [item.id, item.readStatus, item.readAt]);
    expect(await byStatus("read")).toEqual([[studentNotice.id, "read", NOW + 60_000]]);
    expect(await byStatus("pending")).toEqual([]);
  },
  API_TEST_TIMEOUT_MS,
);

test(
  "TI2-154 API: abrir un aviso de atención exige el permiso vigente y no revela el recurso",
  async () => {
    const t = convexTest(schema, modules);
    const { professional, assignmentId, appointmentId } = await seedBookedAppointment(t);
    const asProfessional = t.withIdentity(identityFor("ti154-pro"));
    const inbox = api.presentation.notifications;
    const [notice] = (
      await asProfessional.query(inbox.listOwnNotifications, { paginationOpts: PAGE })
    ).page;

    expect(
      await asProfessional.query(inbox.openNotification, { notificationId: notice.id }),
    ).toEqual(notice);

    // Al perder la asignación, el aviso sigue en su bandeja con solo la clase
    // y la referencia, pero abrirlo se deniega igual que un aviso ajeno.
    await t.run(async (ctx) => {
      await ctx.db.patch(assignmentId, { status: "revoked" });
    });
    expect(
      await publicError(
        asProfessional.query(inbox.openNotification, { notificationId: notice.id }),
      ),
    ).toStrictEqual(DENIED);
    expect(
      await publicError(
        asProfessional.query(api.presentation.appointments.getAppointment, {
          appointmentId,
          version: "v1",
        }),
      ),
    ).toStrictEqual(DENIED);
    const [stillListed] = (
      await asProfessional.query(inbox.listOwnNotifications, { paginationOpts: PAGE })
    ).page;
    expect(Object.keys(stillListed).sort()).toEqual(
      ["appointmentId", "id", "kind", "occurredAt", "readStatus", "recipientId", "version"].sort(),
    );
    expect(stillListed.recipientId).toBe(professional);

    // Una cuenta que dejó de estar vigente no lee su bandeja.
    await t.run(async (ctx) => {
      await ctx.db.patch(professional, { accountStatus: "inactive" });
    });
    expect(
      await publicError(asProfessional.query(inbox.listOwnNotifications, { paginationOpts: PAGE })),
    ).toStrictEqual(DENIED);
  },
  API_TEST_TIMEOUT_MS,
);

test(
  "TI2-154 API: abrir un aviso de solicitud usa la misma regla que su detalle",
  async () => {
    const t = convexTest(schema, modules);
    const student = await user(t, "ti154-sol-est", "student");
    const professional = await user(t, "ti154-sol-pro", "professional");
    const asStudent = t.withIdentity(identityFor("ti154-sol-est"));
    const asProfessional = t.withIdentity(identityFor("ti154-sol-pro"));
    const requests = api.presentation.requests;
    const inbox = api.presentation.notifications;

    const { _id: requestId } = await asStudent.mutation(requests.createRequest, {
      needSummary: "Necesidad ficticia",
      expectedOutcome: "Resultado ficticio",
      accessNeeds: [{ id: "written-communication", label: "Comunicación escrita" }],
      modalityPreference: "online",
      generalAvailability: {
        preferredWeekdays: [1],
        preferredTimeRange: { from: "09:00", to: "12:00" },
      },
      preferredAccessibleInformationChannel: "Correo",
      idempotencyKey: "ti154-clave",
    });
    await asProfessional.mutation(requests.takeRequest, { requestId });
    await asProfessional.mutation(requests.requestAdditionalInformation, {
      requestId,
      reason: "Motivo ficticio",
    });
    await asStudent.mutation(requests.respondToInformationRequest, {
      requestId,
      response: "Respuesta ficticia",
    });

    const [notice] = (
      await asProfessional.query(inbox.listOwnNotifications, { paginationOpts: PAGE })
    ).page;
    expect(notice).toMatchObject({
      kind: "request_information_provided",
      requestId,
      recipientId: professional,
    });
    expect(
      await asProfessional.query(inbox.openNotification, { notificationId: notice.id }),
    ).toEqual(notice);

    // El Estudiante abre los suyos mientras la solicitud sea suya.
    const studentNotices = (
      await asStudent.query(inbox.listOwnNotifications, { paginationOpts: PAGE })
    ).page;
    expect(studentNotices.map((item) => item.kind)).toEqual([
      "request_information_requested",
      "request_under_review",
      "request_received",
    ]);
    for (const item of studentNotices) {
      expect(item.recipientId).toBe(student);
      expect(await asStudent.query(inbox.openNotification, { notificationId: item.id })).toEqual(
        item,
      );
    }

    // Sin toma activa el Profesional ya no lee la solicitud ni abre su aviso.
    await t.run(async (ctx) => {
      const takes = await ctx.db
        .query("requestAssignments")
        .withIndex("by_request_and_user_and_status", (q) =>
          q.eq("requestId", requestId).eq("userId", professional).eq("status", "active"),
        )
        .take(5);
      for (const take of takes) await ctx.db.patch(take._id, { status: "revoked" });
    });
    expect(
      await publicError(
        asProfessional.query(inbox.openNotification, { notificationId: notice.id }),
      ),
    ).toStrictEqual(DENIED);
    expect(
      await publicError(asProfessional.query(requests.getRequest, { requestId })),
    ).toStrictEqual(DENIED);
  },
  API_TEST_TIMEOUT_MS,
);
