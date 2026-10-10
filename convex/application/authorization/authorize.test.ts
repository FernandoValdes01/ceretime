import { describe, expect, test } from "vitest";
import {
  authorizeAccompanimentRead,
  authorizeAppointmentBook,
  authorizeAppointmentRead,
  authorizeAvailabilityEdit,
  authorizeAvailabilityRead,
  authorizeInternalNoteRead,
  authorizeSpaceCatalogRead,
  AUTHORIZATION_DENIED_MESSAGE,
  listingScopeForRole,
  type AuthorizableAgendaAccompaniment,
  type AuthorizableAssignment,
  type AuthorizableProfile,
  type AuthorizationReader,
} from "./authorize";

const accompaniment = { _id: "acc-1", studentId: "user-student" };

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
      data: { callerId: "user-student", view: "full" },
    });
    expect(await authorizeAppointmentRead(reader, request("token-intern"))).toEqual({
      status: "ok",
      data: { callerId: "user-intern", view: "minimized" },
    });
    expect(await authorizeAppointmentRead(reader, request("token-admin"))).toEqual(DENIED);
  });
});

describe("authorizeAppointmentBook", () => {
  test("solo el Estudiante dueño reserva, y no con el acompañamiento pausado", async () => {
    const request = (tokenIdentifier: string) => ({ tokenIdentifier, accompanimentId: "acc-1" });
    const active = fakeReader({
      profiles: [student, professional],
      accompaniments: [activeAccompaniment],
      assignments: [assignment({})],
    });
    expect(await authorizeAppointmentBook(active, request("token-student"))).toEqual({
      status: "ok",
      data: { callerId: "user-student" },
    });
    expect(await authorizeAppointmentBook(active, request("token-pro"))).toEqual(DENIED);

    const paused = fakeReader({
      profiles: [student],
      accompaniments: [{ ...activeAccompaniment, status: "paused" }],
    });
    expect(await authorizeAppointmentBook(paused, request("token-student"))).toEqual(DENIED);
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
