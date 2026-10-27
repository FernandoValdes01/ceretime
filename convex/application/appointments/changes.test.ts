import { describe, expect, test } from "vitest";
import { AVAILABILITY_CONTRACT_VERSION } from "../../domain/availability/availability";
import type { ApiResult } from "../../domain/errors/api_error";
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
} from "../availability/ports";
import {
  cancelAppointment,
  rescheduleAppointment,
  type AppointmentChangeReader,
  type AppointmentTransitionPersister,
  type CancelAppointmentDeps,
  type RescheduleAppointmentDeps,
  type StoredAppointmentForChange,
} from "./changes";
import type { AppointmentOccupier, OccupySlotInput, OccupySlotResult } from "./occupancy";

/**
 * Pruebas de los casos de uso de cancelación y reagendamiento (TI2-109).
 *
 * Todo se prueba con dobles en memoria: no se toca Convex ni el repositorio
 * de TI2-107. El reloj se inyecta con un instante fijo para que las reglas
 * temporales del dominio no dependan del reloj de la máquina.
 */

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

const otherProfessional: FakeProfile = {
  _id: "user-pro-2",
  role: "professional",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-pro-2",
};

const intern: FakeProfile = {
  _id: "user-intern",
  role: "intern",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-intern",
};

const admin: FakeProfile = {
  _id: "user-admin",
  role: "admin",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-admin",
};

const activeAccompaniment: AuthorizableAgendaAccompaniment = {
  _id: "acc-1",
  studentId: "user-student",
  status: "active",
};

function assignment(overrides: Partial<AuthorizableAssignment>): AuthorizableAssignment {
  return {
    accompanimentId: "acc-1",
    userId: "user-pro",
    assignedRole: "professional",
    status: "active",
    ...overrides,
  };
}

function fakeAuth(data?: {
  readonly profiles?: ReadonlyArray<FakeProfile>;
  readonly accompaniments?: ReadonlyArray<AuthorizableAgendaAccompaniment>;
  readonly assignments?: ReadonlyArray<AuthorizableAssignment>;
}): AuthorizationReader {
  return {
    findProfileByTokenIdentifier: async (tokenIdentifier) =>
      (data?.profiles ?? []).find((row) => row.tokenIdentifier === tokenIdentifier) ?? null,
    getProfileById: async (userId) =>
      (data?.profiles ?? []).find((row) => row._id === userId) ?? null,
    getAccompaniment: async (accompanimentId) =>
      (data?.accompaniments ?? []).find((row) => row._id === accompanimentId) ?? null,
    findActiveAssignments: async (accompanimentId, userId) =>
      (data?.assignments ?? []).filter(
        (row) => row.accompanimentId === accompanimentId && row.userId === userId,
      ),
  };
}

function authorizedAuth(): AuthorizationReader {
  return fakeAuth({
    profiles: [student, otherStudent, professional, otherProfessional, intern, admin],
    accompaniments: [activeAccompaniment],
    assignments: [
      assignment({}),
      assignment({ userId: "user-pro-2" }),
      assignment({ userId: "user-intern", assignedRole: "intern" }),
    ],
  });
}

/** Bloques en línea de 13:00 a 14:00 para cada día de la semana. */
function dailyOnlineBlocks(professionalId: string): StoredAvailabilityBlock[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    id: `block-${professionalId}-${weekday}`,
    professionalId,
    weekday,
    startMinute: 780,
    endMinute: 840,
    slotMinutes: 60,
    modality: "online",
    isActive: true,
    version: AVAILABILITY_CONTRACT_VERSION,
  }));
}

function fakeAvailability(blocks: ReadonlyArray<StoredAvailabilityBlock>): AvailabilityReader {
  return {
    getBlock: async (blockId) => blocks.find((row) => row.id === blockId) ?? null,
    listActiveBlocks: async (professionalId) => ({
      status: "ok",
      data: blocks.filter((row) => row.professionalId === professionalId),
    }),
    getException: async () => null,
    listExceptions: async () => ({ status: "ok", data: [] }),
  };
}

const noNeeds: AccompanimentNeedsReader = {
  findAccompanimentNeeds: async (accompanimentId) =>
    accompanimentId === "acc-1" ? { _id: accompanimentId, needs: [] } : null,
};

const noCompatibility: CompatibilitySpaceSource = {
  findCompatibilitySpace: async () => null,
  listOnlineSupports: async () => [],
};

/** Lunes 2026-10-26 12:00 UTC: instante fijo de las pruebas. */
const NOW = Date.UTC(2026, 9, 26, 12);

/** Inicio y fin vigentes antes del cambio, a las 09:00 UTC del mismo día. */
const CURRENT_START = Date.UTC(2026, 9, 26, 9);
const CURRENT_END = Date.UTC(2026, 9, 26, 10);

/** Primer destino: mismo día a las 13:00 UTC, después del instante fijo. */
const FIRST_TARGET_START = Date.UTC(2026, 9, 26, 13);
const FIRST_TARGET_END = Date.UTC(2026, 9, 26, 14);

/** Segundo destino: día siguiente a las 13:00 UTC. */
const SECOND_TARGET_START = Date.UTC(2026, 9, 27, 13);
const SECOND_TARGET_END = Date.UTC(2026, 9, 27, 14);

type WorldRow = {
  -readonly [Field in keyof StoredAppointmentForChange]: StoredAppointmentForChange[Field];
};

interface ChangeWorld {
  readonly row: WorldRow;
  readonly reader: AppointmentChangeReader;
  readonly persister: AppointmentTransitionPersister;
  readonly transitions: Array<{
    readonly appointmentId: string;
    readonly fields: Parameters<AppointmentTransitionPersister["persistAppointmentTransition"]>[1];
  }>;
}

/**
 * Fila mutable con lector y persister conectados: el persister guarda el
 * estado, el motivo y la fecha original, como el adaptador de TI2-107.
 */
function changeWorld(overrides: Partial<WorldRow> = {}): ChangeWorld {
  const row: WorldRow = {
    id: "appointment-1",
    accompanimentId: "acc-1",
    studentId: "user-student",
    professionalId: "user-pro",
    status: "scheduled",
    startAt: CURRENT_START,
    endAt: CURRENT_END,
    ...overrides,
  };
  const transitions: ChangeWorld["transitions"] = [];
  const reader: AppointmentChangeReader = {
    getAppointment: async (appointmentId) => (appointmentId === row.id ? { ...row } : null),
  };
  const persister: AppointmentTransitionPersister = {
    persistAppointmentTransition: async (appointmentId, fields) => {
      transitions.push({ appointmentId, fields });
      row.status = fields.status;
      if (fields.originalStartsAt !== undefined) row.originalStartAt = fields.originalStartsAt;
    },
  };
  return { row, reader, persister, transitions };
}

const OK_OCCUPATION: OccupySlotResult = {
  status: "ok",
  data: { appointmentId: "appointment-1" },
};

const OCCUPIED: OccupySlotResult = {
  status: "error",
  error: { code: "conflict", message: "La solicitud entra en conflicto con el estado actual." },
};

/**
 * Ocupador que, como el repositorio real, mueve la fila cuando recibe
 * `movedAppointmentId` y responde lo indicado sin tocar el estado.
 */
function fakeOccupier(
  world: ChangeWorld,
  result: OccupySlotResult = OK_OCCUPATION,
): AppointmentOccupier & { readonly calls: OccupySlotInput[] } {
  const calls: OccupySlotInput[] = [];
  return {
    calls,
    occupySlot: async (input) => {
      calls.push(input);
      if (result.status === "ok" && input.movedAppointmentId === world.row.id) {
        world.row.startAt = input.startAt;
        world.row.endAt = input.endAt;
        world.row.professionalId = input.professionalId;
      }
      return result;
    },
  };
}

type ChangeOccupier = AppointmentOccupier & { readonly calls: OccupySlotInput[] };

type ChangeRescheduleDeps = Omit<RescheduleAppointmentDeps, "occupier"> & {
  readonly occupier: ChangeOccupier;
};

function cancelDeps(auth: AuthorizationReader, world: ChangeWorld): CancelAppointmentDeps {
  return { auth, appointments: world.reader, persister: world.persister, now: () => NOW };
}

function rescheduleDeps(
  auth: AuthorizationReader,
  world: ChangeWorld,
  overrides: Partial<Omit<ChangeRescheduleDeps, "auth" | "appointments" | "persister">> = {},
): ChangeRescheduleDeps {
  return {
    auth,
    appointments: world.reader,
    persister: world.persister,
    occupier: fakeOccupier(world),
    availability: fakeAvailability([
      ...dailyOnlineBlocks("user-pro"),
      ...dailyOnlineBlocks("user-pro-2"),
    ]),
    needs: noNeeds,
    compatibility: noCompatibility,
    now: () => NOW,
    ...overrides,
  };
}

function rescheduleInput(
  overrides: Partial<Parameters<typeof rescheduleAppointment>[1]> = {},
): Parameters<typeof rescheduleAppointment>[1] {
  return {
    tokenIdentifier: "token-student",
    appointmentId: "appointment-1",
    professionalId: "user-pro-2",
    modality: "online",
    startAt: FIRST_TARGET_START,
    endAt: FIRST_TARGET_END,
    timeZone: "UTC",
    ...overrides,
  };
}

const OK_APPOINTMENT = { status: "ok", data: { appointmentId: "appointment-1" } } as const;
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

describe("cancelación de una atención (TI2-109)", () => {
  test("el Estudiante dueño cancela con motivo opcional y la fila conserva el historial", async () => {
    const world = changeWorld();

    const result = await cancelAppointment(cancelDeps(authorizedAuth(), world), {
      tokenIdentifier: "token-student",
      appointmentId: "appointment-1",
      reason: "  Viaje familiar  ",
    });

    expect(result).toEqual(OK_APPOINTMENT);
    expect(world.transitions).toEqual([
      {
        appointmentId: "appointment-1",
        fields: { status: "cancelled_by_student", cancelReason: "Viaje familiar" },
      },
    ]);
    expect(world.row).toMatchObject({
      status: "cancelled_by_student",
      startAt: CURRENT_START,
      endAt: CURRENT_END,
    });
  });

  test("el Estudiante puede cancelar sin motivo y no se guarda un motivo vacío", async () => {
    const world = changeWorld();

    const withoutReason = await cancelAppointment(cancelDeps(authorizedAuth(), world), {
      tokenIdentifier: "token-student",
      appointmentId: "appointment-1",
    });

    expect(withoutReason).toEqual(OK_APPOINTMENT);
    expect(world.transitions).toEqual([
      { appointmentId: "appointment-1", fields: { status: "cancelled_by_student" } },
    ]);
  });

  test("la cancelación conserva la fecha original de un reagendamiento previo", async () => {
    const originalStartAt = Date.UTC(2026, 8, 1, 9);
    const world = changeWorld({ status: "rescheduled", originalStartAt });

    await cancelAppointment(cancelDeps(authorizedAuth(), world), {
      tokenIdentifier: "token-student",
      appointmentId: "appointment-1",
      reason: "Cambio de plan",
    });

    expect(world.transitions[0]?.fields).toEqual({
      status: "cancelled_by_student",
      cancelReason: "Cambio de plan",
      originalStartsAt: originalStartAt,
    });
    expect(world.row.originalStartAt).toBe(originalStartAt);
  });

  test("el Profesional de la atención cancela como CERETI y el motivo es obligatorio", async () => {
    const withReason = changeWorld();
    const result = await cancelAppointment(cancelDeps(authorizedAuth(), withReason), {
      tokenIdentifier: "token-pro",
      appointmentId: "appointment-1",
      reason: "Profesional sin disponibilidad",
    });
    expect(result).toEqual(OK_APPOINTMENT);
    expect(withReason.transitions[0]?.fields).toEqual({
      status: "cancelled_by_cereti",
      cancelReason: "Profesional sin disponibilidad",
    });

    for (const reason of [undefined, "", "   "]) {
      const world = changeWorld();
      const rejected = await cancelAppointment(cancelDeps(authorizedAuth(), world), {
        tokenIdentifier: "token-pro",
        appointmentId: "appointment-1",
        ...(reason === undefined ? {} : { reason }),
      });
      expect(rejected).toEqual(CONFLICT);
      expect(world.transitions).toHaveLength(0);
      expect(world.row.status).toBe("scheduled");
    }
  });

  test("ajenos, sin asignación vigente, Practicante y Administrador no cancelan", async () => {
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly auth: AuthorizationReader;
      readonly tokenIdentifier: string | null;
      readonly appointmentId?: string;
      readonly world?: ChangeWorld;
    }> = [
      {
        label: "otro estudiante",
        auth: authorizedAuth(),
        tokenIdentifier: "token-other",
      },
      {
        label: "profesional sin asignación",
        auth: fakeAuth({
          profiles: [professional],
          accompaniments: [activeAccompaniment],
        }),
        tokenIdentifier: "token-pro",
      },
      {
        label: "asignación revocada",
        auth: fakeAuth({
          profiles: [professional],
          accompaniments: [activeAccompaniment],
          assignments: [assignment({ status: "revoked" })],
        }),
        tokenIdentifier: "token-pro",
      },
      {
        label: "profesional asignado a la atención de otro",
        auth: authorizedAuth(),
        tokenIdentifier: "token-pro",
        world: changeWorld({ professionalId: "user-pro-2" }),
      },
      {
        label: "practicante asignado",
        auth: fakeAuth({
          profiles: [intern],
          accompaniments: [activeAccompaniment],
          assignments: [assignment({ userId: "user-intern", assignedRole: "intern" })],
        }),
        tokenIdentifier: "token-intern",
      },
      {
        label: "administrador",
        auth: fakeAuth({
          profiles: [admin],
          accompaniments: [activeAccompaniment],
        }),
        tokenIdentifier: "token-admin",
      },
      {
        label: "sin identidad",
        auth: authorizedAuth(),
        tokenIdentifier: null,
      },
      {
        label: "atención inexistente",
        auth: authorizedAuth(),
        tokenIdentifier: "token-student",
        appointmentId: "appointment-inexistente",
      },
    ];

    for (const { label, auth, tokenIdentifier, appointmentId, world } of cases) {
      const target = world ?? changeWorld();
      const result = await cancelAppointment(cancelDeps(auth, target), {
        tokenIdentifier,
        appointmentId: appointmentId ?? "appointment-1",
        reason: "Motivo ficticio",
      });
      expect({ label, result }).toEqual({ label, result: DENIED });
      expect({ label, calls: target.transitions.length }).toEqual({ label, calls: 0 });
    }
  });

  test("el acompañamiento pausado o una cuenta no vigente no cancelan", async () => {
    const paused = fakeAuth({
      profiles: [student],
      accompaniments: [{ ...activeAccompaniment, status: "paused" }],
    });
    const inactive = fakeAuth({
      profiles: [{ ...student, accountStatus: "inactive" }],
      accompaniments: [activeAccompaniment],
    });

    for (const auth of [paused, inactive]) {
      const world = changeWorld();
      expect(
        await cancelAppointment(cancelDeps(auth, world), {
          tokenIdentifier: "token-student",
          appointmentId: "appointment-1",
          reason: "Motivo ficticio",
        }),
      ).toEqual(DENIED);
      expect(world.transitions).toHaveLength(0);
    }
  });

  test("una segunda cancelación se rechaza sin volver a escribir", async () => {
    const world = changeWorld({ status: "cancelled_by_student" });

    expect(
      await cancelAppointment(cancelDeps(authorizedAuth(), world), {
        tokenIdentifier: "token-student",
        appointmentId: "appointment-1",
        reason: "Repetición",
      }),
    ).toEqual(CONFLICT);
    expect(world.transitions).toHaveLength(0);
  });
});

describe("reagendamiento de una atención (TI2-109)", () => {
  test("el Estudiante dueño mueve su atención al cupo de otro profesional asignado", async () => {
    const world = changeWorld();
    const deps = rescheduleDeps(authorizedAuth(), world);

    const result = await rescheduleAppointment(deps, rescheduleInput());

    expect(result).toEqual(OK_APPOINTMENT);
    expect(deps.occupier.calls).toEqual([
      {
        accompanimentId: "acc-1",
        studentId: "user-student",
        professionalId: "user-pro-2",
        modality: "online",
        startAt: FIRST_TARGET_START,
        endAt: FIRST_TARGET_END,
        movedAppointmentId: "appointment-1",
      },
    ]);
    expect(world.transitions).toEqual([
      {
        appointmentId: "appointment-1",
        fields: { status: "rescheduled", originalStartsAt: CURRENT_START },
      },
    ]);
    expect(world.row).toMatchObject({
      status: "rescheduled",
      professionalId: "user-pro-2",
      startAt: FIRST_TARGET_START,
      endAt: FIRST_TARGET_END,
      originalStartAt: CURRENT_START,
    });
  });

  test("el Profesional de la atención la mueve solo dentro de su propia agenda", async () => {
    const own = changeWorld();
    const ownResult = await rescheduleAppointment(rescheduleDeps(authorizedAuth(), own), {
      ...rescheduleInput(),
      tokenIdentifier: "token-pro",
      professionalId: "user-pro",
    });
    expect(ownResult).toEqual(OK_APPOINTMENT);
    expect(own.transitions[0]?.fields).toEqual({
      status: "rescheduled",
      originalStartsAt: CURRENT_START,
    });

    const foreignAgenda = changeWorld();
    const deps = rescheduleDeps(authorizedAuth(), foreignAgenda);
    expect(
      await rescheduleAppointment(deps, {
        ...rescheduleInput(),
        tokenIdentifier: "token-pro",
        professionalId: "user-pro-2",
      }),
    ).toEqual(DENIED);
    expect(deps.occupier.calls).toHaveLength(0);
    expect(foreignAgenda.transitions).toHaveLength(0);
  });

  test("el Profesional no mueve la atención de otro profesional", async () => {
    const world = changeWorld({ professionalId: "user-pro-2" });
    const deps = rescheduleDeps(authorizedAuth(), world);

    expect(
      await rescheduleAppointment(deps, {
        ...rescheduleInput(),
        tokenIdentifier: "token-pro",
        professionalId: "user-pro",
      }),
    ).toEqual(DENIED);
    expect(deps.occupier.calls).toHaveLength(0);
    expect(world.transitions).toHaveLength(0);
  });

  test("un destino ocupado conserva el origen y no persiste la transición", async () => {
    const world = changeWorld();
    const deps = rescheduleDeps(authorizedAuth(), world, {
      occupier: fakeOccupier(world, OCCUPIED),
    });

    expect(await rescheduleAppointment(deps, rescheduleInput())).toEqual(CONFLICT);
    expect(deps.occupier.calls).toHaveLength(1);
    expect(world.transitions).toHaveLength(0);
    expect(world.row).toMatchObject({
      status: "scheduled",
      professionalId: "user-pro",
      startAt: CURRENT_START,
      endAt: CURRENT_END,
    });
    expect(world.row.originalStartAt).toBeUndefined();
  });

  test("reagendar dos veces conserva la primera fecha original", async () => {
    const world = changeWorld();
    const deps = rescheduleDeps(authorizedAuth(), world);

    requireOk(await rescheduleAppointment(deps, rescheduleInput()));
    const afterFirst = { ...world.row };

    requireOk(
      await rescheduleAppointment(
        deps,
        rescheduleInput({ startAt: SECOND_TARGET_START, endAt: SECOND_TARGET_END }),
      ),
    );

    expect(afterFirst.originalStartAt).toBe(CURRENT_START);
    expect(world.transitions).toHaveLength(2);
    expect(world.transitions[0]?.fields).toEqual({
      status: "rescheduled",
      originalStartsAt: CURRENT_START,
    });
    expect(world.transitions[1]?.fields).toEqual({
      status: "rescheduled",
      originalStartsAt: CURRENT_START,
    });
    expect(world.row).toMatchObject({
      status: "rescheduled",
      startAt: SECOND_TARGET_START,
      endAt: SECOND_TARGET_END,
      originalStartAt: CURRENT_START,
    });
  });

  test("una atención cancelada no se mueve aunque el destino exista", async () => {
    const world = changeWorld({ status: "cancelled_by_student" });
    const deps = rescheduleDeps(authorizedAuth(), world);

    expect(await rescheduleAppointment(deps, rescheduleInput())).toEqual(CONFLICT);
    expect(deps.occupier.calls).toHaveLength(0);
    expect(world.transitions).toHaveLength(0);
  });

  test("sin cupo vigente no se ocupa ni se persiste", async () => {
    const world = changeWorld();
    const deps = rescheduleDeps(authorizedAuth(), world, {
      availability: fakeAvailability([]),
    });

    expect(await rescheduleAppointment(deps, rescheduleInput())).toEqual(NO_AVAILABILITY);
    expect(deps.occupier.calls).toHaveLength(0);
    expect(world.transitions).toHaveLength(0);
  });

  test("un profesional destino sin asignación activa deja el cupo sin disponibilidad", async () => {
    const world = changeWorld();
    const deps = rescheduleDeps(
      fakeAuth({
        profiles: [student, professional],
        accompaniments: [activeAccompaniment],
        assignments: [assignment({})],
      }),
      world,
    );

    expect(await rescheduleAppointment(deps, rescheduleInput())).toEqual(NO_AVAILABILITY);
    expect(deps.occupier.calls).toHaveLength(0);
    expect(world.transitions).toHaveLength(0);
  });

  test("ajenos, revocados, Practicante y Administrador no mueven la atención", async () => {
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly auth: AuthorizationReader;
      readonly tokenIdentifier: string | null;
    }> = [
      { label: "otro estudiante", auth: authorizedAuth(), tokenIdentifier: "token-other" },
      {
        label: "asignación revocada",
        auth: fakeAuth({
          profiles: [professional],
          accompaniments: [activeAccompaniment],
          assignments: [assignment({ status: "revoked" })],
        }),
        tokenIdentifier: "token-pro",
      },
      {
        label: "practicante asignado",
        auth: fakeAuth({
          profiles: [intern],
          accompaniments: [activeAccompaniment],
          assignments: [assignment({ userId: "user-intern", assignedRole: "intern" })],
        }),
        tokenIdentifier: "token-intern",
      },
      {
        label: "administrador",
        auth: fakeAuth({ profiles: [admin], accompaniments: [activeAccompaniment] }),
        tokenIdentifier: "token-admin",
      },
      { label: "sin identidad", auth: authorizedAuth(), tokenIdentifier: null },
    ];

    for (const { label, auth, tokenIdentifier } of cases) {
      const world = changeWorld();
      const deps = rescheduleDeps(auth, world);
      const result = await rescheduleAppointment(deps, rescheduleInput({ tokenIdentifier }));
      expect({ label, result }).toEqual({ label, result: DENIED });
      expect({ label, calls: deps.occupier.calls.length }).toEqual({ label, calls: 0 });
      expect({ label, transitions: world.transitions.length }).toEqual({
        label,
        transitions: 0,
      });
    }
  });

  test("el acompañamiento pausado no admite reagendamiento", async () => {
    const world = changeWorld();
    const deps = rescheduleDeps(
      fakeAuth({
        profiles: [student],
        accompaniments: [{ ...activeAccompaniment, status: "paused" }],
      }),
      world,
    );

    expect(await rescheduleAppointment(deps, rescheduleInput())).toEqual(DENIED);
    expect(deps.occupier.calls).toHaveLength(0);
    expect(world.transitions).toHaveLength(0);
  });

  test("una entrada inválida se rechaza antes de ocupar o persistir", async () => {
    const world = changeWorld();
    const deps = rescheduleDeps(authorizedAuth(), world);
    const invalidInputs = [
      rescheduleInput({ appointmentId: "   " }),
      rescheduleInput({ startAt: FIRST_TARGET_END, endAt: FIRST_TARGET_START }),
      rescheduleInput({ timeZone: "No/Existe" }),
      rescheduleInput({ modality: "inPerson" }),
      rescheduleInput({ spaceId: "space-1" }),
      rescheduleInput({ startAt: CURRENT_START, endAt: CURRENT_END }),
    ];

    for (const input of invalidInputs) {
      expect(await rescheduleAppointment(deps, input)).toEqual(CONFLICT);
    }
    expect(deps.occupier.calls).toHaveLength(0);
    expect(world.transitions).toHaveLength(0);
    expect(world.row.status).toBe("scheduled");
  });
});
