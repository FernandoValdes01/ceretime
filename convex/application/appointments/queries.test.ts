import { describe, expect, test } from "vitest";
import type { Appointment } from "../../domain/appointments/appointment";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
} from "../../domain/errors/api_error";
import type {
  AuthorizableAgendaAccompaniment,
  AuthorizableAssignment,
  AuthorizableProfile,
  AuthorizationReader,
} from "../authorization/authorize";
import {
  LIST_APPOINTMENTS_PAGE_LIMIT_MAX,
  getAppointment,
  listAppointments,
  type AppointmentAgendaReader,
  type AppointmentQueryDeps,
  type ListAppointmentsQuery,
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
const otherStudent = profile("student", "other");
const professional = profile("professional", "pro");
const intern = profile("intern", "intern");
const admin = profile("admin", "admin");

const accompaniment: AuthorizableAgendaAccompaniment = {
  _id: "acc-1",
  studentId: student._id,
  status: "active",
};

const secondAccompaniment: AuthorizableAgendaAccompaniment = {
  _id: "acc-2",
  studentId: student._id,
  status: "active",
};

const foreignAccompaniment: AuthorizableAgendaAccompaniment = {
  _id: "acc-foreign",
  studentId: otherStudent._id,
  status: "active",
};

function assignment(
  accompanimentId: string,
  user: FakeProfile,
  overrides: Partial<AuthorizableAssignment> = {},
): AuthorizableAssignment {
  return {
    accompanimentId,
    userId: user._id,
    assignedRole: user.role === "intern" ? "intern" : "professional",
    status: "active",
    ...overrides,
  };
}

function appointmentRow(id: string, overrides: Partial<Appointment> = {}): Appointment {
  return {
    id,
    accompanimentId: accompaniment._id,
    professionalId: professional._id,
    modality: "online",
    startAt: 1000,
    endAt: 2000,
    status: "scheduled",
    version: "v1",
    ...overrides,
  };
}

interface World {
  readonly profiles?: readonly FakeProfile[];
  readonly accompaniments?: readonly AuthorizableAgendaAccompaniment[];
  readonly assignments?: readonly AuthorizableAssignment[];
  readonly rows?: readonly Appointment[];
  readonly overCap?: boolean;
}

/** Dobles de los puertos, con registro de lo que se leyó. */
function worldDeps(world: World) {
  const log = { accompanimentReads: [] as string[], rangeReads: [] as string[] };
  const profiles = world.profiles ?? [student, otherStudent, professional, intern, admin];
  const accompaniments = world.accompaniments ?? [
    accompaniment,
    secondAccompaniment,
    foreignAccompaniment,
  ];
  const assignments = world.assignments ?? [
    assignment(accompaniment._id, professional),
    assignment(accompaniment._id, intern),
    assignment(secondAccompaniment._id, professional),
  ];
  const rows = world.rows ?? [];
  const auth: AuthorizationReader = {
    findProfileByTokenIdentifier: async (tokenIdentifier) =>
      profiles.find((row) => row.tokenIdentifier === tokenIdentifier) ?? null,
    getProfileById: async (userId) => profiles.find((row) => row._id === userId) ?? null,
    getAccompaniment: async (accompanimentId) => {
      log.accompanimentReads.push(accompanimentId);
      return accompaniments.find((row) => row._id === accompanimentId) ?? null;
    },
    findActiveAssignments: async (accompanimentId, userId) =>
      assignments.filter((row) => row.accompanimentId === accompanimentId && row.userId === userId),
  };
  const range = (name: string, data: readonly Appointment[]) => {
    log.rangeReads.push(name);
    return world.overCap === true ? errResult<typeof data>(conflictError()) : okResult(data);
  };
  const appointments: AppointmentAgendaReader = {
    listByStudent: async () => range("student", rows),
    listByProfessional: async (professionalId) =>
      range(
        "professional",
        rows.filter((row) => row.professionalId === professionalId),
      ),
    listByAccompaniment: async (accompanimentId) =>
      range(
        "accompaniment",
        rows.filter((row) => row.accompanimentId === accompanimentId),
      ),
    getAppointment: async (id) => rows.find((row) => row.id === id) ?? null,
  };
  const deps: AppointmentQueryDeps = { auth, appointments };
  return { deps, log };
}

function listInput(overrides: Partial<ListAppointmentsQuery> = {}): ListAppointmentsQuery {
  return {
    tokenIdentifier: student.tokenIdentifier,
    from: "2026-07-06",
    to: "2026-07-12",
    timeZone: "America/Santiago",
    limit: 10,
    version: "v1",
    ...overrides,
  };
}

const denied = errResult(unauthorizedError());
const conflict = errResult(conflictError());

function okIds(result: Awaited<ReturnType<typeof listAppointments>>): readonly string[] {
  if (result.status === "error") throw new Error(`Se esperaba éxito: ${result.error.code}`);
  return result.data.items.map((item) => item.id);
}

describe("agenda propia", () => {
  test("el Estudiante lee sus atenciones en vista completa", async () => {
    const { deps, log } = worldDeps({ rows: [appointmentRow("a-1"), appointmentRow("a-2")] });
    const result = await listAppointments(deps, listInput());
    expect(okIds(result)).toEqual(["a-1", "a-2"]);
    expect(log.rangeReads).toEqual(["student"]);
    expect(result.status === "ok" && result.data.items.every((item) => item.view === "full")).toBe(
      true,
    );
  });

  test("el Profesional lee las atenciones a su cargo", async () => {
    const { deps, log } = worldDeps({
      rows: [
        appointmentRow("a-1"),
        appointmentRow("a-2", { professionalId: "user-otro-profesional" }),
      ],
    });
    const result = await listAppointments(
      deps,
      listInput({ tokenIdentifier: professional.tokenIdentifier }),
    );
    expect(okIds(result)).toEqual(["a-1"]);
    expect(log.rangeReads).toEqual(["professional"]);
  });

  test("Practicante y Administrador no tienen agenda propia y no leen atenciones", async () => {
    for (const caller of [intern, admin]) {
      const { deps, log } = worldDeps({ rows: [appointmentRow("a-1")] });
      expect(
        await listAppointments(deps, listInput({ tokenIdentifier: caller.tokenIdentifier })),
      ).toEqual(denied);
      expect(log.rangeReads).toEqual([]);
    }
  });

  test("sin sesión, sin perfil o con la cuenta no vigente se deniega sin leer atenciones", async () => {
    const inactive = { ...student, accountStatus: "inactive" as const };
    const disabled = { ...student, institutionalStatus: "disabled" as const };
    const cases = [
      { tokenIdentifier: null, profiles: [student] },
      { tokenIdentifier: "token-desconocido", profiles: [student] },
      { tokenIdentifier: student.tokenIdentifier, profiles: [inactive] },
      { tokenIdentifier: student.tokenIdentifier, profiles: [disabled] },
    ];
    for (const { tokenIdentifier, profiles } of cases) {
      const { deps, log } = worldDeps({ profiles, rows: [appointmentRow("a-1")] });
      expect(await listAppointments(deps, listInput({ tokenIdentifier }))).toEqual(denied);
      expect(log.rangeReads).toEqual([]);
    }
  });

  test("omite la atención de un acompañamiento con la asignación revocada", async () => {
    const { deps } = worldDeps({
      assignments: [
        assignment(accompaniment._id, professional, { status: "revoked" }),
        assignment(secondAccompaniment._id, professional),
      ],
      rows: [
        appointmentRow("revocada"),
        appointmentRow("vigente", { accompanimentId: secondAccompaniment._id }),
      ],
    });
    expect(
      okIds(
        await listAppointments(deps, listInput({ tokenIdentifier: professional.tokenIdentifier })),
      ),
    ).toEqual(["vigente"]);
  });

  test("omite una fila cuyo acompañamiento ya no se puede leer", async () => {
    const { deps } = worldDeps({
      rows: [appointmentRow("sin-vista", { accompanimentId: "acc-inexistente" })],
    });
    expect(okIds(await listAppointments(deps, listInput()))).toEqual([]);
  });

  test("autoriza una vez por acompañamiento distinto", async () => {
    const { deps, log } = worldDeps({
      rows: [
        appointmentRow("a-1"),
        appointmentRow("a-2"),
        appointmentRow("a-3", { accompanimentId: secondAccompaniment._id }),
        appointmentRow("a-4", { accompanimentId: "acc-inexistente" }),
        appointmentRow("a-5", { accompanimentId: "acc-inexistente" }),
      ],
    });
    await listAppointments(deps, listInput());
    expect(log.accompanimentReads).toEqual([
      accompaniment._id,
      secondAccompaniment._id,
      "acc-inexistente",
    ]);
  });

  test("una agenda vacía es una página vacía", async () => {
    const { deps } = worldDeps({ rows: [] });
    expect(await listAppointments(deps, listInput())).toEqual(
      okResult({ items: [], hasMore: false, nextCursor: null, version: "v1" }),
    );
  });
});

describe("atenciones de un acompañamiento", () => {
  const rows = [
    appointmentRow("a-1", { cancelReason: "Motivo ficticio", originalStartAt: 500 }),
    appointmentRow("ajena", { accompanimentId: foreignAccompaniment._id }),
  ];
  const scoped = listInput({ accompanimentId: accompaniment._id });

  test("Estudiante dueño y Profesional asignado reciben la vista completa", async () => {
    for (const caller of [student, professional]) {
      const { deps } = worldDeps({ rows });
      const result = await listAppointments(deps, {
        ...scoped,
        tokenIdentifier: caller.tokenIdentifier,
      });
      expect(result).toEqual(
        okResult({
          items: [{ ...rows[0], view: "full" }],
          hasMore: false,
          nextCursor: null,
          version: "v1",
        }),
      );
    }
  });

  test("el Profesional asignado ve también las de otro profesional del acompañamiento", async () => {
    const { deps } = worldDeps({
      rows: [appointmentRow("a-1", { professionalId: "user-otro-profesional" })],
    });
    expect(
      okIds(
        await listAppointments(deps, {
          ...scoped,
          tokenIdentifier: professional.tokenIdentifier,
        }),
      ),
    ).toEqual(["a-1"]);
  });

  test("el Practicante asignado recibe la vista minimizada, sin vínculos ni motivos", async () => {
    const { deps } = worldDeps({ rows });
    const result = await listAppointments(deps, {
      ...scoped,
      tokenIdentifier: intern.tokenIdentifier,
    });
    expect(result).toEqual(
      okResult({
        items: [
          {
            id: "a-1",
            status: "scheduled",
            startAt: 1000,
            endAt: 2000,
            modality: "online",
            view: "minimized",
          },
        ],
        hasMore: false,
        nextCursor: null,
        version: "v1",
      }),
    );
  });

  test("quien no tiene vista se deniega sin leer atenciones", async () => {
    const cases: ReadonlyArray<{ readonly input: ListAppointmentsQuery; readonly world: World }> = [
      { input: { ...scoped, tokenIdentifier: admin.tokenIdentifier }, world: {} },
      { input: { ...scoped, tokenIdentifier: otherStudent.tokenIdentifier }, world: {} },
      { input: { ...scoped, tokenIdentifier: null }, world: {} },
      { input: { ...scoped, accompanimentId: "acc-inexistente" }, world: {} },
      { input: { ...scoped, accompanimentId: "" }, world: {} },
      {
        input: { ...scoped, tokenIdentifier: intern.tokenIdentifier },
        world: { assignments: [assignment(accompaniment._id, intern, { status: "revoked" })] },
      },
      {
        input: { ...scoped, tokenIdentifier: professional.tokenIdentifier },
        world: { assignments: [] },
      },
    ];
    for (const { input, world } of cases) {
      const { deps, log } = worldDeps({ ...world, rows });
      expect(await listAppointments(deps, input)).toEqual(denied);
      expect(log.rangeReads).toEqual([]);
    }
  });

  test("un acompañamiento pausado o cerrado se sigue leyendo", async () => {
    for (const status of ["paused", "closed"] as const) {
      const { deps } = worldDeps({
        accompaniments: [{ ...accompaniment, status }],
        rows,
      });
      expect(okIds(await listAppointments(deps, scoped))).toEqual(["a-1"]);
    }
  });
});

describe("entrada y paginación de la lista", () => {
  const rows = ["a-1", "a-2", "a-3"].map((id) => appointmentRow(id));

  test("un límite fuera de rango responde conflicto sin leer", async () => {
    for (const limit of [0, -1, 1.5, LIST_APPOINTMENTS_PAGE_LIMIT_MAX + 1]) {
      const { deps, log } = worldDeps({ rows });
      expect(await listAppointments(deps, listInput({ limit }))).toEqual(conflict);
      expect(log.rangeReads).toEqual([]);
    }
    const { deps } = worldDeps({ rows });
    expect(okIds(await listAppointments(deps, listInput({ limit: 50 })))).toHaveLength(3);
  });

  test("un rango inválido responde conflicto, aunque no haya sesión", async () => {
    const cases: Array<Partial<ListAppointmentsQuery>> = [
      { from: "2026-02-30" },
      { from: "2026-07-13" },
      { to: "2026-12-31" },
      { timeZone: "Zona/Inexistente" },
      { tokenIdentifier: null, from: "no es una fecha" },
    ];
    for (const overrides of cases) {
      const { deps, log } = worldDeps({ rows });
      expect(await listAppointments(deps, listInput(overrides))).toEqual(conflict);
      expect(log.rangeReads).toEqual([]);
    }
  });

  test("otra versión responde conflicto", async () => {
    const { deps } = worldDeps({ rows });
    const otherVersion = { ...listInput(), version: "v2" } as unknown as ListAppointmentsQuery;
    expect(await listAppointments(deps, otherVersion)).toEqual(conflict);
  });

  test("el tope del puerto responde conflicto sin lista cortada", async () => {
    const { deps } = worldDeps({ rows, overCap: true });
    expect(await listAppointments(deps, listInput())).toEqual(conflict);
    expect(
      await listAppointments(deps, {
        ...listInput({ accompanimentId: accompaniment._id }),
        tokenIdentifier: professional.tokenIdentifier,
      }),
    ).toEqual(conflict);
    expect(
      await listAppointments(deps, listInput({ tokenIdentifier: professional.tokenIdentifier })),
    ).toEqual(conflict);
  });

  test("el cursor avanza sin repetir y la última página cierra", async () => {
    const { deps } = worldDeps({ rows });
    const first = await listAppointments(deps, listInput({ limit: 2 }));
    expect(first).toMatchObject({ status: "ok", data: { hasMore: true, nextCursor: "a-2" } });
    expect(okIds(first)).toEqual(["a-1", "a-2"]);
    const last = await listAppointments(deps, listInput({ limit: 2, cursor: "a-2" }));
    expect(last).toMatchObject({ status: "ok", data: { hasMore: false, nextCursor: null } });
    expect(okIds(last)).toEqual(["a-3"]);
  });

  test("un cursor inexistente o fuera de lo visible responde conflicto", async () => {
    const { deps } = worldDeps({
      assignments: [assignment(accompaniment._id, professional, { status: "revoked" })],
      rows: [
        appointmentRow("revocada"),
        appointmentRow("vigente", { accompanimentId: secondAccompaniment._id }),
      ],
    });
    const asProfessional = { tokenIdentifier: professional.tokenIdentifier };
    expect(
      await listAppointments(deps, listInput({ ...asProfessional, cursor: "no-existe" })),
    ).toEqual(conflict);
    expect(
      await listAppointments(deps, listInput({ ...asProfessional, cursor: "revocada" })),
    ).toEqual(conflict);
  });
});

describe("detalle de una atención", () => {
  const row = appointmentRow("a-1", { spaceId: "espacio-1", modality: "inPerson" });
  const detail = { appointmentId: "a-1", version: "v1" as const };

  test("Estudiante dueño y Profesional asignado reciben la vista completa", async () => {
    for (const caller of [student, professional]) {
      const { deps } = worldDeps({ rows: [row] });
      expect(
        await getAppointment(deps, { ...detail, tokenIdentifier: caller.tokenIdentifier }),
      ).toEqual(okResult({ ...row, view: "full" }));
    }
  });

  test("el Practicante asignado recibe la vista minimizada", async () => {
    const { deps } = worldDeps({ rows: [row] });
    expect(
      await getAppointment(deps, { ...detail, tokenIdentifier: intern.tokenIdentifier }),
    ).toEqual(
      okResult({
        id: "a-1",
        status: "scheduled",
        startAt: 1000,
        endAt: 2000,
        modality: "inPerson",
        view: "minimized",
      }),
    );
  });

  test("inexistente, ajena, revocada o sin sesión responden el mismo error", async () => {
    const cases = [
      { tokenIdentifier: student.tokenIdentifier, appointmentId: "no-existe", world: {} },
      { tokenIdentifier: otherStudent.tokenIdentifier, appointmentId: "a-1", world: {} },
      { tokenIdentifier: admin.tokenIdentifier, appointmentId: "a-1", world: {} },
      { tokenIdentifier: null, appointmentId: "a-1", world: {} },
      {
        tokenIdentifier: intern.tokenIdentifier,
        appointmentId: "a-1",
        world: { assignments: [assignment(accompaniment._id, intern, { status: "revoked" })] },
      },
    ];
    for (const { tokenIdentifier, appointmentId, world } of cases) {
      const { deps } = worldDeps({ ...world, rows: [row] });
      expect(await getAppointment(deps, { tokenIdentifier, appointmentId, version: "v1" })).toEqual(
        denied,
      );
    }
  });

  test("otra versión responde conflicto", async () => {
    const { deps } = worldDeps({ rows: [row] });
    const otherVersion = {
      ...detail,
      tokenIdentifier: student.tokenIdentifier,
      version: "v2",
    } as unknown as Parameters<typeof getAppointment>[1];
    expect(await getAppointment(deps, otherVersion)).toEqual(conflict);
  });
});
