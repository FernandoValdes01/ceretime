import { describe, expect, test } from "vitest";
import { AVAILABILITY_CONTRACT_VERSION } from "../../domain/availability/availability";
import type { ApiResult } from "../../domain/errors/api_error";
import type { AccessNeed } from "../../domain/requests/request";
import type { CompatibilitySpace } from "../../domain/spaces/compatibility";
import type { Space } from "../../domain/spaces/space";
import type {
  AuthorizableAgendaAccompaniment,
  AuthorizableAssignment,
  AuthorizableProfile,
  AuthorizationReader,
} from "../authorization/authorize";
import type {
  AccompanimentNeedsReader,
  AvailabilityReader,
  CompatibilitySpaceSource,
  StoredAvailabilityBlock,
  StoredAvailabilityException,
} from "../availability/ports";
import type { AppointmentOccupier, OccupySlotInput, OccupySlotResult } from "./occupancy";
import { bookAppointment, type BookAppointmentDeps, type BookAppointmentInput } from "./booking";

type FakeProfile = AuthorizableProfile & { readonly tokenIdentifier: string };

const student: FakeProfile = {
  _id: "user-student",
  role: "student",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-student",
};

const otherStudent: FakeProfile = {
  _id: "user-other",
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

const inactiveProfessional: FakeProfile = {
  ...professional,
  accountStatus: "inactive",
};

const disabledProfessional: FakeProfile = {
  ...professional,
  institutionalStatus: "disabled",
};

const activeAccompaniment: AuthorizableAgendaAccompaniment = {
  _id: "acc-1",
  studentId: "user-student",
  status: "active",
};

function fakeAuth(data: {
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

function activeProfessionalAssignment(
  overrides: Partial<AuthorizableAssignment> = {},
): AuthorizableAssignment {
  return {
    accompanimentId: "acc-1",
    userId: "user-pro",
    assignedRole: "professional",
    status: "active",
    ...overrides,
  };
}

function authorizedAuth(): AuthorizationReader {
  return fakeAuth({
    profiles: [student, professional],
    accompaniments: [activeAccompaniment],
    assignments: [activeProfessionalAssignment()],
  });
}

/** Bloques en línea para cada día de la semana: cubren la fecha fija de las pruebas. */
function dailyOnlineBlocks(professionalId: string): StoredAvailabilityBlock[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    id: `block-${weekday}`,
    professionalId,
    weekday,
    startMinute: 540,
    endMinute: 600,
    slotMinutes: 60,
    modality: "online",
    isActive: true,
    version: AVAILABILITY_CONTRACT_VERSION,
  }));
}

/** Bloques presenciales para cada día de la semana, todos en la misma sala. */
function dailyInPersonBlocks(professionalId: string, spaceId: string): StoredAvailabilityBlock[] {
  return dailyOnlineBlocks(professionalId).map((block, weekday) => ({
    ...block,
    id: `block-room-${weekday}`,
    modality: "inPerson",
    spaceId,
  }));
}

function fakeAvailability(data: {
  readonly blocks?: ReadonlyArray<StoredAvailabilityBlock>;
  readonly exceptions?: ReadonlyArray<StoredAvailabilityException>;
  readonly readError?: boolean;
}): AvailabilityReader {
  const blocks = data.blocks ?? [];
  const exceptions = data.exceptions ?? [];
  return {
    getBlock: async (blockId) => blocks.find((row) => row.id === blockId) ?? null,
    listActiveBlocks: async () =>
      data.readError === true
        ? { status: "error", error: { code: "conflict", message: "Lectura truncada" } }
        : { status: "ok", data: blocks },
    getException: async (exceptionId) => exceptions.find((row) => row.id === exceptionId) ?? null,
    listExceptions: async () =>
      data.readError === true
        ? { status: "error", error: { code: "conflict", message: "Lectura truncada" } }
        : { status: "ok", data: exceptions },
  };
}

function fakeNeeds(needs: readonly AccessNeed[], exists = true): AccompanimentNeedsReader {
  return {
    findAccompanimentNeeds: async (accompanimentId) =>
      exists && accompanimentId === "acc-1" ? { _id: accompanimentId, needs } : null,
  };
}

const fictitiousSpace: Space = {
  id: "space-1",
  campus: "Campus ficticio",
  building: "Edificio ficticio",
  floor: "Piso 1",
  room: "Sala 101",
  accessConditions: "Acceso ficticio sin barreras",
  arrivalInstructions: "Instrucciones ficticias de llegada",
  version: "v1",
};

function compatibilitySpace(
  spaceId: string,
  satisfiedNeeds: readonly AccessNeed[],
  isActive = true,
): CompatibilitySpace {
  return {
    space: { ...fictitiousSpace, id: spaceId },
    isActive,
    satisfiedNeeds,
  };
}

function fakeCompatibility(data?: {
  readonly spaces?: Readonly<Record<string, CompatibilitySpace>>;
  readonly onlineSupports?: readonly AccessNeed[];
}): CompatibilitySpaceSource & { readonly onlineCalls: number } {
  const calls = { onlineCalls: 0 };
  return {
    get onlineCalls() {
      return calls.onlineCalls;
    },
    findCompatibilitySpace: async (spaceId) => data?.spaces?.[spaceId] ?? null,
    listOnlineSupports: async () => {
      calls.onlineCalls += 1;
      return data?.onlineSupports ?? [];
    },
  };
}

function fakeOccupier(
  result: OccupySlotResult = { status: "ok", data: { appointmentId: "appointment-1" } },
): AppointmentOccupier & { readonly calls: OccupySlotInput[] } {
  const calls: OccupySlotInput[] = [];
  return {
    calls,
    occupySlot: async (input) => {
      calls.push(input);
      return result;
    },
  };
}

/** Lunes 2026-10-26 09:00 UTC, dentro de los bloques diarios ficticios. */
const SLOT_START = Date.UTC(2026, 9, 26, 9);
const SLOT_END = Date.UTC(2026, 9, 26, 10);
const SLOT_DATE = "2026-10-26";

function bookingInput(overrides: Partial<BookAppointmentInput> = {}): BookAppointmentInput {
  return {
    tokenIdentifier: "token-student",
    accompanimentId: "acc-1",
    professionalId: "user-pro",
    modality: "online",
    startAt: SLOT_START,
    endAt: SLOT_END,
    timeZone: "UTC",
    ...overrides,
  };
}

function bookingDeps(
  auth: AuthorizationReader,
  overrides: Partial<Omit<BookAppointmentDeps, "auth">> = {},
): BookAppointmentDeps {
  return {
    auth,
    availability: fakeAvailability({ blocks: dailyOnlineBlocks("user-pro") }),
    needs: fakeNeeds([]),
    compatibility: fakeCompatibility(),
    occupier: fakeOccupier(),
    ...overrides,
  };
}

const DENIED = { status: "error", error: { code: "unauthorized", message: "No autorizado" } };
const CONFLICT = {
  status: "error",
  error: { code: "conflict", message: "La solicitud entra en conflicto con el estado actual." },
};
const NO_AVAILABILITY = {
  status: "error",
  error: {
    code: "no_availability",
    message: "Sin cupo disponible. Coordina por el canal oficial con la referencia indicada.",
  },
};

function requireOk<T>(result: ApiResult<T>): T {
  if (result.status !== "ok") throw new Error(`Se esperaba éxito y llegó ${result.error.code}`);
  return result.data;
}

describe("reserva de un cupo compatible (TI2-98)", () => {
  test("el estudiante dueño reserva y la atención usa su identidad de sesión", async () => {
    const occupier = fakeOccupier();
    const deps = bookingDeps(authorizedAuth(), {
      occupier,
    });

    const result = await bookAppointment(deps, bookingInput());

    expect(result).toEqual({ status: "ok", data: { appointmentId: "appointment-1" } });
    expect(occupier.calls).toEqual([
      {
        accompanimentId: "acc-1",
        studentId: "user-student",
        professionalId: "user-pro",
        modality: "online",
        startAt: SLOT_START,
        endAt: SLOT_END,
      },
    ]);
  });

  test("sin identidad, con acompañamiento ajeno o pausado no se autoriza ni se escribe", async () => {
    const occupier = fakeOccupier();
    const cases = [
      {
        auth: authorizedAuth(),
        input: bookingInput({ tokenIdentifier: null }),
      },
      {
        auth: fakeAuth({
          profiles: [otherStudent],
          accompaniments: [activeAccompaniment],
        }),
        input: bookingInput({ tokenIdentifier: "token-other" }),
      },
      {
        auth: fakeAuth({
          profiles: [student],
          accompaniments: [{ ...activeAccompaniment, status: "paused" }],
        }),
        input: bookingInput(),
      },
    ];

    for (const { auth, input } of cases) {
      const result = await bookAppointment(bookingDeps(auth, { occupier }), input);
      expect(result).toEqual(DENIED);
    }
    expect(occupier.calls).toHaveLength(0);
  });

  test("el profesional asignado no reserva por el estudiante", async () => {
    const occupier = fakeOccupier();
    const deps = bookingDeps(
      fakeAuth({
        profiles: [professional],
        accompaniments: [activeAccompaniment],
        assignments: [
          {
            accompanimentId: "acc-1",
            userId: "user-pro",
            assignedRole: "professional",
            status: "active",
          },
        ],
      }),
      { occupier },
    );

    expect(await bookAppointment(deps, bookingInput({ tokenIdentifier: "token-pro" }))).toEqual(
      DENIED,
    );
    expect(occupier.calls).toHaveLength(0);
  });

  test("un bloque retirado o una excepción cancelada dejan el cupo sin disponibilidad", async () => {
    const occupier = fakeOccupier();
    const auth = authorizedAuth();
    const withoutBlocks = bookingDeps(auth, {
      availability: fakeAvailability({ blocks: [] }),
      occupier,
    });
    const cancelled = bookingDeps(auth, {
      availability: fakeAvailability({
        blocks: dailyOnlineBlocks("user-pro"),
        exceptions: [
          {
            id: "exc-1",
            professionalId: "user-pro",
            date: SLOT_DATE,
            kind: "cancelled",
            version: AVAILABILITY_CONTRACT_VERSION,
          },
        ],
      }),
      occupier,
    });

    expect(await bookAppointment(withoutBlocks, bookingInput())).toEqual(NO_AVAILABILITY);
    expect(await bookAppointment(cancelled, bookingInput())).toEqual(NO_AVAILABILITY);
    expect(occupier.calls).toHaveLength(0);
  });

  test("un horario, modalidad o sala distintos del cupo vigente no se reservan", async () => {
    const occupier = fakeOccupier();
    const auth = authorizedAuth();
    const deps = bookingDeps(auth, { occupier });

    expect(await bookAppointment(deps, bookingInput({ startAt: SLOT_START + 1 }))).toEqual(
      NO_AVAILABILITY,
    );
    expect(
      await bookAppointment(deps, bookingInput({ modality: "inPerson", spaceId: "space-1" })),
    ).toEqual(NO_AVAILABILITY);
    expect(await bookAppointment(deps, bookingInput({ spaceId: "space-1" }))).toEqual(CONFLICT);
    expect(occupier.calls).toHaveLength(0);
  });

  test("una sala retirada o una necesidad no cubierta responde sin disponibilidad", async () => {
    const occupier = fakeOccupier();
    const auth = authorizedAuth();
    const need: AccessNeed = { id: "access-ramp", label: "Rampa de acceso" };
    const retiredSpace = bookingDeps(auth, {
      availability: fakeAvailability({ blocks: dailyInPersonBlocks("user-pro", "space-1") }),
      needs: fakeNeeds([need]),
      compatibility: fakeCompatibility({
        spaces: { "space-1": compatibilitySpace("space-1", [need], false) },
      }),
      occupier,
    });
    const unmetNeed = bookingDeps(auth, {
      needs: fakeNeeds([need]),
      compatibility: fakeCompatibility({ onlineSupports: [] }),
      occupier,
    });
    const inPersonInput = bookingInput({ modality: "inPerson", spaceId: "space-1" });

    expect(await bookAppointment(retiredSpace, inPersonInput)).toEqual(NO_AVAILABILITY);
    expect(await bookAppointment(unmetNeed, bookingInput())).toEqual(NO_AVAILABILITY);
    expect(occupier.calls).toHaveLength(0);
  });

  test("la sala vigente y los apoyos en línea que cubren las necesidades permiten reservar", async () => {
    const auth = authorizedAuth();
    const need: AccessNeed = { id: "access-ramp", label: "Rampa de acceso" };
    const inPersonOccupier = fakeOccupier();
    const inPerson = bookingDeps(auth, {
      availability: fakeAvailability({ blocks: dailyInPersonBlocks("user-pro", "space-1") }),
      needs: fakeNeeds([need]),
      compatibility: fakeCompatibility({
        spaces: { "space-1": compatibilitySpace("space-1", [need]) },
      }),
      occupier: inPersonOccupier,
    });
    const onlineOccupier = fakeOccupier();
    const online = bookingDeps(auth, {
      needs: fakeNeeds([need]),
      compatibility: fakeCompatibility({ onlineSupports: [need] }),
      occupier: onlineOccupier,
    });

    requireOk(
      await bookAppointment(inPerson, bookingInput({ modality: "inPerson", spaceId: "space-1" })),
    );
    requireOk(await bookAppointment(online, bookingInput()));
    expect(inPersonOccupier.calls[0]?.spaceId).toBe("space-1");
    expect(inPersonOccupier.calls[0]?.modality).toBe("inPerson");
    expect(onlineOccupier.calls[0]?.spaceId).toBeUndefined();
  });

  test("la contención del cupo responde conflicto sin crear una segunda atención", async () => {
    const occupier = fakeOccupier({
      status: "error",
      error: { code: "conflict", message: "La solicitud entra en conflicto con el estado actual." },
    });
    const deps = bookingDeps(authorizedAuth(), { occupier });

    expect(await bookAppointment(deps, bookingInput())).toEqual(CONFLICT);
    expect(occupier.calls).toHaveLength(1);
  });

  test("un segundo intento del mismo cupo no crea otra atención", async () => {
    const calls: OccupySlotInput[] = [];
    const occupier: AppointmentOccupier = {
      occupySlot: async (input) => {
        calls.push(input);
        return calls.length === 1
          ? { status: "ok", data: { appointmentId: "appointment-1" } }
          : {
              status: "error",
              error: {
                code: "conflict",
                message: "La solicitud entra en conflicto con el estado actual.",
              },
            };
      },
    };
    const deps = bookingDeps(authorizedAuth(), { occupier });

    expect(await bookAppointment(deps, bookingInput())).toEqual({
      status: "ok",
      data: { appointmentId: "appointment-1" },
    });
    expect(await bookAppointment(deps, bookingInput())).toEqual(CONFLICT);
    expect(calls).toHaveLength(2);
  });

  test("las lecturas truncadas y la falta de necesidades responden conflicto sin escribir", async () => {
    const occupier = fakeOccupier();
    const auth = authorizedAuth();
    const readFailure = bookingDeps(auth, {
      availability: fakeAvailability({ readError: true }),
      occupier,
    });
    const withoutNeeds = bookingDeps(auth, {
      needs: fakeNeeds([], false),
      occupier,
    });

    expect(await bookAppointment(readFailure, bookingInput())).toEqual(CONFLICT);
    expect(await bookAppointment(withoutNeeds, bookingInput())).toEqual(CONFLICT);
    expect(occupier.calls).toHaveLength(0);
  });

  test("un profesional sin asignación, revocado o con cuenta no vigente no recibe el cupo", async () => {
    const cases = [
      {
        profiles: [student, professional],
        assignments: [],
      },
      {
        profiles: [student, professional],
        assignments: [activeProfessionalAssignment({ status: "revoked" })],
      },
      {
        profiles: [student, inactiveProfessional],
        assignments: [activeProfessionalAssignment()],
      },
      {
        profiles: [student, disabledProfessional],
        assignments: [activeProfessionalAssignment()],
      },
    ];

    for (const { profiles, assignments } of cases) {
      const occupier = fakeOccupier();
      const deps = bookingDeps(
        fakeAuth({ profiles, accompaniments: [activeAccompaniment], assignments }),
        { occupier },
      );

      expect(await bookAppointment(deps, bookingInput())).toEqual(NO_AVAILABILITY);
      expect(occupier.calls).toHaveLength(0);
    }
  });

  test("una entrada inválida se rechaza antes de autorizar o escribir", async () => {
    const occupier = fakeOccupier();
    const deps = bookingDeps(authorizedAuth(), { occupier });

    expect(await bookAppointment(deps, bookingInput({ startAt: SLOT_END }))).toEqual(CONFLICT);
    expect(await bookAppointment(deps, bookingInput({ timeZone: "No/Existe" }))).toEqual(CONFLICT);
    expect(await bookAppointment(deps, bookingInput({ modality: "inPerson" }))).toEqual(CONFLICT);
    expect(occupier.calls).toHaveLength(0);
  });
});
