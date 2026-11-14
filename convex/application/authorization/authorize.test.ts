import { describe, expect, test } from "vitest";
import {
  authorizeAccompanimentRead,
  authorizeAppointmentBook,
  authorizeAppointmentCancel,
  authorizeAppointmentRead,
  authorizeFollowUpRead,
  authorizeFollowUpWrite,
  authorizeAppointmentReschedule,
  authorizeAvailabilityEdit,
  authorizeAvailabilityRead,
  authorizeInternalNoteRead,
  authorizeSpaceCatalogManage,
  authorizeSpaceCatalogRead,
  AUTHORIZATION_DENIED_MESSAGE,
  listingScopeForRole,
  type AuthorizableAgendaAccompaniment,
  type AuthorizableAppointment,
  type AuthorizableAssignment,
  type AuthorizableProfile,
  type AuthorizationReader,
} from "./authorize";

const accompaniment = { _id: "acc-1", studentId: "user-student" };
const appointment: AuthorizableAppointment = {
  _id: "appointment-1",
  accompanimentId: "acc-1",
  studentId: "user-student",
  professionalId: "user-pro",
};

function profile(overrides: Partial<AuthorizableProfile>): AuthorizableProfile {
  return {
    _id: "user-student",
    role: "student",
    institutionalStatus: "enabled",
    accountStatus: "active",
    ...overrides,
  };
}

function assignment(overrides: Partial<AuthorizableAssignment>): AuthorizableAssignment {
  return {
    accompanimentId: "acc-1",
    userId: "user-pro",
    assignedRole: "professional",
    status: "active",
    ...overrides,
  };
}

describe("authorizeAccompanimentRead", () => {
  test("asignación revocada no autoriza", () => {
    expect(
      authorizeAccompanimentRead({
        profile: profile({ _id: "user-pro", role: "professional" }),
        accompaniment,
        assignments: [assignment({ status: "revoked" })],
      }),
    ).toBe(null);
  });

  test("asignación de otro acompañamiento no autoriza", () => {
    expect(
      authorizeAccompanimentRead({
        profile: profile({ _id: "user-pro", role: "professional" }),
        accompaniment,
        assignments: [assignment({ accompanimentId: "acc-otro" })],
      }),
    ).toBe(null);
  });

  test("rol cruzado no autoriza (profesional con asignación de practicante)", () => {
    expect(
      authorizeAccompanimentRead({
        profile: profile({ _id: "user-pro", role: "professional" }),
        accompaniment,
        assignments: [assignment({ assignedRole: "intern" })],
      }),
    ).toBe(null);
  });

  test("mensaje genérico único para denegación", () => {
    expect(AUTHORIZATION_DENIED_MESSAGE).toBe("No autorizado");
  });
});

describe("authorizeInternalNoteRead", () => {
  test("revocación quita acceso a notas", () => {
    expect(
      authorizeInternalNoteRead({
        profile: profile({ _id: "user-pro", role: "professional" }),
        accompaniment,
        assignments: [assignment({ status: "revoked" })],
      }),
    ).toBe(false);
  });
});

describe("listingScopeForRole", () => {
  test("asigna alcance por rol y niega al administrador", () => {
    expect(listingScopeForRole("student")).toEqual({ kind: "owned" });
    expect(listingScopeForRole("professional")).toEqual({
      kind: "assigned",
      assignedRole: "professional",
    });
    expect(listingScopeForRole("intern")).toEqual({
      kind: "assigned",
      assignedRole: "intern",
    });
    expect(listingScopeForRole("admin")).toEqual({ kind: "denied" });
  });
});

const DENIED = {
  status: "error",
  error: { code: "unauthorized", message: "No autorizado" },
} as const;

type FakeProfile = AuthorizableProfile & { readonly tokenIdentifier: string };

const student: FakeProfile = { ...profile({}), tokenIdentifier: "token-student" };
const otherStudent: FakeProfile = {
  ...profile({ _id: "user-other" }),
  tokenIdentifier: "token-other",
};
const professional: FakeProfile = {
  ...profile({ _id: "user-pro", role: "professional" }),
  tokenIdentifier: "token-pro",
};
const intern: FakeProfile = {
  ...profile({ _id: "user-intern", role: "intern" }),
  tokenIdentifier: "token-intern",
};
const admin: FakeProfile = {
  ...profile({ _id: "user-admin", role: "admin" }),
  tokenIdentifier: "token-admin",
};

const activeAccompaniment: AuthorizableAgendaAccompaniment = { ...accompaniment, status: "active" };

/**
 * Doble en memoria del puerto, como el que pueden usar los casos de uso de
 * agenda. A propósito no filtra por vigencia: así se comprueba que una
 * asignación revocada no autoriza aunque el adaptador la devolviera.
 */
function fakeReader(data: {
  readonly profiles: ReadonlyArray<FakeProfile>;
  readonly accompaniments?: ReadonlyArray<AuthorizableAgendaAccompaniment>;
  readonly assignments?: ReadonlyArray<AuthorizableAssignment>;
}): AuthorizationReader {
  return {
    findProfileByTokenIdentifier: async (tokenIdentifier) =>
      data.profiles.find((row) => row.tokenIdentifier === tokenIdentifier) ?? null,
    getProfileById: async (userId) => data.profiles.find((row) => row._id === userId) ?? null,
    getAccompaniment: async (accompanimentId) =>
      data.accompaniments?.find((row) => row._id === accompanimentId) ?? null,
    findActiveAssignments: async (accompanimentId, userId) =>
      (data.assignments ?? []).filter(
        (row) => row.accompanimentId === accompanimentId && row.userId === userId,
      ),
  };
}

describe("authorizeAvailabilityEdit", () => {
  test("el Profesional edita su disponibilidad y el actor sale de la identidad del servidor", async () => {
    const reader = fakeReader({ profiles: [professional] });
    expect(
      await authorizeAvailabilityEdit(reader, {
        tokenIdentifier: "token-pro",
        professionalId: "user-pro",
      }),
    ).toEqual({ status: "ok", data: { callerId: "user-pro" } });
  });

  test("disponibilidad ajena, sin identidad o con otro rol se deniega", async () => {
    const reader = fakeReader({ profiles: [professional, student] });
    expect(
      await authorizeAvailabilityEdit(reader, {
        tokenIdentifier: "token-pro",
        professionalId: "user-otro-pro",
      }),
    ).toEqual(DENIED);
    expect(
      await authorizeAvailabilityEdit(reader, {
        tokenIdentifier: null,
        professionalId: "user-pro",
      }),
    ).toEqual(DENIED);
    expect(
      await authorizeAvailabilityEdit(reader, {
        tokenIdentifier: "token-student",
        professionalId: "user-student",
      }),
    ).toEqual(DENIED);
  });

  test("al crear, sin fila previa, el dueño es el Profesional que llama y otros roles se deniegan", async () => {
    const reader = fakeReader({ profiles: [professional, student] });
    expect(
      await authorizeAvailabilityEdit(reader, {
        tokenIdentifier: "token-pro",
        professionalId: null,
      }),
    ).toEqual({ status: "ok", data: { callerId: "user-pro" } });
    expect(
      await authorizeAvailabilityEdit(reader, {
        tokenIdentifier: "token-student",
        professionalId: null,
      }),
    ).toEqual(DENIED);
  });
});

describe("authorizeAvailabilityRead", () => {
  test("una asignación revocada no autoriza aunque el puerto la devuelva", async () => {
    const reader = fakeReader({
      profiles: [professional],
      accompaniments: [activeAccompaniment],
      assignments: [assignment({ status: "revoked" })],
    });
    expect(
      await authorizeAvailabilityRead(reader, {
        tokenIdentifier: "token-pro",
        accompanimentId: "acc-1",
      }),
    ).toEqual(DENIED);
  });

  test("un acompañamiento inexistente responde igual que uno ajeno", async () => {
    const reader = fakeReader({
      profiles: [student, otherStudent],
      accompaniments: [activeAccompaniment],
    });
    const missing = await authorizeAvailabilityRead(reader, {
      tokenIdentifier: "token-student",
      accompanimentId: "acc-inexistente",
    });
    const foreign = await authorizeAvailabilityRead(reader, {
      tokenIdentifier: "token-other",
      accompanimentId: "acc-1",
    });
    expect(missing).toEqual(DENIED);
    expect(foreign).toEqual(missing);
  });
});

describe("seguimiento del acompañamiento", () => {
  const request = (tokenIdentifier: string) => ({ tokenIdentifier, accompanimentId: "acc-1" });
  const professional = {
    ...student,
    _id: "user-professional",
    role: "professional" as const,
    tokenIdentifier: "token-professional",
  };
  const world = (status: "active" | "closed", assignmentStatus: "active" | "revoked") =>
    fakeReader({
      profiles: [student, professional, intern, admin],
      accompaniments: [{ ...activeAccompaniment, status }],
      assignments: [
        assignment({ userId: "user-professional", assignedRole: "professional" }),
        assignment({ userId: "user-intern", assignedRole: "intern", status: assignmentStatus }),
      ],
    });

  test("la vista sigue al rol, también con el acompañamiento cerrado", async () => {
    const reader = world("closed", "active");
    const views = [
      ["token-student", "user-student", "shared"],
      ["token-professional", "user-professional", "professional"],
      ["token-intern", "user-intern", "minimized"],
    ] as const;
    for (const [token, callerId, view] of views) {
      expect(await authorizeFollowUpRead(reader, request(token))).toEqual({
        status: "ok",
        data: { callerId, view },
      });
    }
  });

  test("revocación, Administrador e identificador inexistente reciben la misma denegación", async () => {
    const reader = world("active", "revoked");
    expect(await authorizeFollowUpRead(reader, request("token-intern"))).toEqual(DENIED);
    expect(await authorizeFollowUpRead(reader, request("token-admin"))).toEqual(DENIED);
    expect(
      await authorizeFollowUpRead(reader, {
        tokenIdentifier: "token-student",
        accompanimentId: "x",
      }),
    ).toEqual(DENIED);
  });

  test("solo el Profesional asignado escribe, y solo con el acompañamiento activo", async () => {
    const active = world("active", "active");
    expect(await authorizeFollowUpWrite(active, request("token-professional"))).toEqual({
      status: "ok",
      data: { callerId: "user-professional" },
    });
    for (const token of ["token-student", "token-intern", "token-admin"]) {
      expect(await authorizeFollowUpWrite(active, request(token))).toEqual(DENIED);
    }
    expect(
      await authorizeFollowUpWrite(world("closed", "active"), request("token-professional")),
    ).toEqual(DENIED);
  });
});

describe("authorizeAppointmentRead", () => {
  test("la vista sigue al rol y el historial de un acompañamiento cerrado se lee", async () => {
    const reader = fakeReader({
      profiles: [student, intern, admin],
      accompaniments: [{ ...activeAccompaniment, status: "closed" }],
      assignments: [assignment({ userId: "user-intern", assignedRole: "intern" })],
    });
    const request = (tokenIdentifier: string) => ({ tokenIdentifier, accompanimentId: "acc-1" });
    expect(await authorizeAppointmentRead(reader, request("token-student"))).toEqual({
      status: "ok",
      data: { callerId: "user-student", view: "shared" },
    });
    expect(await authorizeAppointmentRead(reader, request("token-intern"))).toEqual({
      status: "ok",
      data: { callerId: "user-intern", view: "minimized" },
    });
    expect(await authorizeAppointmentRead(reader, request("token-admin"))).toEqual(DENIED);
  });
});

describe("authorizeAppointmentBook", () => {
  test("el Estudiante dueño reserva y el Profesional asignado coordina, nunca con el acompañamiento pausado", async () => {
    const request = (tokenIdentifier: string) => ({ tokenIdentifier, accompanimentId: "acc-1" });
    const active = fakeReader({
      profiles: [student, professional, intern, admin],
      accompaniments: [activeAccompaniment],
      assignments: [assignment({}), assignment({ userId: "user-intern", assignedRole: "intern" })],
    });
    expect(await authorizeAppointmentBook(active, request("token-student"))).toEqual({
      status: "ok",
      data: { callerId: "user-student", actor: "student", studentId: "user-student" },
    });
    // TI2-142: el Profesional reserva en nombre del Estudiante dueño, que sale
    // del acompañamiento leído en el servidor.
    expect(await authorizeAppointmentBook(active, request("token-pro"))).toEqual({
      status: "ok",
      data: { callerId: "user-pro", actor: "professional", studentId: "user-student" },
    });
    expect(await authorizeAppointmentBook(active, request("token-intern"))).toEqual(DENIED);
    expect(await authorizeAppointmentBook(active, request("token-admin"))).toEqual(DENIED);

    const withoutAssignment = fakeReader({
      profiles: [professional],
      accompaniments: [activeAccompaniment],
      assignments: [assignment({ status: "revoked" })],
    });
    expect(await authorizeAppointmentBook(withoutAssignment, request("token-pro"))).toEqual(DENIED);

    const paused = fakeReader({
      profiles: [student, professional],
      accompaniments: [{ ...activeAccompaniment, status: "paused" }],
      assignments: [assignment({})],
    });
    expect(await authorizeAppointmentBook(paused, request("token-student"))).toEqual(DENIED);
    expect(await authorizeAppointmentBook(paused, request("token-pro"))).toEqual(DENIED);
  });
});

describe("authorizeAppointmentCancel y authorizeAppointmentReschedule", () => {
  const request = (tokenIdentifier: string | null, row: AuthorizableAppointment = appointment) => ({
    tokenIdentifier,
    appointment: row,
  });

  test("el Estudiante dueño cancela como estudiante y mueve la misma atención", async () => {
    const reader = fakeReader({
      profiles: [student],
      accompaniments: [activeAccompaniment],
    });
    expect(await authorizeAppointmentCancel(reader, request("token-student"))).toEqual({
      status: "ok",
      data: {
        callerId: "user-student",
        actor: "student",
        target: "cancelled_by_student",
      },
    });
    expect(await authorizeAppointmentReschedule(reader, request("token-student"))).toEqual({
      status: "ok",
      data: { callerId: "user-student", actor: "student" },
    });
  });

  test("el Profesional de la atención cancela como CERETI y mueve su propia fila", async () => {
    const reader = fakeReader({
      profiles: [professional],
      accompaniments: [activeAccompaniment],
      assignments: [assignment({})],
    });
    expect(await authorizeAppointmentCancel(reader, request("token-pro"))).toEqual({
      status: "ok",
      data: { callerId: "user-pro", actor: "professional", target: "cancelled_by_cereti" },
    });
    expect(await authorizeAppointmentReschedule(reader, request("token-pro"))).toEqual({
      status: "ok",
      data: { callerId: "user-pro", actor: "professional" },
    });
  });

  test("una asignación revocada, la atención de otro profesional o un acompañamiento pausado se deniegan", async () => {
    const revoked = fakeReader({
      profiles: [professional],
      accompaniments: [activeAccompaniment],
      assignments: [assignment({ status: "revoked" })],
    });
    expect(await authorizeAppointmentCancel(revoked, request("token-pro"))).toEqual(DENIED);
    expect(await authorizeAppointmentReschedule(revoked, request("token-pro"))).toEqual(DENIED);

    const assigned = fakeReader({
      profiles: [professional],
      accompaniments: [activeAccompaniment],
      assignments: [assignment({})],
    });
    const foreignAppointment = { ...appointment, professionalId: "user-pro-2" };
    expect(
      await authorizeAppointmentCancel(assigned, request("token-pro", foreignAppointment)),
    ).toEqual(DENIED);
    expect(
      await authorizeAppointmentReschedule(assigned, request("token-pro", foreignAppointment)),
    ).toEqual(DENIED);

    const paused = fakeReader({
      profiles: [student, professional],
      accompaniments: [{ ...activeAccompaniment, status: "paused" }],
      assignments: [assignment({})],
    });
    expect(await authorizeAppointmentCancel(paused, request("token-student"))).toEqual(DENIED);
    expect(await authorizeAppointmentReschedule(paused, request("token-pro"))).toEqual(DENIED);
  });

  test("otro Estudiante, Practicante, Administrador y la falta de sesión se deniegan", async () => {
    const reader = fakeReader({
      profiles: [otherStudent, intern, admin],
      accompaniments: [activeAccompaniment],
      assignments: [assignment({ userId: "user-intern", assignedRole: "intern" })],
    });
    for (const tokenIdentifier of ["token-other", "token-intern", "token-admin", null]) {
      expect(await authorizeAppointmentCancel(reader, request(tokenIdentifier))).toEqual(DENIED);
      expect(await authorizeAppointmentReschedule(reader, request(tokenIdentifier))).toEqual(
        DENIED,
      );
    }
  });

  test("la atención debe pertenecer al acompañamiento y a la identidad de la fila", async () => {
    const reader = fakeReader({
      profiles: [student, professional],
      accompaniments: [activeAccompaniment],
      assignments: [assignment({})],
    });
    const otherStudentAppointment = { ...appointment, studentId: "user-other" };
    expect(
      await authorizeAppointmentCancel(reader, request("token-student", otherStudentAppointment)),
    ).toEqual(DENIED);
    expect(
      await authorizeAppointmentReschedule(
        reader,
        request("token-student", otherStudentAppointment),
      ),
    ).toEqual(DENIED);

    const missingAccompaniment = fakeReader({ profiles: [student] });
    expect(
      await authorizeAppointmentCancel(missingAccompaniment, request("token-student")),
    ).toEqual(DENIED);
    expect(
      await authorizeAppointmentReschedule(missingAccompaniment, request("token-student")),
    ).toEqual(DENIED);
  });
});

describe("authorizeSpaceCatalogRead", () => {
  test("cualquier rol con cuenta vigente lee; sin sesión o con cuenta inactiva, no", async () => {
    const reader = fakeReader({
      profiles: [admin, intern, { ...student, accountStatus: "inactive" }],
    });
    expect(await authorizeSpaceCatalogRead(reader, { tokenIdentifier: "token-admin" })).toEqual({
      status: "ok",
      data: { callerId: "user-admin" },
    });
    expect(await authorizeSpaceCatalogRead(reader, { tokenIdentifier: "token-intern" })).toEqual({
      status: "ok",
      data: { callerId: "user-intern" },
    });
    expect(await authorizeSpaceCatalogRead(reader, { tokenIdentifier: "token-student" })).toEqual(
      DENIED,
    );
    expect(await authorizeSpaceCatalogRead(reader, { tokenIdentifier: null })).toEqual(DENIED);
  });
});

describe("authorizeSpaceCatalogManage", () => {
  test("solo administración vigente gestiona; resto denegado", async () => {
    const reader = fakeReader({ profiles: [admin, intern, student, professional] });
    expect(await authorizeSpaceCatalogManage(reader, { tokenIdentifier: "token-admin" })).toEqual({
      status: "ok",
      data: { callerId: "user-admin" },
    });
    for (const tokenIdentifier of ["token-intern", "token-student", "token-pro", null]) {
      expect(await authorizeSpaceCatalogManage(reader, { tokenIdentifier })).toEqual(DENIED);
    }
  });
});
