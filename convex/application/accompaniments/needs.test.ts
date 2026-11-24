import { describe, expect, test } from "vitest";
import type {
  AuthorizableAgendaAccompaniment,
  AuthorizableProfile,
  AuthorizationReader,
} from "../authorization/authorize";
import { updateAccompanimentNeeds } from "./needs";
import type { ImpactedAppointmentInput } from "../appointments/impact";

type FakeProfile = AuthorizableProfile & { readonly tokenIdentifier: string };

const student: FakeProfile = {
  _id: "user-student",
  role: "student",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-student",
};

const otherStudent: FakeProfile = {
  _id: "user-other-student",
  role: "student",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-other",
};

const professional: FakeProfile = {
  _id: "user-pro",
  role: "professional",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-pro",
};

const activeAccompaniment: AuthorizableAgendaAccompaniment = {
  _id: "acc-1",
  studentId: "user-student",
  status: "active",
};

const closedAccompaniment: AuthorizableAgendaAccompaniment = {
  _id: "acc-1",
  studentId: "user-student",
  status: "closed",
};

function fakeAuth(
  profiles: readonly FakeProfile[],
  accompaniment: AuthorizableAgendaAccompaniment | null,
): AuthorizationReader {
  return {
    findProfileByTokenIdentifier: async (token) =>
      profiles.find((p) => p.tokenIdentifier === token) ?? null,
    getProfileById: async (id) => profiles.find((p) => p._id === id) ?? null,
    getAccompaniment: async () => accompaniment,
    findActiveAssignments: async () => [],
  };
}

function memoryStore() {
  let saved: { accompanimentId: string; accessNeeds: string } | null = null;
  return {
    saved: () => saved,
    saveAccessNeeds: async (accompanimentId: string, accessNeeds: string) => {
      saved = { accompanimentId, accessNeeds };
    },
    saveVersionedAccessNeeds: async (accompanimentId: string, accessNeeds: string) => {
      saved = { accompanimentId, accessNeeds };
    },
  };
}

function noImpact() {
  return {
    future: {
      listFutureByAccompaniment: async () => ({
        complete: true as const,
        appointments: [] as readonly ImpactedAppointmentInput[],
      }),
    },
    availability: {
      listActiveBlocks: async () => ({ status: "ok" as const, data: [] }),
      listExceptions: async () => ({ status: "ok" as const, data: [] }),
      getBlock: async () => null,
      getException: async () => null,
    },
    needs: {
      findAccompanimentNeeds: async () => null,
    },
    compatibility: {
      findCompatibilitySpace: async () => null,
      listOnlineSupports: async () => [],
    },
    notifications: {
      record: async () => {},
    },
  };
}

describe("Actualización de necesidades de acceso (TI2-156)", () => {
  test("el estudiante dueño actualiza y conserva el texto recortado", async () => {
    const store = memoryStore();
    const result = await updateAccompanimentNeeds(
      fakeAuth([student], activeAccompaniment),
      store,
      {
        tokenIdentifier: "token-student",
        accompanimentId: "acc-1",
        accessNeeds: "  Sala silenciosa\n",
      },
      noImpact(),
    );
    expect(result.status).toBe("ok");
    expect(store.saved()).toEqual({ accompanimentId: "acc-1", accessNeeds: "Sala silenciosa" });
  });

  test("otro estudiante, profesional o acompañamiento ajeno se deniega", async () => {
    const store = memoryStore();
    expect(
      (
        await updateAccompanimentNeeds(
          fakeAuth([otherStudent], activeAccompaniment),
          store,
          {
            tokenIdentifier: "token-other",
            accompanimentId: "acc-1",
            accessNeeds: "Necesidad ficticia",
          },
          noImpact(),
        )
      ).status,
    ).toBe("error");
    expect(
      (
        await updateAccompanimentNeeds(
          fakeAuth([professional], activeAccompaniment),
          store,
          {
            tokenIdentifier: "token-pro",
            accompanimentId: "acc-1",
            accessNeeds: "Necesidad ficticia",
          },
          noImpact(),
        )
      ).status,
    ).toBe("error");
    expect(store.saved()).toBeNull();
  });

  test("un acompañamiento cerrado responde conflicto sin escribir", async () => {
    const store = memoryStore();
    const result = await updateAccompanimentNeeds(
      fakeAuth([student], closedAccompaniment),
      store,
      {
        tokenIdentifier: "token-student",
        accompanimentId: "acc-1",
        accessNeeds: "Necesidad ficticia",
      },
      noImpact(),
    );
    expect(result.status).toBe("error");
    expect(store.saved()).toBeNull();
  });

  test("texto vacío o demasiado largo se rechaza sin escribir", async () => {
    const store = memoryStore();
    const empty = await updateAccompanimentNeeds(
      fakeAuth([student], activeAccompaniment),
      store,
      {
        tokenIdentifier: "token-student",
        accompanimentId: "acc-1",
        accessNeeds: "   ",
      },
      noImpact(),
    );
    expect(empty.status).toBe("error");
    expect(empty.status === "error" ? empty.error.code : "").toBe("access_needs_empty");
    const tooLong = await updateAccompanimentNeeds(
      fakeAuth([student], activeAccompaniment),
      store,
      {
        tokenIdentifier: "token-student",
        accompanimentId: "acc-1",
        accessNeeds: "a".repeat(2001),
      },
      noImpact(),
    );
    expect(tooLong.status).toBe("error");
    expect(store.saved()).toBeNull();
  });

  test("una lectura truncada de futuras responde conflicto sin escribir", async () => {
    const store = memoryStore();
    const impact = {
      ...noImpact(),
      future: {
        listFutureByAccompaniment: async () => ({
          complete: false as const,
          appointments: [] as const,
        }),
      },
    };
    const result = await updateAccompanimentNeeds(
      fakeAuth([student], activeAccompaniment),
      store,
      {
        tokenIdentifier: "token-student",
        accompanimentId: "acc-1",
        accessNeeds: "Necesidad ficticia",
      },
      impact,
    );
    expect(result.status).toBe("error");
    expect(store.saved()).toBeNull();
  });
});
