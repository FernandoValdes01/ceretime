import { describe, expect, test } from "vitest";
import type { AppointmentAuditEvent } from "../../domain/appointments/audit";
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
import type { AppointmentAuditRecorder } from "./audit";
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
    audit: fakeAudit(),
    now: () => BOOKED_AT,
    ...overrides,
  };
}

/** Instante fijo del servidor para el evento de auditoría de la reserva. */
const BOOKED_AT = Date.UTC(2026, 9, 1, 12);

/** Puerto de auditoría en memoria: guarda lo que el caso de uso registra. */
function fakeAudit(): AppointmentAuditRecorder & { readonly events: AppointmentAuditEvent[] } {
  const events: AppointmentAuditEvent[] = [];
  return {
    events,
    recordAppointmentAudit: async (event) => {
      events.push(event);
    },
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

  test("el profesional asignado coordina la reserva en nombre del estudiante dueño (TI2-142)", async () => {
    const occupier = fakeOccupier();
    const audit = fakeAudit();
    const deps = bookingDeps(
      fakeAuth({
        profiles: [professional],
        accompaniments: [activeAccompaniment],
        assignments: [activeProfessionalAssignment()],
      }),
      { occupier, audit },
    );

    expect(await bookAppointment(deps, bookingInput({ tokenIdentifier: "token-pro" }))).toEqual({
      status: "ok",
      data: { appointmentId: "appointment-1" },
    });
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
    expect(audit.events[0]?.actorId).toBe("user-pro");
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

describe("auditoría de la reserva (TI2-128)", () => {
  test("la reserva exitosa registra un evento con actor de sesión y reloj del servidor", async () => {
    const audit = fakeAudit();
    const deps = bookingDeps(authorizedAuth(), { audit });

    expect(await bookAppointment(deps, bookingInput())).toEqual({
      status: "ok",
      data: { appointmentId: "appointment-1" },
    });
    expect(audit.events).toEqual([
      {
        action: "booked",
        actorId: "user-student",
        appointmentId: "appointment-1",
        result: "scheduled",
        occurredAt: BOOKED_AT,
      },
    ]);
  });

  test("una denegación, un conflicto de ocupación o una entrada inválida no registran evento", async () => {
    const audit = fakeAudit();
    const conflicted = fakeOccupier({
      status: "error",
      error: { code: "conflict", message: "La solicitud entra en conflicto con el estado actual." },
    });

    expect(
      await bookAppointment(
        bookingDeps(authorizedAuth(), { audit }),
        bookingInput({ tokenIdentifier: null }),
      ),
    ).toEqual(DENIED);
    expect(
      await bookAppointment(
        bookingDeps(authorizedAuth(), { audit, occupier: conflicted }),
        bookingInput(),
      ),
    ).toEqual(CONFLICT);
    expect(
      await bookAppointment(
        bookingDeps(authorizedAuth(), { audit }),
        bookingInput({ accompanimentId: " " }),
      ),
    ).toEqual(CONFLICT);
    expect(audit.events).toHaveLength(0);
  });
});

describe("coordinación con varios profesionales (TI2-142)", () => {
  const second: FakeProfile = {
    ...professional,
    _id: "user-pro-2",
    tokenIdentifier: "token-pro-2",
  };
  const third: FakeProfile = { ...professional, _id: "user-pro-3", tokenIdentifier: "token-pro-3" };
  const captions: AccessNeed = { id: "subtítulos-ficticios", label: "Subtítulos (ficticio)" };

  /** Disponibilidad por profesional: cada uno lee solo sus bloques. */
  function availabilityByProfessional(
    blocks: Readonly<Record<string, ReadonlyArray<StoredAvailabilityBlock>>>,
  ): AvailabilityReader {
    return {
      getBlock: async () => null,
      listActiveBlocks: async (professionalId) => ({
        status: "ok",
        data: blocks[professionalId] ?? [],
      }),
      getException: async () => null,
      listExceptions: async () => ({ status: "ok", data: [] }),
    };
  }

  /** Bloques en línea de 9:00 a 10:00 partidos en cupos de 30 minutos. */
  function halfHourOnlineBlocks(professionalId: string): StoredAvailabilityBlock[] {
    return dailyOnlineBlocks(professionalId).map((block) => ({
      ...block,
      id: `${block.id}-${professionalId}`,
      slotMinutes: 30,
    }));
  }

  function coordinationAuth(extraProfiles: ReadonlyArray<FakeProfile> = [second]) {
    return fakeAuth({
      profiles: [student, professional, ...extraProfiles],
      accompaniments: [activeAccompaniment],
      assignments: [
        activeProfessionalAssignment(),
        ...extraProfiles.map((profile) => activeProfessionalAssignment({ userId: profile._id })),
      ],
    });
  }

  function coordinationDeps(
    overrides: Partial<Omit<BookAppointmentDeps, "auth">> & { auth?: AuthorizationReader } = {},
  ): BookAppointmentDeps {
    const { auth, ...rest } = overrides;
    return bookingDeps(auth ?? coordinationAuth(), {
      availability: availabilityByProfessional({
        "user-pro": dailyOnlineBlocks("user-pro"),
        "user-pro-2": halfHourOnlineBlocks("user-pro-2"),
      }),
      ...rest,
    });
  }

  test("el profesional coordina con un adicional cuya agenda cubre la atención con cupos más cortos", async () => {
    const occupier = fakeOccupier();
    const result = await bookAppointment(
      coordinationDeps({ occupier }),
      bookingInput({
        tokenIdentifier: "token-pro",
        additionalProfessionalIds: [" user-pro-2 ", "user-pro"],
        onlineSupports: [captions],
      }),
    );

    expect(result).toEqual({ status: "ok", data: { appointmentId: "appointment-1" } });
    expect(occupier.calls).toEqual([
      {
        accompanimentId: "acc-1",
        studentId: "user-student",
        professionalId: "user-pro",
        modality: "online",
        startAt: SLOT_START,
        endAt: SLOT_END,
        additionalProfessionalIds: ["user-pro-2"],
        onlineSupports: [captions],
      },
    ]);
  });

  test("un profesional adicional también puede coordinar, aunque no sea el responsable", async () => {
    const occupier = fakeOccupier();
    const result = await bookAppointment(
      coordinationDeps({ occupier }),
      bookingInput({ tokenIdentifier: "token-pro-2", additionalProfessionalIds: ["user-pro-2"] }),
    );
    expect(result.status).toBe("ok");
    expect(occupier.calls[0]?.studentId).toBe("user-student");
  });

  test("el estudiante no elige profesionales adicionales ni declara apoyos", async () => {
    const occupier = fakeOccupier();
    for (const input of [
      bookingInput({ additionalProfessionalIds: ["user-pro-2"] }),
      bookingInput({ onlineSupports: [captions] }),
    ]) {
      expect(await bookAppointment(coordinationDeps({ occupier }), input)).toEqual(DENIED);
    }
    expect(occupier.calls).toHaveLength(0);
  });

  test("el profesional que coordina tiene que participar en la atención", async () => {
    const occupier = fakeOccupier();
    const result = await bookAppointment(
      coordinationDeps({ occupier, auth: coordinationAuth([second, third]) }),
      bookingInput({ tokenIdentifier: "token-pro-3", additionalProfessionalIds: ["user-pro-2"] }),
    );
    expect(result).toEqual(DENIED);
    expect(occupier.calls).toHaveLength(0);
  });

  test("un adicional vacío o más del máximo responden conflicto sin escribir", async () => {
    const occupier = fakeOccupier();
    for (const additionalProfessionalIds of [
      ["user-pro-2", " "],
      ["user-pro-2", "user-pro-3", "user-pro-4"],
    ]) {
      const result = await bookAppointment(
        coordinationDeps({ occupier }),
        bookingInput({ tokenIdentifier: "token-pro", additionalProfessionalIds }),
      );
      expect(result).toEqual(CONFLICT);
    }
    expect(occupier.calls).toHaveLength(0);
  });

  test("un adicional sin asignación activa o sin disponibilidad que cubra la atención no tiene cupo", async () => {
    const occupier = fakeOccupier();
    const notAssigned = fakeAuth({
      profiles: [student, professional, second],
      accompaniments: [activeAccompaniment],
      assignments: [activeProfessionalAssignment()],
    });
    const gapBlocks = halfHourOnlineBlocks("user-pro-2").map((block) => ({
      ...block,
      endMinute: 570,
    }));
    const inPersonOnly = dailyInPersonBlocks("user-pro-2", "space-1");

    const cases: BookAppointmentDeps[] = [
      coordinationDeps({ occupier, auth: notAssigned }),
      coordinationDeps({
        occupier,
        availability: availabilityByProfessional({
          "user-pro": dailyOnlineBlocks("user-pro"),
          "user-pro-2": gapBlocks,
        }),
      }),
      coordinationDeps({
        occupier,
        availability: availabilityByProfessional({
          "user-pro": dailyOnlineBlocks("user-pro"),
          "user-pro-2": inPersonOnly,
        }),
      }),
    ];
    for (const deps of cases) {
      const result = await bookAppointment(
        deps,
        bookingInput({ tokenIdentifier: "token-pro", additionalProfessionalIds: ["user-pro-2"] }),
      );
      expect(result).toEqual(NO_AVAILABILITY);
    }
    expect(occupier.calls).toHaveLength(0);
  });

  test("los apoyos declarados cubren las necesidades de la atención en línea", async () => {
    const occupier = fakeOccupier();
    const withNeed = { needs: fakeNeeds([captions]), occupier };

    expect(
      await bookAppointment(
        coordinationDeps(withNeed),
        bookingInput({ tokenIdentifier: "token-pro" }),
      ),
    ).toEqual(NO_AVAILABILITY);
    expect(
      await bookAppointment(
        coordinationDeps(withNeed),
        bookingInput({ tokenIdentifier: "token-pro", onlineSupports: [captions] }),
      ),
    ).toEqual({ status: "ok", data: { appointmentId: "appointment-1" } });
    expect(occupier.calls).toHaveLength(1);
  });

  test("los apoyos no se declaran en una atención presencial", async () => {
    const occupier = fakeOccupier();
    const result = await bookAppointment(
      coordinationDeps({ occupier }),
      bookingInput({
        tokenIdentifier: "token-pro",
        modality: "inPerson",
        spaceId: "space-1",
        onlineSupports: [captions],
      }),
    );
    expect(result).toEqual(CONFLICT);
    expect(occupier.calls).toHaveLength(0);
  });
});
