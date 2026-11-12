import { describe, expect, test } from "vitest";
import type { AppointmentStatus } from "../../domain/appointments/appointment";
import {
  CONFLICT_ERROR_CODE,
  conflictError,
  errResult,
  unauthorizedError,
} from "../../domain/errors/api_error";
import type {
  AuthorizableAgendaAccompaniment,
  AuthorizableAssignment,
  AuthorizableProfile,
  AuthorizationReader,
} from "../authorization/authorize";
import {
  FOLLOW_UP_ALREADY_CONFIRMED_MESSAGE,
  saveFollowUpRecord,
  type FollowUpRecorder,
  type FollowUpSaveOutcome,
  type SaveFollowUpRecordCommand,
} from "./commands";
import {
  LIST_FOLLOW_UP_PAGE_LIMIT_MAX,
  getFollowUpRecord,
  listAccompanimentFollowUpRecords,
  type FollowUpQueryDeps,
  type StoredFollowUp,
} from "./queries";

type FakeProfile = AuthorizableProfile & { readonly tokenIdentifier: string };

function profile(role: FakeProfile["role"], suffix: string): FakeProfile {
  return {
    _id: `user-${suffix}`,
    role,
    institutionalStatus: "enabled",
    accountStatus: "active",
    tokenIdentifier: `token-${suffix}`,
  };
}

const student = profile("student", "student");
const professional = profile("professional", "pro");
const otherProfessional = profile("professional", "other-pro");
const intern = profile("intern", "intern");
const admin = profile("admin", "admin");

const active: AuthorizableAgendaAccompaniment = {
  _id: "acc-1",
  studentId: student._id,
  status: "active",
};
const closed: AuthorizableAgendaAccompaniment = {
  _id: "acc-closed",
  studentId: student._id,
  status: "closed",
};

function assignment(accompanimentId: string, user: FakeProfile): AuthorizableAssignment {
  return {
    accompanimentId,
    userId: user._id,
    assignedRole: user.role === "intern" ? "intern" : "professional",
    status: "active",
  };
}

const appointments = [
  { id: "apt-1", accompanimentId: active._id, status: "completed" as AppointmentStatus },
  { id: "apt-closed", accompanimentId: closed._id, status: "completed" as AppointmentStatus },
];

const auth: AuthorizationReader = {
  findProfileByTokenIdentifier: async (tokenIdentifier) =>
    [student, professional, otherProfessional, intern, admin].find(
      (row) => row.tokenIdentifier === tokenIdentifier,
    ) ?? null,
  getProfileById: async () => null,
  getAccompaniment: async (accompanimentId) =>
    [active, closed].find((row) => row._id === accompanimentId) ?? null,
  findActiveAssignments: async (accompanimentId, userId) =>
    [
      assignment(active._id, professional),
      assignment(active._id, intern),
      assignment(closed._id, professional),
    ].filter((row) => row.accompanimentId === accompanimentId && row.userId === userId),
};

const appointmentReader = {
  getAppointment: async (id: string) => appointments.find((row) => row.id === id) ?? null,
};

const content = {
  agreements: [{ id: "acuerdo-1", description: "Continuar con el material accesible." }],
  tasks: [
    {
      id: "tarea-1",
      description: "Enviar el material en formato accesible.",
      responsible: "professional",
      status: "pending",
    },
  ],
  nextSteps: "Revisar el avance en la próxima atención.",
  suggestedNextAppointmentDate: "2026-11-20",
  internalNote: "Nota interna ficticia.",
};

function command(overrides: Partial<SaveFollowUpRecordCommand> = {}): SaveFollowUpRecordCommand {
  return {
    tokenIdentifier: professional.tokenIdentifier,
    appointmentId: "apt-1",
    ...content,
    ...overrides,
  };
}

/** Doble del guardado que registra lo que recibió y responde lo indicado. */
function recorderReturning(outcome: FollowUpSaveOutcome) {
  const calls: Parameters<FollowUpRecorder["save"]>[0][] = [];
  const recorder: FollowUpRecorder = {
    save: async (input) => {
      calls.push(input);
      return outcome;
    },
  };
  return { recorder, calls };
}

const denied = errResult(unauthorizedError());

describe("saveFollowUpRecord (TI2-146)", () => {
  test("el Profesional asignado guarda: acompañamiento de la atención y autor de la sesión", async () => {
    const { recorder, calls } = recorderReturning({ status: "saved" });
    const result = await saveFollowUpRecord(
      { auth, appointments: appointmentReader, recorder },
      command(),
    );
    expect(result).toEqual({ status: "ok", data: { appointmentId: "apt-1" } });
    expect(calls).toEqual([
      {
        ...content,
        appointmentId: "apt-1",
        accompanimentId: active._id,
        authorId: professional._id,
      },
    ]);
  });

  test.each([
    ["Estudiante dueño", student.tokenIdentifier],
    ["Practicante asignado", intern.tokenIdentifier],
    ["Administrador", admin.tokenIdentifier],
    ["Profesional sin asignación", otherProfessional.tokenIdentifier],
    ["sin sesión", null],
  ])("%s no escribe", async (_label, tokenIdentifier) => {
    const { recorder, calls } = recorderReturning({ status: "saved" });
    const result = await saveFollowUpRecord(
      { auth, appointments: appointmentReader, recorder },
      command({ tokenIdentifier }),
    );
    expect(result).toEqual(denied);
    expect(calls).toEqual([]);
  });

  test("con el acompañamiento cerrado no se escribe", async () => {
    const { recorder, calls } = recorderReturning({ status: "saved" });
    const result = await saveFollowUpRecord(
      { auth, appointments: appointmentReader, recorder },
      command({ appointmentId: "apt-closed" }),
    );
    expect(result).toEqual(denied);
    expect(calls).toEqual([]);
  });

  test("una atención inexistente responde igual que una ajena", async () => {
    const { recorder, calls } = recorderReturning({ status: "saved" });
    const result = await saveFollowUpRecord(
      { auth, appointments: appointmentReader, recorder },
      command({ appointmentId: "apt-inexistente" }),
    );
    expect(result).toEqual(denied);
    expect(calls).toEqual([]);
  });

  test("el registro ya confirmado con otro contenido responde conflict con su mensaje", async () => {
    const { recorder } = recorderReturning({ status: "already_confirmed" });
    expect(
      await saveFollowUpRecord({ auth, appointments: appointmentReader, recorder }, command()),
    ).toEqual(
      errResult({ code: CONFLICT_ERROR_CODE, message: FOLLOW_UP_ALREADY_CONFIRMED_MESSAGE }),
    );
  });

  test("los datos inválidos responden conflict con qué corregir, en el orden de las causas", async () => {
    const { recorder } = recorderReturning({
      status: "invalid",
      causes: ["follow_up_not_admissible", "clinical_content_not_allowed"],
    });
    const result = await saveFollowUpRecord(
      { auth, appointments: appointmentReader, recorder },
      command(),
    );
    expect(result).toEqual(
      errResult({
        code: CONFLICT_ERROR_CODE,
        message:
          "La atención todavía no admite seguimiento: debe estar realizada o con la inasistencia registrada. El seguimiento no admite diagnósticos, evaluaciones psicológicas ni documentos clínicos.",
      }),
    );
  });

  test("una referencia que no corresponde se responde como acceso denegado", async () => {
    const { recorder } = recorderReturning({ status: "invalid_reference" });
    expect(
      await saveFollowUpRecord({ auth, appointments: appointmentReader, recorder }, command()),
    ).toEqual(denied);
  });
});

const stored: StoredFollowUp = {
  record: {
    appointmentId: "apt-1",
    accompanimentId: active._id,
    agreements: content.agreements,
    tasks: [{ ...content.tasks[0], responsible: "professional", status: "pending" }],
    nextSteps: content.nextSteps,
    suggestedNextAppointmentDate: content.suggestedNextAppointmentDate,
    version: "v1",
  },
  appointmentStatus: "completed",
  internalNoteId: "note-1",
};

/** Doble de lectura con registro de las notas pedidas. */
function queryDeps(records: readonly StoredFollowUp[] = [stored]) {
  const noteReads: string[][] = [];
  const pageReads: { limit: number; cursor: string | null }[] = [];
  const deps: FollowUpQueryDeps = {
    auth,
    appointments: appointmentReader,
    followUp: {
      findByAppointment: async (appointmentId) =>
        records.find((row) => row.record.appointmentId === appointmentId) ?? null,
      listByAccompaniment: async (accompanimentId, page) => {
        pageReads.push({ ...page });
        return {
          items: records.filter((row) => row.record.accompanimentId === accompanimentId),
          hasMore: false,
          nextCursor: null,
        };
      },
      readInternalNote: async (noteId, accompanimentId) => {
        noteReads.push([noteId, accompanimentId]);
        return noteId === "note-1" && accompanimentId === active._id ? content.internalNote : null;
      },
    },
  };
  return { deps, noteReads, pageReads };
}

describe("getFollowUpRecord (TI2-146)", () => {
  test("el Profesional asignado recibe la nota, leída de followUpNotes", async () => {
    const { deps, noteReads } = queryDeps();
    const result = await getFollowUpRecord(deps, {
      tokenIdentifier: professional.tokenIdentifier,
      appointmentId: "apt-1",
    });
    expect(result).toMatchObject({
      status: "ok",
      data: { view: "professional", internalNote: content.internalNote },
    });
    expect(noteReads).toEqual([["note-1", active._id]]);
  });

  test("el Estudiante y el Practicante reciben su vista sin que se lea la nota", async () => {
    const { deps, noteReads } = queryDeps();
    const shared = await getFollowUpRecord(deps, {
      tokenIdentifier: student.tokenIdentifier,
      appointmentId: "apt-1",
    });
    const minimized = await getFollowUpRecord(deps, {
      tokenIdentifier: intern.tokenIdentifier,
      appointmentId: "apt-1",
    });
    expect(shared).toMatchObject({ status: "ok", data: { view: "shared" } });
    expect(minimized).toMatchObject({ status: "ok", data: { view: "minimized" } });
    expect(JSON.stringify([shared, minimized])).not.toContain(content.internalNote);
    expect(noteReads).toEqual([]);
  });

  test("sin registro todavía responde null", async () => {
    const { deps } = queryDeps([]);
    expect(
      await getFollowUpRecord(deps, {
        tokenIdentifier: student.tokenIdentifier,
        appointmentId: "apt-1",
      }),
    ).toEqual({ status: "ok", data: null });
  });

  test.each([
    ["Administrador", admin.tokenIdentifier, "apt-1"],
    ["Profesional sin asignación", otherProfessional.tokenIdentifier, "apt-1"],
    ["atención inexistente", professional.tokenIdentifier, "apt-inexistente"],
  ])("%s: unauthorized", async (_label, tokenIdentifier, appointmentId) => {
    const { deps } = queryDeps();
    expect(await getFollowUpRecord(deps, { tokenIdentifier, appointmentId })).toEqual(denied);
  });
});

describe("listAccompanimentFollowUpRecords (TI2-146)", () => {
  test("entrega los registros del acompañamiento con la vista del rol", async () => {
    const { deps, pageReads } = queryDeps();
    const result = await listAccompanimentFollowUpRecords(deps, {
      tokenIdentifier: student.tokenIdentifier,
      accompanimentId: active._id,
      limit: 5,
    });
    expect(result).toMatchObject({
      status: "ok",
      data: { items: [{ view: "shared", appointmentId: "apt-1" }], hasMore: false, version: "v1" },
    });
    expect(pageReads).toEqual([{ limit: 5, cursor: null }]);
  });

  test.each([0, LIST_FOLLOW_UP_PAGE_LIMIT_MAX + 1, 2.5])(
    "un límite %s se rechaza sin leer",
    async (limit) => {
      const { deps, pageReads } = queryDeps();
      expect(
        await listAccompanimentFollowUpRecords(deps, {
          tokenIdentifier: student.tokenIdentifier,
          accompanimentId: active._id,
          limit,
        }),
      ).toEqual(errResult(conflictError()));
      expect(pageReads).toEqual([]);
    },
  );

  test("sin acceso al acompañamiento no se lee la página", async () => {
    const { deps, pageReads } = queryDeps();
    expect(
      await listAccompanimentFollowUpRecords(deps, {
        tokenIdentifier: admin.tokenIdentifier,
        accompanimentId: active._id,
        limit: 5,
      }),
    ).toEqual(denied);
    expect(pageReads).toEqual([]);
  });
});
