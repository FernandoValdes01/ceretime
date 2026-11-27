/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
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
 * UTC−3 ese día). El reloj se fija el viernes anterior: el reagendamiento
 * rechaza mover una atención al pasado, y con el reloj real estas pruebas
 * dejarían de pasar en cuanto llegue esa fecha. El Profesional responsable atiende en línea de 12:00 a 14:00
 * en cupos de una hora; el adicional, de 12:00 a 14:00 en cupos de media hora.
 * El acompañamiento del Estudiante no tiene necesidades de acceso: la atención
 * no guarda apoyos en línea que puedan cubrirlas (TI2-165), y la plataforma no
 * declara ninguno.
 */

const ISSUER = "https://accounts.google.com";
const at = (hour: number) => Date.UTC(2027, 0, 4, hour + 3);
const HALF_HOUR = 30 * 60_000;
const DAY = "2027-01-04";
const CAPTIONS = { id: "Subtítulos en la atención", label: "Subtítulos en la atención" };
const LINK = "https://meet.google.com/sol-casa-pan";
const OTHER_LINK = "https://meet.google.com/mar-roca-sal";

/**
 * Cada prueba recorre varias mutations con `convex-test`, y la primera del
 * archivo además carga los módulos; con la suite completa en paralelo superan
 * los 5 s por defecto, como la prueba de calendario de TI2-122.
 */
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
      accessNeeds: "",
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
    ).map(({ professionalId }) => professionalId),
  );
}

/** Inicio vigente de la atención: los participantes no copian su horario (TI2-165). */
async function startsAtOf(t: TestConvex<typeof schema>, appointmentId: string) {
  const row = await t.run(async (ctx) => await ctx.db.get(appointmentId as Id<"appointments">));
  return row?.startsAt;
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
    };

    // El Estudiante no elige profesionales adicionales.
    expect(await publicError(asStudent.mutation(book, coordinated))).toStrictEqual(DENIED);
    // La atención no recibe apoyos en línea: el MER no los guarda (TI2-165).
    const withSupports = { ...coordinated, onlineSupports: [CAPTIONS] };
    await expect(asResponsible.mutation(book, withSupports)).rejects.toThrow(/onlineSupports/);
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
    });
    expect(row).not.toHaveProperty("onlineSupports");
    expect(await participantsOf(t, appointmentId)).toEqual(
      expect.arrayContaining([seeded.responsible, seeded.additional]),
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

    // La búsqueda tampoco los ofrece: sería un cupo que la reserva rechaza.
    const search = await asAdditional.query(api.presentation.availability.searchSlots, {
      accompanimentId: seeded.otherAccompanimentId as string,
      professionalId: seeded.additional as string,
      from: DAY,
      to: DAY,
      limit: 50,
      version: "v1",
    });
    const offered = search.status === "available" ? search.items.map((item) => item.startAt) : [];
    expect(offered).not.toContain(at(12));
    expect(offered).not.toContain(at(12) + HALF_HOUR);
    expect(offered).toContain(at(13));

    await asAdditional.mutation(book, otherSlot(13));
  },
  API_TEST_TIMEOUT_MS,
);

test(
  "TI2-142 API: un adicional ya ocupado impide coordinar o reagendar la atención a esa hora",
  async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const asStudent = t.withIdentity(identityFor("ti142-est-1"));
    const asResponsible = t.withIdentity(identityFor("ti142-pro-1"));
    const asAdditional = t.withIdentity(identityFor("ti142-pro-2"));
    const book = api.presentation.appointments.bookAppointment;
    const ownSlot = (hour: number) => ({
      ...slot(seeded, hour),
      endAt: at(hour) + HALF_HOUR,
      accompanimentId: seeded.otherAccompanimentId as string,
      professionalId: seeded.additional as string,
    });
    const coordinated = (hour: number) => ({
      ...slot(seeded, hour),
      additionalProfessionalIds: [seeded.additional as string],
    });

    // El adicional ya atiende a otro Estudiante a las 12:00 como responsable.
    await asAdditional.mutation(book, ownSlot(12));

    // Al crear: el responsable y el Estudiante están libres; solo choca el adicional.
    expect(await publicError(asResponsible.mutation(book, coordinated(12)))).toStrictEqual(
      CONFLICT,
    );

    // Al mover: la atención coordinada de las 13:00 no puede pasar a las 12:00.
    const { appointmentId } = await asResponsible.mutation(book, coordinated(13));
    const { accompanimentId: _accompanimentId, ...toNoon } = { ...slot(seeded, 12), appointmentId };
    expect(
      await publicError(
        asStudent.mutation(api.presentation.appointments.rescheduleAppointment, toNoon),
      ),
    ).toStrictEqual(CONFLICT);
    expect(await participantsOf(t, appointmentId)).toEqual(
      expect.arrayContaining([seeded.responsible, seeded.additional]),
    );
    expect(await startsAtOf(t, appointmentId)).toBe(at(13));
  },
  API_TEST_TIMEOUT_MS,
);

test(
  "TI2-142 API: reagendar una atención coordinada mueve a todos sus profesionales, exige que el adicional pueda y saca al que ya no es reservable",
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

    // A las 13:00 ambos pueden.
    await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, toThirteen);
    expect(await participantsOf(t, appointmentId)).toEqual(
      expect.arrayContaining([seeded.responsible, seeded.additional]),
    );
    expect(await startsAtOf(t, appointmentId)).toBe(at(13));

    // Revocada su asignación, el adicional ya no es reservable: no impide
    // reagendar a las 15:00 y sale de la atención en el mismo cambio.
    await t.run(async (ctx) => {
      const assignments = await ctx.db
        .query("accompanimentAssignments")
        .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
          q.eq("accompanimentId", seeded.accompanimentId).eq("userId", seeded.additional),
        )
        .take(5);
      for (const assignment of assignments) {
        await ctx.db.patch(assignment._id, { status: "revoked" });
      }
    });
    await asStudent.mutation(api.presentation.appointments.rescheduleAppointment, toFifteen);
    expect(await participantsOf(t, appointmentId)).toEqual([seeded.responsible]);
    expect(await startsAtOf(t, appointmentId)).toBe(at(15));
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
      },
    );
    const read = { appointmentId, version: "v1" as const };
    // Solo los avisos del enlace: la reserva deja los suyos (TI2-150).
    const notifications = async () =>
      (await t.run(async (ctx) => await ctx.db.query("notificationEvents").take(20))).filter(
        (row) => row.kind === "appointment_online_access_ready",
      );

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

    // El mismo enlace no vuelve a avisar; reemplazarlo sí. El reloj avanza antes
    // de repetirlo: con el mismo instante, un segundo aviso tendría la misma
    // clave y no se guardaría aunque el caso de uso escribiera de nuevo.
    vi.setSystemTime(NOW + 30_000);
    await asResponsible.mutation(set, { ...read, link: LINK });
    expect(await notifications()).toHaveLength(1);
    vi.setSystemTime(NOW + 60_000);
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

    // Mientras la atención sigue vigente, el adicional está ocupado a las 12:00.
    const additionalAtNoon = {
      ...slot(seeded, 12),
      endAt: at(12) + HALF_HOUR,
      accompanimentId: seeded.otherAccompanimentId as string,
      professionalId: seeded.additional as string,
    };
    expect(
      await publicError(
        asAdditional.mutation(api.presentation.appointments.bookAppointment, additionalAtNoon),
      ),
    ).toStrictEqual(CONFLICT);

    // Cancelada la atención, el enlace deja de entregarse y no se cambia.
    await asStudent.mutation(api.presentation.appointments.cancelAppointment, {
      ...read,
      reason: "Motivo ficticio",
    });
    expect(await asStudent.query(get, read)).toEqual({ status: "not_applicable", version: "v1" });
    expect(await publicError(asResponsible.mutation(set, { ...read, link: LINK }))).toStrictEqual(
      CONFLICT,
    );

    // La cancelación también libera al adicional: su fila de participante
    // sigue, pero la atención ya no ocupa. La misma reserva ahora procede.
    await asAdditional.mutation(api.presentation.appointments.bookAppointment, additionalAtNoon);
  },
  API_TEST_TIMEOUT_MS,
);
