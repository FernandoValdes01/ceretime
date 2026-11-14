/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { FOLLOW_UP_ALREADY_CONFIRMED_MESSAGE } from "../application/follow_up/commands";
import { conflictError } from "../domain/errors/api_error";
import {
  FOLLOW_UP_CONTRACT_VERSION,
  type FollowUpAgreement,
  type FollowUpTask,
} from "../domain/follow_up/follow_up";
import * as followUpApi from "../presentation/follow_up";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const ISSUER = "https://accounts.google.com";
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const MONDAY_9H = Date.UTC(2026, 10, 9, 12);

const INTERNAL_NOTE = "Nota interna ficticia de coordinación";

/**
 * Pruebas de la API pública de seguimiento (TI2-146).
 *
 * Cada prueba usa una base Convex aislada, identidades simuladas y datos
 * ficticios. Cubren guardar y confirmar, el reintento, los guardados
 * simultáneos, el rechazo después de confirmar desde cualquier rol, las
 * denegaciones, los estados de la atención que no admiten seguimiento y las
 * claves exactas de cada vista, por atención y por acompañamiento.
 */

type TestConvex = ReturnType<typeof convexTest>;
type Role = Doc<"users">["role"];

function identityFor(subject: string) {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email: `${subject}@uct.cl`,
    name: "Ficticio",
  };
}

async function seedUser(t: TestConvex, subject: string, role: Role) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `${subject}@uct.cl`,
      fullName: "Ficticio",
      role,
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${subject}`,
    });
  });
}

async function seedAccompaniment(t: TestConvex, studentId: Id<"users">) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "",
    });
  });
}

async function seedAssignment(
  t: TestConvex,
  accompanimentId: Id<"accompaniments">,
  userId: Id<"users">,
  assignedRole: Doc<"accompanimentAssignments">["assignedRole"],
  status: Doc<"accompanimentAssignments">["status"] = "active",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("accompanimentAssignments", {
      accompanimentId,
      userId,
      assignedRole,
      status,
    });
  });
}

/**
 * Un acompañamiento activo con su Estudiante, el Profesional y el Practicante
 * asignados, un Administrador y un Profesional sin asignación.
 */
async function seedScenario(t: TestConvex, label: string) {
  const subjects = {
    professional: `ti146-pro-${label}`,
    student: `ti146-est-${label}`,
    intern: `ti146-pra-${label}`,
    admin: `ti146-adm-${label}`,
    outsider: `ti146-ext-${label}`,
  } as const;
  const professional = await seedUser(t, subjects.professional, "professional");
  const student = await seedUser(t, subjects.student, "student");
  const intern = await seedUser(t, subjects.intern, "intern");
  await seedUser(t, subjects.admin, "admin");
  await seedUser(t, subjects.outsider, "professional");
  const accompanimentId = await seedAccompaniment(t, student);
  await seedAssignment(t, accompanimentId, professional, "professional");
  await seedAssignment(t, accompanimentId, intern, "intern");
  return {
    professional,
    student,
    accompanimentId,
    as: {
      professional: t.withIdentity(identityFor(subjects.professional)),
      student: t.withIdentity(identityFor(subjects.student)),
      intern: t.withIdentity(identityFor(subjects.intern)),
      admin: t.withIdentity(identityFor(subjects.admin)),
      outsider: t.withIdentity(identityFor(subjects.outsider)),
      anonymous: t,
    },
  };
}

type Scenario = Awaited<ReturnType<typeof seedScenario>>;
type Caller = keyof Scenario["as"];

async function seedAppointment(
  t: TestConvex,
  scenario: Scenario,
  options: {
    readonly status?: Doc<"appointments">["status"];
    readonly startsAt?: number;
    readonly accompanimentId?: Id<"accompaniments">;
  } = {},
) {
  const startsAt = options.startsAt ?? MONDAY_9H;
  return await t.run(async (ctx) => {
    return await ctx.db.insert("appointments", {
      accompanimentId: options.accompanimentId ?? scenario.accompanimentId,
      studentId: scenario.student,
      professionalId: scenario.professional,
      modality: "online",
      status: options.status ?? "completed",
      startsAt,
      endsAt: startsAt + HOUR,
      createdAt: startsAt - DAY,
    });
  });
}

/** Contenido válido de un registro, con nota interna y fecha sugerida. */
function followUpContent(
  overrides: Partial<{
    agreements: FollowUpAgreement[];
    tasks: FollowUpTask[];
    nextSteps: string;
    suggestedNextAppointmentDate: string;
    internalNote: string;
  }> = {},
) {
  return {
    agreements: [{ id: "a1", description: "Recibir los apuntes en formato digital" }],
    tasks: [
      {
        id: "t1",
        description: "Enviar los apuntes de la semana",
        responsible: "professional" as const,
        status: "pending" as const,
      },
    ],
    nextSteps: "Revisar el avance en la próxima atención",
    suggestedNextAppointmentDate: "2026-11-23",
    internalNote: INTERNAL_NOTE,
    version: FOLLOW_UP_CONTRACT_VERSION,
    ...overrides,
  };
}

function save(
  scenario: Scenario,
  caller: Caller,
  appointmentId: string,
  content: ReturnType<typeof followUpContent>,
) {
  return scenario.as[caller].mutation(api.presentation.follow_up.saveFollowUpRecord, {
    appointmentId,
    ...content,
  });
}

function read(scenario: Scenario, caller: Caller, appointmentId: string) {
  return scenario.as[caller].query(api.presentation.follow_up.getFollowUpRecord, {
    appointmentId,
    version: FOLLOW_UP_CONTRACT_VERSION,
  });
}

function list(
  scenario: Scenario,
  caller: Caller,
  accompanimentId: string,
  page: { readonly limit: number; readonly cursor?: string } = { limit: 20 },
) {
  return scenario.as[caller].query(api.presentation.follow_up.listAccompanimentFollowUpRecords, {
    accompanimentId,
    ...page,
    version: FOLLOW_UP_CONTRACT_VERSION,
  });
}

/** Todas las filas de seguimiento y notas, para comprobar qué se escribió. */
async function readTables(t: TestConvex) {
  return await t.run(async (ctx) => ({
    records: await ctx.db.query("followUpRecords").take(20),
    agreements: await ctx.db.query("followUpAgreements").take(20),
    tasks: await ctx.db.query("followUpTasks").take(20),
    notes: await ctx.db.query("followUpNotes").take(20),
  }));
}

/** Datos públicos del error, sin asumir la clase concreta que envuelve Convex. */
async function publicErrorData(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    () => {
      throw new Error("Se esperaba un error público");
    },
    (error: unknown) => {
      if (error instanceof ConvexError) return error.data;
      if (typeof error === "object" && error !== null && "data" in error) {
        return (error as { readonly data?: unknown }).data;
      }
      throw error;
    },
  );
}

const UNAUTHORIZED = { code: "unauthorized", message: "No autorizado" };

function conflict(message: string) {
  return { code: "conflict", message };
}

const SHARED_KEYS = [
  "accompanimentId",
  "agreements",
  "appointmentId",
  "appointmentStatus",
  "nextSteps",
  "suggestedNextAppointmentDate",
  "tasks",
  "version",
  "view",
];

const PROFESSIONAL_KEYS = [...SHARED_KEYS, "internalNote"].sort();

const MINIMIZED_KEYS = [
  "appointmentId",
  "appointmentStatus",
  "suggestedNextAppointmentDate",
  "version",
  "view",
];

function keysOf(value: unknown): string[] {
  return Object.keys(value as Record<string, unknown>).sort();
}

// ── Guardar y confirmar ─────────────────────────────────────────────────────

describe("TI2-146 API: guardar y confirmar", () => {
  test("el Profesional asignado guarda: responde solo appointmentId y la nota queda solo en followUpNotes", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "save");
    const appointmentId = await seedAppointment(t, scenario);

    const result = await save(scenario, "professional", appointmentId, followUpContent());

    expect(result).toEqual({ appointmentId });
    expect(Object.keys(result)).toEqual(["appointmentId"]);
    const tables = await readTables(t);
    expect(tables.records).toHaveLength(1);
    expect(tables.records[0]).toMatchObject({
      appointmentId,
      authorId: scenario.professional,
      nextSteps: "Revisar el avance en la próxima atención",
      version: FOLLOW_UP_CONTRACT_VERSION,
    });
    expect(tables.records[0]).not.toHaveProperty("internalNote");
    expect(tables.agreements.map((row) => row.entryId)).toEqual(["a1"]);
    expect(tables.tasks.map((row) => row.entryId)).toEqual(["t1"]);
    expect(tables.notes).toHaveLength(1);
    expect(tables.notes[0]).toMatchObject({
      _id: tables.records[0]!.internalNoteId,
      accompanimentId: scenario.accompanimentId,
      authorId: scenario.professional,
      body: INTERNAL_NOTE,
    });
  });

  test("repetir el guardado idéntico, con otros espacios, responde lo mismo y no duplica nada", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "retry");
    const appointmentId = await seedAppointment(t, scenario);
    await save(scenario, "professional", appointmentId, followUpContent());
    const before = await readTables(t);

    const retry = await save(
      scenario,
      "professional",
      appointmentId,
      followUpContent({ nextSteps: "  Revisar el avance en la próxima atención  " }),
    );

    expect(retry).toEqual({ appointmentId });
    expect(await readTables(t)).toEqual(before);
  });

  test("tres guardados simultáneos dejan un solo registro, con una sola nota", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "concurrent");
    const appointmentId = await seedAppointment(t, scenario);

    const results = await Promise.all(
      [1, 2, 3].map(() => save(scenario, "professional", appointmentId, followUpContent())),
    );

    expect(results).toEqual([{ appointmentId }, { appointmentId }, { appointmentId }]);
    const tables = await readTables(t);
    expect(tables.records).toHaveLength(1);
    expect(tables.agreements).toHaveLength(1);
    expect(tables.tasks).toHaveLength(1);
    expect(tables.notes).toHaveLength(1);
  });

  test.each([
    ["otros acuerdos", { agreements: [{ id: "a1", description: "Otro acuerdo" }] }],
    [
      "otro estado de tarea",
      {
        tasks: [
          {
            id: "t1",
            description: "Enviar los apuntes de la semana",
            responsible: "professional" as const,
            status: "done" as const,
          },
        ],
      },
    ],
    ["otros próximos pasos", { nextSteps: "Otros próximos pasos" }],
    ["otra fecha sugerida", { suggestedNextAppointmentDate: "2026-11-30" }],
    ["otra nota interna", { internalNote: "Otra nota ficticia" }],
  ])("tras confirmar, %s responde conflict y no cambia nada", async (_label, edit) => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "edit");
    const appointmentId = await seedAppointment(t, scenario);
    await save(scenario, "professional", appointmentId, followUpContent());
    const before = await readTables(t);

    expect(
      await publicErrorData(save(scenario, "professional", appointmentId, followUpContent(edit))),
    ).toEqual(conflict(FOLLOW_UP_ALREADY_CONFIRMED_MESSAGE));
    expect(await readTables(t)).toEqual(before);
  });

  test("tras confirmar, quitar la nota o la fecha sugerida también responde conflict", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "remove");
    const appointmentId = await seedAppointment(t, scenario);
    await save(scenario, "professional", appointmentId, followUpContent());
    const before = await readTables(t);
    const { internalNote: _note, ...withoutNote } = followUpContent();
    const { suggestedNextAppointmentDate: _date, ...withoutDate } = followUpContent();

    for (const content of [withoutNote, withoutDate]) {
      expect(
        await publicErrorData(
          scenario.as.professional.mutation(api.presentation.follow_up.saveFollowUpRecord, {
            appointmentId,
            ...content,
          }),
        ),
      ).toEqual(conflict(FOLLOW_UP_ALREADY_CONFIRMED_MESSAGE));
    }
    expect(await readTables(t)).toEqual(before);
  });

  test.each(["student", "intern", "admin", "outsider", "anonymous"] as const)(
    "tras confirmar, %s no puede volver a guardar y nada cambia",
    async (caller) => {
      const t = convexTest(schema, modules);
      const scenario = await seedScenario(t, `after-${caller}`);
      const appointmentId = await seedAppointment(t, scenario);
      await save(scenario, "professional", appointmentId, followUpContent());
      const before = await readTables(t);

      expect(
        await publicErrorData(
          save(scenario, caller, appointmentId, followUpContent({ nextSteps: "Reemplazo" })),
        ),
      ).toEqual(UNAUTHORIZED);
      expect(await readTables(t)).toEqual(before);
    },
  );

  test("la API solo publica guardar y leer: no hay mutations de edición ni de eliminación", () => {
    expect(Object.keys(followUpApi).sort()).toEqual([
      "getFollowUpRecord",
      "listAccompanimentFollowUpRecords",
      "saveFollowUpRecord",
    ]);
  });
});

// ── Denegaciones y estados de la atención ──────────────────────────────────

describe("TI2-146 API: denegaciones y estados de la atención", () => {
  test.each(["student", "intern", "admin", "outsider", "anonymous"] as const)(
    "%s no guarda seguimiento y no se escribe nada",
    async (caller) => {
      const t = convexTest(schema, modules);
      const scenario = await seedScenario(t, `deny-${caller}`);
      const appointmentId = await seedAppointment(t, scenario);

      expect(
        await publicErrorData(save(scenario, caller, appointmentId, followUpContent())),
      ).toEqual(UNAUTHORIZED);
      expect(await readTables(t)).toEqual({ records: [], agreements: [], tasks: [], notes: [] });
    },
  );

  test("un Profesional con la asignación revocada no guarda ni lee", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "revoked");
    const appointmentId = await seedAppointment(t, scenario);
    await t.run(async (ctx) => {
      const assignments = await ctx.db.query("accompanimentAssignments").take(10);
      for (const assignment of assignments) {
        if (assignment.userId === scenario.professional) {
          await ctx.db.patch(assignment._id, { status: "revoked" });
        }
      }
    });

    expect(
      await publicErrorData(save(scenario, "professional", appointmentId, followUpContent())),
    ).toEqual(UNAUTHORIZED);
    expect(await publicErrorData(read(scenario, "professional", appointmentId))).toEqual(
      UNAUTHORIZED,
    );
  });

  test.each(["closed", "paused"] as const)(
    "un acompañamiento %s no admite guardar, pero su historial se sigue leyendo",
    async (status) => {
      const t = convexTest(schema, modules);
      const scenario = await seedScenario(t, `inactive-${status}`);
      const confirmed = await seedAppointment(t, scenario);
      const pending = await seedAppointment(t, scenario, { startsAt: MONDAY_9H + DAY });
      await save(scenario, "professional", confirmed, followUpContent());
      await t.run(async (ctx) => {
        await ctx.db.patch(scenario.accompanimentId, { status });
      });

      expect(
        await publicErrorData(save(scenario, "professional", pending, followUpContent())),
      ).toEqual(UNAUTHORIZED);
      expect(await read(scenario, "professional", confirmed)).toMatchObject({
        appointmentId: confirmed,
        view: "professional",
      });
    },
  );

  test("una atención inexistente, de otra tabla o sin forma responde unauthorized al guardar y al leer", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "unknown");
    const deleted = await seedAppointment(t, scenario);
    await t.run(async (ctx) => {
      await ctx.db.delete(deleted);
    });

    for (const appointmentId of [deleted, scenario.accompanimentId, "no-existe", ""]) {
      expect(
        await publicErrorData(save(scenario, "professional", appointmentId, followUpContent())),
      ).toEqual(UNAUTHORIZED);
      expect(await publicErrorData(read(scenario, "professional", appointmentId))).toEqual(
        UNAUTHORIZED,
      );
    }
  });

  test("el Profesional de otro acompañamiento no guarda ni lee la atención ajena", async () => {
    const t = convexTest(schema, modules);
    const own = await seedScenario(t, "own");
    const other = await seedScenario(t, "other");
    const foreign = await seedAppointment(t, other);
    await save(other, "professional", foreign, followUpContent());
    const before = await readTables(t);

    expect(await publicErrorData(save(own, "professional", foreign, followUpContent()))).toEqual(
      UNAUTHORIZED,
    );
    expect(await publicErrorData(read(own, "professional", foreign))).toEqual(UNAUTHORIZED);
    expect(await publicErrorData(read(own, "student", foreign))).toEqual(UNAUTHORIZED);
    expect(await readTables(t)).toEqual(before);
  });

  test.each(["scheduled", "cancelled_by_student", "cancelled_by_cereti", "rescheduled"] as const)(
    "una atención %s responde conflict con qué corregir",
    async (status) => {
      const t = convexTest(schema, modules);
      const scenario = await seedScenario(t, `status-${status}`);
      const appointmentId = await seedAppointment(t, scenario, { status });

      expect(
        await publicErrorData(save(scenario, "professional", appointmentId, followUpContent())),
      ).toEqual(
        conflict(
          "La atención todavía no admite seguimiento: debe estar realizada o con la inasistencia registrada.",
        ),
      );
      expect((await readTables(t)).records).toEqual([]);
    },
  );

  test.each(["no_show", "no_show_justified", "no_show_unjustified"] as const)(
    "una atención %s admite seguimiento",
    async (status) => {
      const t = convexTest(schema, modules);
      const scenario = await seedScenario(t, `admissible-${status}`);
      const appointmentId = await seedAppointment(t, scenario, { status });

      expect(await save(scenario, "professional", appointmentId, followUpContent())).toEqual({
        appointmentId,
      });
    },
  );

  test("un diagnóstico o una fecha inválida responden conflict con cada causa y no escriben", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "invalid");
    const appointmentId = await seedAppointment(t, scenario);

    expect(
      await publicErrorData(
        save(
          scenario,
          "professional",
          appointmentId,
          followUpContent({
            nextSteps: "Diagnóstico: dato ficticio",
            suggestedNextAppointmentDate: "2026-02-30",
          }),
        ),
      ),
    ).toEqual(
      conflict(
        "La fecha sugerida debe ser una fecha válida con formato AAAA-MM-DD. El seguimiento no admite diagnósticos, evaluaciones psicológicas ni documentos clínicos.",
      ),
    );
    expect(await readTables(t)).toEqual({ records: [], agreements: [], tasks: [], notes: [] });
  });

  test("una nota enviada vacía se rechaza: para no guardar nota se omite la clave", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "empty-note");
    const appointmentId = await seedAppointment(t, scenario);

    expect(
      await publicErrorData(
        save(scenario, "professional", appointmentId, followUpContent({ internalNote: "   " })),
      ),
    ).toEqual(
      conflict(
        "Hay textos vacíos: completa los acuerdos, las tareas, los próximos pasos y, si la incluyes, la nota interna.",
      ),
    );
    expect(await readTables(t)).toEqual({ records: [], agreements: [], tasks: [], notes: [] });
  });

  test("otra versión del contrato o un campo de más se rechazan en el borde", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "shape");
    const appointmentId = await seedAppointment(t, scenario);

    for (const forged of [{ version: "v2" }, { authorId: scenario.student }]) {
      await expect(
        scenario.as.professional.mutation(api.presentation.follow_up.saveFollowUpRecord, {
          appointmentId,
          ...followUpContent(),
          ...forged,
        } as never),
      ).rejects.toThrow("Validator error");
    }
    expect((await readTables(t)).records).toEqual([]);
  });
});

// ── Lectura por atención ────────────────────────────────────────────────────

describe("TI2-146 API: lectura por atención", () => {
  test("cada rol recibe solo las claves de su vista y la nota no llega al Estudiante ni al Practicante", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "views");
    const appointmentId = await seedAppointment(t, scenario);
    await save(scenario, "professional", appointmentId, followUpContent());

    const professional = await read(scenario, "professional", appointmentId);
    const student = await read(scenario, "student", appointmentId);
    const intern = await read(scenario, "intern", appointmentId);

    expect(keysOf(professional)).toEqual(PROFESSIONAL_KEYS);
    expect(professional).toMatchObject({
      appointmentId,
      accompanimentId: scenario.accompanimentId,
      appointmentStatus: "completed",
      internalNote: INTERNAL_NOTE,
      view: "professional",
    });
    expect(keysOf(student)).toEqual(SHARED_KEYS);
    expect(student).toMatchObject({ view: "shared" });
    expect(keysOf(intern)).toEqual(MINIMIZED_KEYS);
    expect(intern).toEqual({
      appointmentId,
      appointmentStatus: "completed",
      suggestedNextAppointmentDate: "2026-11-23",
      version: FOLLOW_UP_CONTRACT_VERSION,
      view: "minimized",
    });
    for (const response of [student, intern]) {
      expect(JSON.stringify(response)).not.toContain(INTERNAL_NOTE);
    }
  });

  test.each(["admin", "outsider", "anonymous"] as const)(
    "%s no lee el seguimiento de la atención",
    async (caller) => {
      const t = convexTest(schema, modules);
      const scenario = await seedScenario(t, `read-${caller}`);
      const appointmentId = await seedAppointment(t, scenario);
      await save(scenario, "professional", appointmentId, followUpContent());

      expect(await publicErrorData(read(scenario, caller, appointmentId))).toEqual(UNAUTHORIZED);
    },
  );

  test("sin nota ni fecha sugerida, las claves opcionales no aparecen en ninguna vista", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "optional");
    const appointmentId = await seedAppointment(t, scenario);
    const {
      internalNote: _note,
      suggestedNextAppointmentDate: _date,
      ...content
    } = followUpContent();
    await scenario.as.professional.mutation(api.presentation.follow_up.saveFollowUpRecord, {
      appointmentId,
      ...content,
    });

    const withoutOptional = (keys: string[]) =>
      keys.filter((key) => key !== "internalNote" && key !== "suggestedNextAppointmentDate");
    expect(keysOf(await read(scenario, "professional", appointmentId))).toEqual(
      withoutOptional(PROFESSIONAL_KEYS),
    );
    expect(keysOf(await read(scenario, "student", appointmentId))).toEqual(
      withoutOptional(SHARED_KEYS),
    );
    expect(keysOf(await read(scenario, "intern", appointmentId))).toEqual(
      withoutOptional(MINIMIZED_KEYS),
    );
    expect((await readTables(t)).notes).toEqual([]);
  });

  test("un registro que apunta a la nota de otro acompañamiento no entrega ese texto", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "cross-note");
    const appointmentId = await seedAppointment(t, scenario);
    await save(scenario, "professional", appointmentId, followUpContent());
    const otherAccompaniment = await seedAccompaniment(t, scenario.student);
    await t.run(async (ctx) => {
      const foreignNote = await ctx.db.insert("followUpNotes", {
        accompanimentId: otherAccompaniment,
        authorId: scenario.professional,
        body: "Nota de otro acompañamiento",
      });
      const [record] = await ctx.db.query("followUpRecords").take(1);
      await ctx.db.patch(record!._id, { internalNoteId: foreignNote });
    });

    const professional = await read(scenario, "professional", appointmentId);

    expect(professional).toMatchObject({ appointmentId, view: "professional" });
    expect(professional).not.toHaveProperty("internalNote");
  });

  test("una atención sin seguimiento responde null", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "empty");
    const appointmentId = await seedAppointment(t, scenario);

    expect(await read(scenario, "professional", appointmentId)).toBeNull();
    expect(await read(scenario, "student", appointmentId)).toBeNull();
    expect(await read(scenario, "intern", appointmentId)).toBeNull();
  });
});

// ── Historial por acompañamiento ───────────────────────────────────────────

describe("TI2-146 API: historial por acompañamiento", () => {
  test("lista solo el acompañamiento pedido, de la atención más reciente a la más antigua", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "history");
    const second = await seedAccompaniment(t, scenario.student);
    await seedAssignment(t, second, scenario.professional, "professional");
    const older = await seedAppointment(t, scenario);
    const newer = await seedAppointment(t, scenario, { startsAt: MONDAY_9H + 7 * DAY });
    const elsewhere = await seedAppointment(t, scenario, {
      accompanimentId: second,
      startsAt: MONDAY_9H + DAY,
    });
    for (const appointmentId of [older, newer, elsewhere]) {
      await save(scenario, "professional", appointmentId, followUpContent());
    }

    const first = await list(scenario, "professional", scenario.accompanimentId);
    const other = await list(scenario, "professional", second);

    expect(first.items.map((item) => item.appointmentId)).toEqual([newer, older]);
    expect(first.items.every((item) => item.view === "professional")).toBe(true);
    expect(first).toMatchObject({
      hasMore: false,
      nextCursor: null,
      version: FOLLOW_UP_CONTRACT_VERSION,
    });
    expect(other.items.map((item) => item.appointmentId)).toEqual([elsewhere]);
  });

  test("pagina atenciones: una página puede traer menos registros y el cursor recorre el resto", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "pages");
    const oldest = await seedAppointment(t, scenario);
    await seedAppointment(t, scenario, { startsAt: MONDAY_9H + DAY });
    const newest = await seedAppointment(t, scenario, { startsAt: MONDAY_9H + 2 * DAY });
    for (const appointmentId of [oldest, newest]) {
      await save(scenario, "professional", appointmentId, followUpContent());
    }

    const firstPage = await list(scenario, "professional", scenario.accompanimentId, { limit: 2 });
    expect(firstPage.items.map((item) => item.appointmentId)).toEqual([newest]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).not.toBeNull();

    const seen = firstPage.items.map((item) => item.appointmentId);
    let cursor = firstPage.nextCursor;
    for (let pages = 0; cursor !== null && pages < 5; pages++) {
      const page = await list(scenario, "professional", scenario.accompanimentId, {
        limit: 2,
        cursor,
      });
      seen.push(...page.items.map((item) => item.appointmentId));
      cursor = page.nextCursor;
    }
    expect(cursor).toBeNull();
    expect(seen).toEqual([newest, oldest]);
  });

  test("el Estudiante y el Practicante listan con las claves de su vista, sin la nota", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "list-views");
    const appointmentId = await seedAppointment(t, scenario);
    await save(scenario, "professional", appointmentId, followUpContent());

    const student = await list(scenario, "student", scenario.accompanimentId);
    const intern = await list(scenario, "intern", scenario.accompanimentId);

    expect(student.items.map(keysOf)).toEqual([SHARED_KEYS]);
    expect(intern.items.map(keysOf)).toEqual([MINIMIZED_KEYS]);
    for (const page of [student, intern]) {
      expect(keysOf(page)).toEqual(["hasMore", "items", "nextCursor", "version"]);
      expect(JSON.stringify(page)).not.toContain(INTERNAL_NOTE);
    }
  });

  test.each(["admin", "outsider", "anonymous"] as const)(
    "%s no lista el historial",
    async (caller) => {
      const t = convexTest(schema, modules);
      const scenario = await seedScenario(t, `list-${caller}`);
      await save(scenario, "professional", await seedAppointment(t, scenario), followUpContent());

      expect(await publicErrorData(list(scenario, caller, scenario.accompanimentId))).toEqual(
        UNAUTHORIZED,
      );
    },
  );

  test("un acompañamiento inexistente o de otra tabla responde unauthorized", async () => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, "list-unknown");
    const appointmentId = await seedAppointment(t, scenario);

    for (const accompanimentId of [appointmentId, "no-existe"]) {
      expect(await publicErrorData(list(scenario, "professional", accompanimentId))).toEqual(
        UNAUTHORIZED,
      );
    }
  });

  test.each([0, 21, 1.5])("un límite de %s responde conflict sin leer", async (limit) => {
    const t = convexTest(schema, modules);
    const scenario = await seedScenario(t, `limit-${limit}`);

    expect(
      await publicErrorData(list(scenario, "professional", scenario.accompanimentId, { limit })),
    ).toEqual(conflict(conflictError().message));
  });
});
