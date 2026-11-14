/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { conflictError, noAvailabilityError } from "../domain/errors/api_error";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

/**
 * Coordinación con varios profesionales y acceso en línea privado (TI2-142),
 * por la API pública y con datos ficticios.
 *
 * La agenda es el lunes 2027-01-04 en la zona de la agenda (`America/Santiago`,
 * UTC−3 ese día), en el futuro para que el reagendamiento no lo trate como
 * pasado. El Profesional responsable atiende en línea de 12:00 a 14:00
 * en cupos de una hora; el adicional, de 12:00 a 14:00 en cupos de media hora.
 * El acompañamiento del Estudiante necesita subtítulos, así que una atención
 * en línea solo es compatible si la coordinación declara ese apoyo.
 */

const ISSUER = "https://accounts.google.com";
const at = (hour: number) => Date.UTC(2027, 0, 4, hour + 3);
const HALF_HOUR = 30 * 60_000;
const CAPTIONS = { id: "Subtítulos en la atención", label: "Subtítulos en la atención" };
const LINK = "https://meet.google.com/sol-casa-pan";
const OTHER_LINK = "https://meet.google.com/mar-roca-sal";

/**
 * Cada prueba recorre varias mutations con `convex-test`, y la primera del
 * archivo además carga los módulos; con la suite completa en paralelo superan
 * los 5 s por defecto, como la prueba de calendario de TI2-122.
 */
const API_TEST_TIMEOUT_MS = 20_000;

const DENIED = { code: "unauthorized", message: "No autorizado" };
const CONFLICT = { code: "conflict", message: conflictError().message };
const NO_AVAILABILITY = { code: "no_availability", message: noAvailabilityError().message };

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

async function seed(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const user = async (subject: string, role: "student" | "professional" | "intern") =>
      await ctx.db.insert("users", {
        email: `${subject}@uct.cl`,
        fullName: "Ficticio",
        role,
        institutionalStatus: "enabled",
        accountStatus: "active",
        tokenIdentifier: `${ISSUER}|${subject}`,
      });
    const student = await user("ti142-est-1", "student");
    const otherStudent = await user("ti142-est-2", "student");
    const responsible = await user("ti142-pro-1", "professional");
    const additional = await user("ti142-pro-2", "professional");
    const outsider = await user("ti142-pro-3", "professional");
    const intern = await user("ti142-int-1", "intern");

    const accompanimentId = await ctx.db.insert("accompaniments", {
      studentId: student,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: CAPTIONS.label,
    });
    const otherAccompanimentId = await ctx.db.insert("accompaniments", {
      studentId: otherStudent,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "",
    });
    const assign = async (
      accompaniment: Id<"accompaniments">,
      userId: Id<"users">,
      assignedRole: "professional" | "intern",
    ) =>
      await ctx.db.insert("accompanimentAssignments", {
        accompanimentId: accompaniment,
        userId,
        assignedRole,
        status: "active",
      });
    await assign(accompanimentId, responsible, "professional");
    await assign(accompanimentId, additional, "professional");
    await assign(accompanimentId, intern, "intern");
    await assign(otherAccompanimentId, additional, "professional");

    const block = async (professionalId: Id<"users">, slotMinutes: number, start = 720) =>
      await ctx.db.insert("availabilityBlocks", {
        professionalId,
        weekday: 1,
        startMinute: start,
        endMinute: start + 120,
        slotMinutes,
        modality: "online",
        isActive: true,
      });
    await block(responsible, 60);
    await block(additional, 30);
    // Solo el responsable atiende de 15:00 a 17:00: el adicional no puede.
    await block(responsible, 60, 900);

    return {
      student,
      otherStudent,
      responsible,
      additional,
      outsider,
      intern,
      accompanimentId,
      otherAccompanimentId,
    };
  });
}

function slot(seeded: Awaited<ReturnType<typeof seed>>, hour: number) {
  return {
    accompanimentId: seeded.accompanimentId as string,
    professionalId: seeded.responsible as string,
    modality: "online" as const,
    startAt: at(hour),
    endAt: at(hour + 1),
    version: "v1" as const,
  };
}

async function participantsOf(t: TestConvex<typeof schema>, appointmentId: string) {
  return await t.run(async (ctx) =>
    (
      await ctx.db
        .query("appointmentProfessionals")
        .withIndex("by_appointmentId_and_professionalId", (q) =>
          q.eq("appointmentId", appointmentId as Id<"appointments">),
        )
        .take(10)
    ).map(({ professionalId, startsAt, endsAt }) => ({ professionalId, startsAt, endsAt })),
  );
}

test(
  "TI2-142 API: el Profesional coordina una atención con dos profesionales y los cruces cuentan para todos",
  async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const asStudent = t.withIdentity(identityFor("ti142-est-1"));
    const asResponsible = t.withIdentity(identityFor("ti142-pro-1"));
    const asAdditional = t.withIdentity(identityFor("ti142-pro-2"));
    const book = api.presentation.appointments.bookAppointment;
    const coordinated = {
      ...slot(seeded, 12),
      additionalProfessionalIds: [seeded.additional as string],
      onlineSupports: [CAPTIONS],
    };

    // El Estudiante no elige profesionales ni apoyos; sin el apoyo que cubre la
    // necesidad, la atención en línea no es compatible.
    expect(await publicError(asStudent.mutation(book, coordinated))).toStrictEqual(DENIED);
    const { onlineSupports: _supports, ...withoutSupports } = coordinated;
    expect(await publicError(asResponsible.mutation(book, withoutSupports))).toStrictEqual(
      NO_AVAILABILITY,
    );
    // Un profesional que no está asignado no puede ser adicional.
    expect(
      await publicError(
        asResponsible.mutation(book, {
          ...coordinated,
          additionalProfessionalIds: [seeded.outsider as string],
        }),
      ),
    ).toStrictEqual(NO_AVAILABILITY);

    const { appointmentId } = await asResponsible.mutation(book, coordinated);
    const row = await t.run(async (ctx) => await ctx.db.get(appointmentId as Id<"appointments">));
    expect(row).toMatchObject({
      studentId: seeded.student,
      professionalId: seeded.responsible,
      onlineSupports: [CAPTIONS],
    });
    expect(await participantsOf(t, appointmentId)).toEqual(
      expect.arrayContaining([
        { professionalId: seeded.responsible, startsAt: at(12), endsAt: at(13) },
        { professionalId: seeded.additional, startsAt: at(12), endsAt: at(13) },
      ]),
    );

    // Un segundo intento por el mismo cupo no se confirma.
    expect(await publicError(asResponsible.mutation(book, coordinated))).toStrictEqual(CONFLICT);

    // El adicional está ocupado a las 12:00 aunque no sea el responsable: no
    // puede atender otro acompañamiento a esa hora, pero sí a las 13:00. Sus
    // cupos propios son de media hora.
    const otherSlot = (hour: number) => ({
      ...slot(seeded, hour),
      endAt: at(hour) + HALF_HOUR,
      accompanimentId: seeded.otherAccompanimentId as string,
      professionalId: seeded.additional as string,
    });
    expect(await publicError(asAdditional.mutation(book, otherSlot(12)))).toStrictEqual(CONFLICT);
    await asAdditional.mutation(book, otherSlot(13));
  },
  API_TEST_TIMEOUT_MS,
);

test(
  "TI2-142 API: reagendar una atención coordinada mueve a todos sus profesionales y exige que el adicional pueda",
  async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const asStudent = t.withIdentity(identityFor("ti142-est-1"));
    const asResponsible = t.withIdentity(identityFor("ti142-pro-1"));
    const { appointmentId } = await asResponsible.mutation(
      api.presentation.appointments.bookAppointment,
      {
        ...slot(seeded, 12),
        additionalProfessionalIds: [seeded.additional as string],
        onlineSupports: [CAPTIONS],
      },
    );
    const reschedule = (hour: number) => ({ ...slot(seeded, hour), appointmentId });
    const { accompanimentId: _accompanimentId, ...toThirteen } = reschedule(13);
    const { accompanimentId: _other, ...toFifteen } = reschedule(15);

    // A las 15:00 el responsable atiende, pero el adicional no tiene agenda.
    expect(
      await publicError(
        asStudent.mutation(api.presentation.appointments.rescheduleAppointment, toFifteen),
      ),
    ).toStrictEqual(NO_AVAILABILITY);

    // A las 13:00 ambos pueden; los apoyos guardados siguen cubriendo la necesidad.
    await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, toThirteen);
    expect(await participantsOf(t, appointmentId)).toEqual(
      expect.arrayContaining([
        { professionalId: seeded.responsible, startsAt: at(13), endsAt: at(14) },
        { professionalId: seeded.additional, startsAt: at(13), endsAt: at(14) },
      ]),
    );
  },
  API_TEST_TIMEOUT_MS,
);

test(
  "TI2-142 API: el enlace privado lo agrega un profesional de la atención y solo lo leen sus participantes",
  async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const asStudent = t.withIdentity(identityFor("ti142-est-1"));
    const asResponsible = t.withIdentity(identityFor("ti142-pro-1"));
    const asAdditional = t.withIdentity(identityFor("ti142-pro-2"));
    const strangers = [
      t,
      t.withIdentity(identityFor("ti142-est-2")),
      t.withIdentity(identityFor("ti142-pro-3")),
      t.withIdentity(identityFor("ti142-int-1")),
    ];
    const get = api.presentation.appointments.getOnlineAccess;
    const set = api.presentation.appointments.setOnlineAccessLink;
    const { appointmentId } = await asResponsible.mutation(
      api.presentation.appointments.bookAppointment,
      {
        ...slot(seeded, 12),
        additionalProfessionalIds: [seeded.additional as string],
        onlineSupports: [CAPTIONS],
      },
    );
    const read = { appointmentId, version: "v1" as const };
    const notifications = async () =>
      await t.run(async (ctx) => await ctx.db.query("notificationEvents").take(10));

    // Mientras no hay enlace, los participantes ven la atención pendiente.
    for (const caller of [asStudent, asResponsible, asAdditional]) {
      expect(await caller.query(get, read)).toEqual({ status: "pending", version: "v1" });
    }
    for (const caller of strangers) {
      expect(await publicError(caller.query(get, read))).toStrictEqual(DENIED);
    }

    // Solo un profesional de la atención lo agrega, con un enlace de Meet válido.
    expect(await publicError(asStudent.mutation(set, { ...read, link: LINK }))).toStrictEqual(
      DENIED,
    );
    for (const caller of strangers) {
      expect(await publicError(caller.mutation(set, { ...read, link: LINK }))).toStrictEqual(
        DENIED,
      );
    }
    for (const link of ["http://meet.google.com/sol-casa-pan", "https://zoom.us/j/123456789"]) {
      expect(await publicError(asAdditional.mutation(set, { ...read, link }))).toStrictEqual(
        CONFLICT,
      );
    }
    expect(await notifications()).toHaveLength(0);

    await asAdditional.mutation(set, { ...read, link: `${LINK}?origen=copia` });
    expect(await asStudent.query(get, read)).toEqual({
      status: "available",
      link: LINK,
      version: "v1",
    });
    const [first] = await notifications();
    expect(first).toMatchObject({
      kind: "appointment_online_access_ready",
      appointmentId,
      recipientId: seeded.student,
    });

    // El mismo enlace no vuelve a avisar; reemplazarlo sí.
    await asResponsible.mutation(set, { ...read, link: LINK });
    expect(await notifications()).toHaveLength(1);
    await asResponsible.mutation(set, { ...read, link: OTHER_LINK });
    expect(await notifications()).toHaveLength(2);

    // Los listados de agenda nunca traen el enlace.
    const detail = await asStudent.query(api.presentation.appointments.getAppointment, {
      appointmentId,
      version: "v1",
    });
    expect(JSON.stringify(detail)).not.toContain("meet.google.com");

    // Un enlace por atención: otra atención no puede reutilizarlo.
    const other = await t
      .withIdentity(identityFor("ti142-pro-2"))
      .mutation(api.presentation.appointments.bookAppointment, {
        ...slot(seeded, 13),
        endAt: at(13) + HALF_HOUR,
        accompanimentId: seeded.otherAccompanimentId as string,
        professionalId: seeded.additional as string,
      });
    expect(
      await publicError(
        asAdditional.mutation(set, {
          appointmentId: other.appointmentId,
          link: OTHER_LINK,
          version: "v1",
        }),
      ),
    ).toStrictEqual(CONFLICT);

    // Cancelada la atención, el enlace deja de entregarse y no se cambia.
    await asStudent.mutation(api.presentation.appointments.cancelAppointment, read);
    expect(await asStudent.query(get, read)).toEqual({ status: "not_applicable", version: "v1" });
    expect(await publicError(asResponsible.mutation(set, { ...read, link: LINK }))).toStrictEqual(
      CONFLICT,
    );
  },
  API_TEST_TIMEOUT_MS,
);
