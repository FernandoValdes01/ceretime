/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  AUTOMATIC_JUSTIFICATION_ACTOR,
  expireOverdueJustifications as expireOverdueJustificationsUseCase,
  type PendingJustificationRow,
} from "../application/appointments/changes";
import {
  justificationDeadlineFor,
  justificationTimelinessFor,
} from "../domain/appointments/justification_deadline";
import { AGENDA_TIME_ZONE } from "../domain/availability/availability";
import { civilDateOfInstant } from "../domain/calendar/civil_days";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Instante fijo de las pruebas: martes 15 de diciembre de 2026 a mediodía UTC. */
const NOW = Date.UTC(2026, 11, 15, 12);

/** Lunes 7 de diciembre de 2026, 10:00 en Santiago (UTC-4). */
const ABSENCE_WITH_HOLIDAY = Date.UTC(2026, 11, 7, 14);
/** Jueves 24 de diciembre de 2026, 10:00 en Santiago (cruza el año). */
const ABSENCE_YEAR_BOUNDARY = Date.UTC(2026, 11, 24, 14);
/** Viernes 18 de diciembre de 2026, 10:00 en Santiago (fines de semana). */
const ABSENCE_WEEKEND = Date.UTC(2026, 11, 18, 14);
/** Martes 24 de marzo de 2026, 10:00 en Santiago (UTC-3, antes del cambio de hora). */
const ABSENCE_BEFORE_DST = Date.UTC(2026, 2, 24, 13);
/** Lunes 30 de marzo de 2026, 10:00 en Santiago (cruza el cambio de hora de abril). */
const ABSENCE_ACROSS_DST = Date.UTC(2026, 2, 30, 13);

beforeEach(() => {
  // Solo `Date`: los temporizadores siguen reales para no detener `convex-test`.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * TI2-147: el plazo se calcula desde un solo lugar para entregar, revisar y
 * vencer. Estas aserciones usan fechas exactas: si el catálogo se vacía o se
 * quita un feriado, el `deadlineAt` cambia y la prueba falla.
 */
describe("calendario único del plazo", () => {
  test("un feriado mueve el vencimiento y la entrega dentro del plazo se acepta", () => {
    const deadline = justificationDeadlineFor(ABSENCE_WITH_HOLIDAY);

    // 8 de diciembre es feriado: el quinto día hábil es el 15, no el 14.
    expect(deadline.deadlineDate).toBe("2026-12-15");
    expect(deadline.deadlineAt).toBe(Date.UTC(2026, 11, 16, 3));
    expect(deadline.timeZone).toBe("America/Santiago");
    expect(civilDateOfInstant(deadline.deadlineAt, AGENDA_TIME_ZONE)).toBe("2026-12-16");

    // La entrega del martes 15 sigue en plazo; la del miércoles 16, no.
    expect(
      justificationTimelinessFor(ABSENCE_WITH_HOLIDAY, Date.UTC(2026, 11, 15, 16)).withinDeadline,
    ).toBe(true);
    expect(
      justificationTimelinessFor(ABSENCE_WITH_HOLIDAY, deadline.deadlineAt).withinDeadline,
    ).toBe(false);
  });

  test("los fines de semana no cuentan", () => {
    const deadline = justificationDeadlineFor(ABSENCE_WEEKEND);
    expect(deadline.deadlineDate).toBe("2026-12-28");
    expect(deadline.deadlineAt).toBe(Date.UTC(2026, 11, 29, 3));
    expect(civilDateOfInstant(deadline.deadlineAt, AGENDA_TIME_ZONE)).toBe("2026-12-29");
  });

  test("el feriado de Año Nuevo mueve el plazo que cruza de año", () => {
    const deadline = justificationDeadlineFor(ABSENCE_YEAR_BOUNDARY);
    expect(deadline.deadlineDate).toBe("2027-01-04");
    expect(deadline.deadlineAt).toBe(Date.UTC(2027, 0, 5, 3));
    expect(civilDateOfInstant(deadline.deadlineAt, AGENDA_TIME_ZONE)).toBe("2027-01-05");
  });

  test("el vencimiento respeta el cambio de hora de Chile", () => {
    // Antes del cambio: Santiago era UTC-3, así que medianoche del 1 de abril
    // son las 03:00 UTC.
    const before = justificationDeadlineFor(ABSENCE_BEFORE_DST);
    expect(before.deadlineDate).toBe("2026-03-31");
    expect(before.deadlineAt).toBe(Date.UTC(2026, 3, 1, 3));

    // Después del cambio (5 de abril): Santiago es UTC-4, medianoche del 8
    // de abril son las 04:00 UTC.
    const across = justificationDeadlineFor(ABSENCE_ACROSS_DST);
    expect(across.deadlineDate).toBe("2026-04-07");
    expect(across.deadlineAt).toBe(Date.UTC(2026, 3, 8, 4));
    expect(civilDateOfInstant(across.deadlineAt, AGENDA_TIME_ZONE)).toBe("2026-04-08");
  });
});

/** Dobles en memoria para probar el caso de uso sin Convex. */
function fakeDeps(rows: readonly PendingJustificationRow[], now: () => number) {
  const writes: { id: string; fields: { status: string } }[] = [];
  const notifications: unknown[][] = [];
  return {
    writes,
    notifications,
    deps: {
      appointments: {
        listPendingJustifications: async () => ({ rows, hasMore: false }),
      },
      persister: {
        persistAppointmentTransition: async (id: string, fields: { status: string }) => {
          writes.push({ id, fields });
        },
      },
      notifications: {
        record: async (events: readonly unknown[]) => {
          notifications.push([...events]);
        },
      },
      now,
    },
  };
}

function pendingRow(
  id: string,
  overrides: Partial<PendingJustificationRow> = {},
): PendingJustificationRow {
  return {
    id,
    studentId: "student-1",
    professionalId: "professional-1",
    status: "no_show",
    startAt: ABSENCE_WITH_HOLIDAY,
    ...overrides,
  };
}

describe("caso de uso de cierre automático", () => {
  test("cierra solo lo vencido, deja la entrega pending y avisa como la revisión manual", async () => {
    const deadline = justificationDeadlineFor(ABSENCE_WITH_HOLIDAY);
    const { deps, writes, notifications } = fakeDeps(
      [
        pendingRow("expired"),
        pendingRow("in-time", { startAt: Date.UTC(2026, 11, 12, 14) }),
        pendingRow("pending-delivery", { justificationSubmittedAt: Date.UTC(2026, 11, 14, 12) }),
        pendingRow("resolved", { status: "no_show_justified" }),
      ],
      () => deadline.deadlineAt,
    );

    const result = await expireOverdueJustificationsUseCase(deps, { limit: 10 });

    expect(result).toEqual({ expired: 1, hasMore: false });
    expect(writes).toEqual([{ id: "expired", fields: { status: "no_show_unjustified" } }]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.[0]).toMatchObject({
      kind: "appointment_justification_reviewed",
      recipientId: "student-1",
      occurredAt: deadline.deadlineAt,
    });
  });

  test("el actor del cierre automático es CERETI, no un participante", () => {
    expect(AUTOMATIC_JUSTIFICATION_ACTOR).toBe("cereti");
  });
});

/** Semilla mínima de una inasistencia pendiente en una base Convex aislada. */
async function seedAbsence(
  t: ReturnType<typeof convexTest>,
  input: {
    readonly label: string;
    readonly startsAt: number;
    readonly justificationSubmittedAt?: number;
  },
) {
  return await t.run(async (ctx) => {
    const studentId = await ctx.db.insert("users", {
      email: `${input.label}-est@alu.uct.cl`,
      fullName: "Ficticio",
      role: "student",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${input.label}-est`,
    });
    const professionalId = await ctx.db.insert("users", {
      email: `${input.label}-pro@uct.cl`,
      fullName: "Ficticio",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${input.label}-pro`,
    });
    const accompanimentId = await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "",
    });
    return await ctx.db.insert("appointments", {
      accompanimentId,
      studentId,
      professionalId,
      modality: "online",
      status: "no_show",
      startsAt: input.startsAt,
      endsAt: input.startsAt + HOUR,
      createdAt: 1,
      ...(input.justificationSubmittedAt === undefined
        ? {}
        : { justificationSubmittedAt: input.justificationSubmittedAt }),
    });
  });
}

async function appointmentStatus(
  t: ReturnType<typeof convexTest>,
  appointmentId: Id<"appointments">,
): Promise<Doc<"appointments">["status"] | undefined> {
  return (await t.run(async (ctx) => await ctx.db.get(appointmentId)))?.status;
}

describe("barrido programado con reloj adelantado", () => {
  test("no cierra justo antes del vencimiento y lo cierra en él", async () => {
    const t = convexTest(schema, modules);
    const appointmentId = await seedAbsence(t, {
      label: "boundary",
      startsAt: ABSENCE_WITH_HOLIDAY,
    });
    const deadlineAt = justificationDeadlineFor(ABSENCE_WITH_HOLIDAY).deadlineAt;

    vi.setSystemTime(deadlineAt - 1);
    const before = await t.mutation(
      internal.operations.appointments.expireOverdueJustifications,
      {},
    );
    expect(before).toEqual({ expired: 0, hasMore: false });
    expect(await appointmentStatus(t, appointmentId)).toBe("no_show");

    vi.setSystemTime(deadlineAt);
    const at = await t.mutation(internal.operations.appointments.expireOverdueJustifications, {});
    expect(at).toEqual({ expired: 1, hasMore: false });
    expect(await appointmentStatus(t, appointmentId)).toBe("no_show_unjustified");

    const events: Doc<"notificationEvents">[] = await t.run(
      async (ctx) => await ctx.db.query("notificationEvents").take(100),
    );
    expect(events).toMatchObject([
      {
        kind: "appointment_justification_reviewed",
        appointmentId,
        occurredAt: deadlineAt,
      },
    ]);

    const again = await t.mutation(
      internal.operations.appointments.expireOverdueJustifications,
      {},
    );
    expect(again).toEqual({ expired: 0, hasMore: false });
  });

  test("no cierra una inasistencia con entrega pending", async () => {
    const t = convexTest(schema, modules);
    const appointmentId = await seedAbsence(t, {
      label: "pending",
      startsAt: ABSENCE_WITH_HOLIDAY,
      justificationSubmittedAt: Date.UTC(2026, 11, 14, 12),
    });
    const deadlineAt = justificationDeadlineFor(ABSENCE_WITH_HOLIDAY).deadlineAt;

    vi.setSystemTime(deadlineAt + HOUR);
    const result = await t.mutation(
      internal.operations.appointments.expireOverdueJustifications,
      {},
    );
    expect(result).toEqual({ expired: 0, hasMore: false });
    expect(await appointmentStatus(t, appointmentId)).toBe("no_show");
  });

  test("procesa más atenciones que el lote sin fallar", async () => {
    const t = convexTest(schema, modules);
    const deadlineAt = justificationDeadlineFor(ABSENCE_WITH_HOLIDAY).deadlineAt;
    vi.setSystemTime(deadlineAt + HOUR);

    const ids: Id<"appointments">[] = [];
    for (let index = 0; index < 5; index += 1) {
      ids.push(
        await seedAbsence(t, {
          label: `batch-${index}`,
          startsAt: ABSENCE_WITH_HOLIDAY - index * DAY,
          ...(index === 0 ? { justificationSubmittedAt: Date.UTC(2026, 11, 14, 12) } : {}),
        }),
      );
    }

    const first = await t.mutation(internal.operations.appointments.expireOverdueJustifications, {
      limit: 2,
    });
    expect(first.hasMore).toBe(true);

    // Las entregas pending se dejan: se cierran las cuatro vencidas restantes.
    const second = await t.mutation(internal.operations.appointments.expireOverdueJustifications, {
      limit: 2,
    });
    const third = await t.mutation(internal.operations.appointments.expireOverdueJustifications, {
      limit: 2,
    });
    expect(first.expired + second.expired + third.expired).toBe(4);
    expect(third.hasMore).toBe(false);

    expect(await appointmentStatus(t, ids[0] as Id<"appointments">)).toBe("no_show");
    for (const id of ids.slice(1)) {
      expect(await appointmentStatus(t, id)).toBe("no_show_unjustified");
    }
  });
});
