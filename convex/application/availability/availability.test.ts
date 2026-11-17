import { describe, expect, test } from "vitest";
import type { ApiResult } from "../../domain/errors/api_error";
import {
  AVAILABILITY_CONTRACT_VERSION,
  type AvailabilityBlock,
  type AvailabilitySearchResult,
} from "../../domain/availability/availability";
import {
  OFFICIAL_CHANNELS,
  toOfficialChannelCoordination,
  type NoCompatibleSlotReason,
} from "../../domain/availability/official_channel";
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
  AvailabilityWriter,
  CompatibilitySpaceSource,
  SlotOccupancyReader,
  StoredAvailabilityBlock,
  StoredAvailabilityException,
} from "./ports";
import {
  listBookableProfessionals,
  listOwnAvailability,
  publishAvailabilityBlock,
  publishAvailabilityException,
  removeAvailabilityException,
  SEARCH_AVAILABILITY_PAGE_LIMIT_MAX,
  searchAvailabilitySlots,
  setAvailabilityBlockActive,
  updateAvailabilityBlock,
  type SearchAvailabilityDeps,
} from "./availability";

type FakeProfile = AuthorizableProfile & { readonly tokenIdentifier: string };

const student: FakeProfile = {
  _id: "user-student",
  role: "student",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-student",
};

const professional: FakeProfile = {
  _id: "user-pro",
  role: "professional",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-pro",
};

const otherProfessional: FakeProfile = {
  _id: "user-other-pro",
  role: "professional",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-other-pro",
};

const intern: FakeProfile = {
  _id: "user-intern",
  role: "intern",
  institutionalStatus: "enabled",
  accountStatus: "active",
  tokenIdentifier: "token-intern",
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

function activeAssignment(): AuthorizableAssignment {
  return {
    accompanimentId: "acc-1",
    userId: "user-pro",
    assignedRole: "professional",
    status: "active",
  };
}

/**
 * Estudiante dueño de `acc-1` que busca al profesional `user-pro`, asignado y
 * vigente: la búsqueda solo expone cupos de un profesional reservable.
 */
function studentSearchAuth(
  overrides: {
    readonly professional?: FakeProfile;
    readonly assignments?: AuthorizableAssignment[];
  } = {},
): AuthorizationReader {
  return fakeAuth({
    profiles: [student, overrides.professional ?? professional],
    accompaniments: [activeAccompaniment],
    assignments: overrides.assignments ?? [activeAssignment()],
  });
}

/** Bloques en línea para cada día de la semana: cubren cualquier fecha sin depender del calendario. */
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
}): AvailabilityReader &
  AvailabilityWriter & {
    readonly calls: { insertBlock: number; updateBlock: number; removeException: number };
  } {
  const calls = { insertBlock: 0, updateBlock: 0, removeException: 0 };
  const blocks = data.blocks ?? [];
  const exceptions = data.exceptions ?? [];
  return {
    calls,
    getBlock: async (blockId) => blocks.find((row) => row.id === blockId) ?? null,
    listActiveBlocks: async () => ({ status: "ok", data: blocks }),
    getException: async (exceptionId) => exceptions.find((row) => row.id === exceptionId) ?? null,
    listExceptions: async () => ({ status: "ok", data: exceptions }),
    insertBlock: async (block) => {
      calls.insertBlock += 1;
      return { status: "ok", data: { blockId: `block-nuevo-${block.professionalId}` } };
    },
    updateBlock: async () => {
      calls.updateBlock += 1;
      return { status: "ok", data: null };
    },
    setBlockActive: async () => ({ status: "ok", data: null }),
    insertException: async () => ({ status: "ok", data: { exceptionId: "exc-nueva" } }),
    removeException: async () => {
      calls.removeException += 1;
      return { status: "ok", data: null };
    },
  };
}

/** Necesidades vigentes del acompañamiento `acc-1`; otro acompañamiento no existe. */
function fakeNeeds(needs: readonly AccessNeed[]): AccompanimentNeedsReader {
  return {
    findAccompanimentNeeds: async (accompanimentId) =>
      accompanimentId === "acc-1" ? { _id: accompanimentId, needs } : null,
  };
}

/** Ocupación mutable por inicio y por predicado de intervalo. */
function fakeOccupancy(data?: {
  readonly occupyAll?: boolean;
  readonly overlaps?: (startAt: number, endAt: number) => boolean;
}): SlotOccupancyReader & {
  readonly occupiedStarts: Set<number>;
  readonly received: Array<{ readonly startAt: number; readonly endAt: number }>;
} {
  const occupiedStarts = new Set<number>();
  const received: Array<{ readonly startAt: number; readonly endAt: number }> = [];
  return {
    occupiedStarts,
    received,
    isSlotOccupied: async ({ startAt, endAt }) => {
      received.push({ startAt, endAt });
      return (
        data?.occupyAll === true ||
        occupiedStarts.has(startAt) ||
        data?.overlaps?.(startAt, endAt) === true
      );
    },
  };
}

/** Catálogo mínimo: salas por identificador y apoyos de la plataforma en línea. */
function fakeCompatibility(data?: {
  readonly spaces?: Readonly<Record<string, CompatibilitySpace>>;
  readonly onlineSupports?: readonly AccessNeed[];
}): CompatibilitySpaceSource {
  return {
    findCompatibilitySpace: async (spaceId) => data?.spaces?.[spaceId] ?? null,
    listOnlineSupports: async () => data?.onlineSupports ?? [],
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

function searchDeps(
  auth: AuthorizationReader,
  overrides: Partial<Omit<SearchAvailabilityDeps, "auth">> = {},
): SearchAvailabilityDeps {
  return {
    auth,
    availability: fakeAvailability({ blocks: dailyOnlineBlocks("user-pro") }),
    needs: fakeNeeds([]),
    compatibility: fakeCompatibility(),
    occupancy: fakeOccupancy(),
    ...overrides,
  };
}

function searchInput(overrides: Partial<Parameters<typeof searchAvailabilitySlots>[1]> = {}) {
  return {
    tokenIdentifier: "token-student",
    accompanimentId: "acc-1",
    professionalId: "user-pro",
    from: "2026-10-26",
    to: "2026-10-26",
    timeZone: "America/Santiago",
    limit: 10,
    version: AVAILABILITY_CONTRACT_VERSION,
    ...overrides,
  };
}

const DENIED = { status: "error", error: { code: "unauthorized", message: "No autorizado" } };
const CONFLICT = {
  status: "error",
  error: { code: "conflict", message: "La solicitud entra en conflicto con el estado actual." },
};
/** Ausencia explícita de horario compatible de `acc-1` con su motivo (TI2-144). */
function noCompatibleSlot(reason: NoCompatibleSlotReason) {
  return {
    status: "ok",
    data: {
      status: "no_compatible_slot",
      coordination: toOfficialChannelCoordination("acc-1", reason),
      version: AVAILABILITY_CONTRACT_VERSION,
    },
  };
}

/** Extrae el éxito o falla la prueba sin `expect` condicional (regla de lint). */
function requireOk<T>(result: ApiResult<T>): T {
  if (result.status !== "ok") throw new Error(`Se esperaba éxito y llegó ${result.error.code}`);
  return result.data;
}

/** Extrae la página con cupos o falla la prueba. */
function requireAvailable(result: ApiResult<AvailabilitySearchResult>) {
  const data = requireOk(result);
  if (data.status !== "available") {
    throw new Error(`Se esperaban cupos y llegó ${data.coordination.reason}`);
  }
  return data;
}

describe("publicación de bloques propios (TI2-97)", () => {
  test("el profesional publica con su identidad del servidor como dueño", async () => {
    const auth = fakeAuth({ profiles: [professional] });
    const store = fakeAvailability({});
    const block: Omit<AvailabilityBlock, "id" | "professionalId" | "version"> = {
      weekday: 1,
      startMinute: 540,
      endMinute: 600,
      slotMinutes: 60,
      modality: "online",
    };
    const result = await publishAvailabilityBlock(auth, store, {
      tokenIdentifier: "token-pro",
      block,
    });
    expect(result).toEqual({ status: "ok", data: { blockId: "block-nuevo-user-pro" } });
    expect(store.calls.insertBlock).toBe(1);
  });

  test("el estudiante y la ausencia de identidad no publican ni escriben", async () => {
    const auth = fakeAuth({ profiles: [professional, student] });
    const store = fakeAvailability({});
    const block = {
      weekday: 1,
      startMinute: 540,
      endMinute: 600,
      slotMinutes: 60,
      modality: "online",
    } as const;
    expect(
      await publishAvailabilityBlock(auth, store, { tokenIdentifier: "token-student", block }),
    ).toEqual(DENIED);
    expect(await publishAvailabilityBlock(auth, store, { tokenIdentifier: null, block })).toEqual(
      DENIED,
    );
    expect(store.calls.insertBlock).toBe(0);
  });

  test("editar un bloque ajeno o inexistente se deniega igual, sin escribir", async () => {
    const auth = fakeAuth({ profiles: [professional, otherProfessional] });
    const foreign = fakeAvailability({ blocks: dailyOnlineBlocks("user-other-pro") });
    const missing = fakeAvailability({ blocks: [] });
    const block = {
      weekday: 1,
      startMinute: 540,
      endMinute: 600,
      slotMinutes: 60,
      modality: "online",
    } as const;
    expect(
      await updateAvailabilityBlock(auth, foreign, {
        tokenIdentifier: "token-pro",
        blockId: "block-1",
        block,
      }),
    ).toEqual(DENIED);
    expect(
      await updateAvailabilityBlock(auth, missing, {
        tokenIdentifier: "token-pro",
        blockId: "block-inexistente",
        block,
      }),
    ).toEqual(DENIED);
    expect(foreign.calls.updateBlock).toBe(0);
    expect(missing.calls.updateBlock).toBe(0);
  });

  test("el profesional retira su bloque y quita su excepción", async () => {
    const auth = fakeAuth({ profiles: [professional] });
    const store = fakeAvailability({
      blocks: dailyOnlineBlocks("user-pro"),
      exceptions: [
        {
          id: "exc-1",
          professionalId: "user-pro",
          date: "2026-10-26",
          kind: "cancelled",
          version: AVAILABILITY_CONTRACT_VERSION,
        },
      ],
    });
    expect(
      await setAvailabilityBlockActive(auth, store, {
        tokenIdentifier: "token-pro",
        blockId: "block-1",
        isActive: false,
      }),
    ).toEqual({ status: "ok", data: null });
    expect(
      await removeAvailabilityException(auth, store, {
        tokenIdentifier: "token-pro",
        exceptionId: "exc-1",
      }),
    ).toEqual({ status: "ok", data: null });
    expect(store.calls.removeException).toBe(1);
  });

  test("quitar una excepción ajena se deniega igual que una inexistente", async () => {
    const auth = fakeAuth({ profiles: [professional] });
    const foreign = fakeAvailability({
      exceptions: [
        {
          id: "exc-1",
          professionalId: "user-other-pro",
          date: "2026-10-26",
          kind: "cancelled",
          version: AVAILABILITY_CONTRACT_VERSION,
        },
      ],
    });
    const missing = fakeAvailability({ exceptions: [] });
    expect(
      await removeAvailabilityException(auth, foreign, {
        tokenIdentifier: "token-pro",
        exceptionId: "exc-1",
      }),
    ).toEqual(DENIED);
    expect(
      await removeAvailabilityException(auth, missing, {
        tokenIdentifier: "token-pro",
        exceptionId: "exc-inexistente",
      }),
    ).toEqual(DENIED);
    expect(foreign.calls.removeException).toBe(0);
  });

  test("publicar una excepción exige profesional vigente", async () => {
    const auth = fakeAuth({ profiles: [professional, student] });
    const store = fakeAvailability({});
    const exception = { date: "2026-10-26", kind: "cancelled" } as const;
    expect(
      await publishAvailabilityException(auth, store, {
        tokenIdentifier: "token-pro",
        exception,
      }),
    ).toEqual({ status: "ok", data: { exceptionId: "exc-nueva" } });
    expect(
      await publishAvailabilityException(auth, store, {
        tokenIdentifier: "token-student",
        exception,
      }),
    ).toEqual(DENIED);
  });
});

describe("búsqueda de cupos para el acompañamiento (TI2-97)", () => {
  test("el estudiante dueño y el profesional asignado consultan el día activo", async () => {
    const studentAuth = studentSearchAuth();
    const studentData = requireAvailable(
      await searchAvailabilitySlots(searchDeps(studentAuth), searchInput()),
    );
    expect(studentData.items).toHaveLength(1);
    expect(studentData.version).toBe("v1");

    const proAuth = fakeAuth({
      profiles: [professional],
      accompaniments: [activeAccompaniment],
      assignments: [activeAssignment()],
    });
    const proResult = await searchAvailabilitySlots(
      searchDeps(proAuth),
      searchInput({ tokenIdentifier: "token-pro" }),
    );
    expect(proResult.status).toBe("ok");
  });

  test("la revocación corta la consulta en la operación siguiente", async () => {
    const auth = fakeAuth({
      profiles: [professional],
      accompaniments: [activeAccompaniment],
      assignments: [{ ...activeAssignment(), status: "revoked" }],
    });
    expect(
      await searchAvailabilitySlots(
        searchDeps(auth),
        searchInput({ tokenIdentifier: "token-pro" }),
      ),
    ).toEqual(DENIED);
  });

  test("el profesional buscado sin asignación activa o sin cuenta vigente no expone sus cupos", async () => {
    const cases: Array<{ readonly label: string; readonly auth: AuthorizationReader }> = [
      { label: "sin asignación", auth: studentSearchAuth({ assignments: [] }) },
      {
        label: "asignación revocada",
        auth: studentSearchAuth({ assignments: [{ ...activeAssignment(), status: "revoked" }] }),
      },
      {
        label: "asignado como practicante",
        auth: studentSearchAuth({
          assignments: [{ ...activeAssignment(), assignedRole: "intern" }],
        }),
      },
      {
        // El lector real ya filtra por acompañamiento y usuario; la regla no
        // confía en eso y descarta igual una fila que no corresponde.
        label: "el lector entrega una asignación de otro acompañamiento",
        auth: {
          ...studentSearchAuth(),
          findActiveAssignments: async () => [{ ...activeAssignment(), accompanimentId: "acc-2" }],
        },
      },
      {
        label: "el lector entrega una asignación de otro usuario",
        auth: {
          ...studentSearchAuth(),
          findActiveAssignments: async () => [{ ...activeAssignment(), userId: "user-other-pro" }],
        },
      },
      {
        label: "asignado en otro acompañamiento",
        auth: studentSearchAuth({
          assignments: [{ ...activeAssignment(), accompanimentId: "acc-2" }],
        }),
      },
      {
        label: "cuenta inactiva",
        auth: studentSearchAuth({ professional: { ...professional, accountStatus: "inactive" } }),
      },
      {
        label: "habilitación pendiente",
        auth: studentSearchAuth({
          professional: { ...professional, institutionalStatus: "pending" },
        }),
      },
      {
        label: "no es profesional",
        auth: studentSearchAuth({ professional: { ...professional, role: "intern" } }),
      },
    ];
    // Sin llegar a evaluar cupos: la disponibilidad del profesional no se expone.
    const results: Record<string, unknown> = {};
    for (const { label, auth } of cases) {
      const occupancy = fakeOccupancy();
      const result = await searchAvailabilitySlots(searchDeps(auth, { occupancy }), searchInput());
      results[label] = { result, evaluated: occupancy.received.length };
    }
    expect(results).toEqual(
      Object.fromEntries(
        cases.map(({ label }) => [
          label,
          { result: noCompatibleSlot("no_published_slots"), evaluated: 0 },
        ]),
      ),
    );
    // El profesional inexistente responde igual que uno sin agenda publicada.
    expect(
      await searchAvailabilitySlots(
        searchDeps(studentSearchAuth()),
        searchInput({ professionalId: "user-inexistente" }),
      ),
    ).toEqual(noCompatibleSlot("no_published_slots"));
  });

  test("el acompañamiento pausado o cerrado no admite consulta, pero su historial sí se lee aparte", async () => {
    for (const status of ["paused", "closed"] as const) {
      const auth = fakeAuth({
        profiles: [student],
        accompaniments: [{ ...activeAccompaniment, status }],
      });
      expect(await searchAvailabilitySlots(searchDeps(auth), searchInput())).toEqual(DENIED);
    }
  });

  test("practicante asignado y acompañamiento ajeno se deniegan igual que el inexistente", async () => {
    const internAuth = fakeAuth({
      profiles: [intern],
      accompaniments: [activeAccompaniment],
      assignments: [
        {
          accompanimentId: "acc-1",
          userId: "user-intern",
          assignedRole: "intern",
          status: "active",
        },
      ],
    });
    const internResult = await searchAvailabilitySlots(
      searchDeps(internAuth),
      searchInput({ tokenIdentifier: "token-intern" }),
    );
    const studentAuth = studentSearchAuth();
    const missing = await searchAvailabilitySlots(
      searchDeps(studentAuth),
      searchInput({ accompanimentId: "acc-inexistente" }),
    );
    expect(internResult).toEqual(DENIED);
    expect(missing).toEqual(DENIED);
  });

  test("sin necesidades resueltas la búsqueda responde conflicto sin filtrar", async () => {
    const auth = studentSearchAuth();
    const deps = searchDeps(auth, {
      needs: { findAccompanimentNeeds: async () => null },
    });
    expect(await searchAvailabilitySlots(deps, searchInput())).toEqual(CONFLICT);
  });

  test("sin el acompañamiento para resolver al estudiante la búsqueda responde conflicto", async () => {
    // La autorización ya lo leyó; si la segunda lectura no lo encuentra, no
    // se decide la ocupación sin el estudiante.
    let reads = 0;
    const base = studentSearchAuth();
    const auth: AuthorizationReader = {
      ...base,
      getAccompaniment: async (accompanimentId) => {
        reads += 1;
        return reads === 1 ? await base.getAccompaniment(accompanimentId) : null;
      },
    };
    expect(await searchAvailabilitySlots(searchDeps(auth), searchInput())).toEqual(CONFLICT);
  });

  test("el tope de lectura superado responde conflicto sin lista cortada", async () => {
    const auth = studentSearchAuth();
    const availability = fakeAvailability({ blocks: dailyOnlineBlocks("user-pro") });
    const deps = searchDeps(auth, {
      availability: {
        ...availability,
        listActiveBlocks: async () => ({
          status: "error",
          error: {
            code: "conflict",
            message: "La solicitud entra en conflicto con el estado actual.",
          },
        }),
      },
    });
    expect(await searchAvailabilitySlots(deps, searchInput())).toEqual(CONFLICT);
  });

  test("sin bloques responde la ausencia de horario publicado con los canales oficiales", async () => {
    const auth = studentSearchAuth();
    const deps = searchDeps(auth, { availability: fakeAvailability({ blocks: [] }) });
    expect(await searchAvailabilitySlots(deps, searchInput())).toEqual(
      noCompatibleSlot("no_published_slots"),
    );
  });

  test("el cupo ocupado no aparece como disponible y explica que está ocupado", async () => {
    const auth = studentSearchAuth();
    const deps = searchDeps(auth, { occupancy: fakeOccupancy({ occupyAll: true }) });
    expect(await searchAvailabilitySlots(deps, searchInput())).toEqual(
      noCompatibleSlot("slots_occupied"),
    );
  });

  test("si ningún horario cubre las necesidades, aunque todos estén ocupados, el motivo es la compatibilidad", async () => {
    // Dos cupos presenciales y uno en línea, todos ocupados por otras
    // personas; ni la sala ni la plataforma cubren la necesidad.
    const auth = studentSearchAuth();
    const need = { id: "need-1", label: "Intérprete de lengua de señas" };
    const blocks = [
      ...dailyInPersonBlocks("user-pro", "space-1").map((block) => ({ ...block, endMinute: 660 })),
      ...dailyOnlineBlocks("user-pro").map((block) => ({
        ...block,
        id: `online-${block.id}`,
        startMinute: 720,
        endMinute: 780,
      })),
    ];
    const occupancy = fakeOccupancy({ occupyAll: true });
    const deps = searchDeps(auth, {
      availability: fakeAvailability({ blocks }),
      needs: fakeNeeds([need]),
      compatibility: fakeCompatibility({
        spaces: { "space-1": { space: fictitiousSpace, isActive: true, satisfiedNeeds: [] } },
      }),
      occupancy,
    });
    expect(await searchAvailabilitySlots(deps, searchInput())).toEqual(
      noCompatibleSlot("needs_not_met"),
    );
    // La ocupación de otras personas no se consulta para horarios que no sirven.
    expect(occupancy.received).toHaveLength(0);
  });

  test("si el único horario compatible está ocupado, el motivo es la ocupación aunque otros sean incompatibles", async () => {
    // La sala accesible cubre la necesidad pero está ocupada; la otra sala no
    // la cubre y está libre.
    const auth = studentSearchAuth();
    const need = { id: "need-1", label: "Sala accesible" };
    const blocks = [
      ...dailyInPersonBlocks("user-pro", "space-1"),
      ...dailyInPersonBlocks("user-pro", "space-2").map((block) => ({
        ...block,
        id: `other-${block.id}`,
        startMinute: 600,
        endMinute: 660,
      })),
    ];
    const occupancy = fakeOccupancy({ occupyAll: true });
    const deps = searchDeps(auth, {
      availability: fakeAvailability({ blocks }),
      needs: fakeNeeds([need]),
      compatibility: fakeCompatibility({
        spaces: {
          "space-1": { space: fictitiousSpace, isActive: true, satisfiedNeeds: [need] },
          "space-2": {
            space: { ...fictitiousSpace, id: "space-2", room: "Sala 102" },
            isActive: true,
            satisfiedNeeds: [],
          },
        },
      }),
      occupancy,
    });
    expect(await searchAvailabilitySlots(deps, searchInput())).toEqual(
      noCompatibleSlot("slots_occupied"),
    );
    // Solo se consulta la ocupación del horario compatible.
    expect(occupancy.received).toHaveLength(1);
  });

  test("el intervalo decide: conserva el cupo contiguo y descarta el solapado con igual inicio", async () => {
    const auth = studentSearchAuth();
    const windows: StoredAvailabilityBlock[] = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
      {
        id: `block-corto-${weekday}`,
        professionalId: "user-pro",
        weekday,
        startMinute: 540,
        endMinute: 570,
        slotMinutes: 30,
        modality: "online",
        isActive: true,
        version: AVAILABILITY_CONTRACT_VERSION,
      },
      {
        id: `block-largo-${weekday}`,
        professionalId: "user-pro",
        weekday,
        startMinute: 540,
        endMinute: 600,
        slotMinutes: 60,
        modality: "online",
        isActive: true,
        version: AVAILABILITY_CONTRACT_VERSION,
      },
    ]);
    const availability = fakeAvailability({ blocks: windows });
    const probe = searchDeps(auth, { availability });
    const first = requireAvailable(await searchAvailabilitySlots(probe, searchInput()));
    expect(first.items).toHaveLength(2);
    const ordered = [...first.items].sort((a, b) => a.endAt - b.endAt);
    const short = ordered[0];
    const long = ordered[1];
    if (short === undefined || long === undefined) throw new Error("Se esperaban dos cupos");
    expect(short.startAt).toBe(long.startAt);

    // La atención ocupa desde el fin del cupo corto hasta el fin del largo:
    // el corto queda contiguo y el largo se cruza.
    const appointment = { start: short.endAt, end: long.endAt };
    const occupancy = fakeOccupancy({
      overlaps: (startAt, endAt) => startAt < appointment.end && appointment.start < endAt,
    });
    const deps = searchDeps(auth, { availability, occupancy });
    const second = requireAvailable(await searchAvailabilitySlots(deps, searchInput()));
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.endAt).toBe(short.endAt);

    // Igual inicio con distinto fin genera consultas distintas.
    expect(occupancy.received).toHaveLength(2);
    expect(occupancy.received[0]?.startAt).toBe(occupancy.received[1]?.startAt);
    expect(occupancy.received[0]?.endAt).not.toBe(occupancy.received[1]?.endAt);
  });

  test("la necesidad sin cobertura no se rebaja: explica la incompatibilidad", async () => {
    const auth = studentSearchAuth();
    const deps = searchDeps(auth, {
      needs: fakeNeeds([{ id: "need-1", label: "Sala accesible" }]),
    });
    expect(await searchAvailabilitySlots(deps, searchInput())).toEqual(
      noCompatibleSlot("needs_not_met"),
    );
  });

  test("la sala incompatible no aparece aunque otra necesidad sí quede cubierta", async () => {
    // La sala cubre una de las dos necesidades: no basta, y la búsqueda no
    // ofrece el cupo quitando la que falta.
    const auth = studentSearchAuth();
    const ramp = { id: "need-1", label: "Rampa de acceso" };
    const loop = { id: "need-2", label: "Bucle magnético" };
    const deps = searchDeps(auth, {
      availability: fakeAvailability({ blocks: dailyInPersonBlocks("user-pro", "space-1") }),
      needs: fakeNeeds([ramp, loop]),
      compatibility: fakeCompatibility({
        spaces: { "space-1": { space: fictitiousSpace, isActive: true, satisfiedNeeds: [ramp] } },
      }),
    });
    expect(await searchAvailabilitySlots(deps, searchInput())).toEqual(
      noCompatibleSlot("needs_not_met"),
    );
  });

  test("la ausencia trae los canales oficiales y un código de referencia sin datos personales", async () => {
    const auth = studentSearchAuth();
    const deps = searchDeps(auth, { availability: fakeAvailability({ blocks: [] }) });
    const data = requireOk(await searchAvailabilitySlots(deps, searchInput()));
    if (data.status !== "no_compatible_slot") throw new Error("Se esperaba la ausencia de cupo");
    const { coordination } = data;
    expect(coordination.channels).toEqual(OFFICIAL_CHANNELS);
    // cspell:ignore HJKMNP
    expect(coordination.referenceCode).toMatch(/^CER-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    // No lleva identificadores ni datos del estudiante o del profesional.
    for (const fragment of ["acc-1", "user-student", "user-pro", "token-student"]) {
      expect(JSON.stringify(coordination)).not.toContain(fragment);
    }
    // Otra semana del mismo acompañamiento entrega el mismo código.
    const otherWeek = requireOk(
      await searchAvailabilitySlots(deps, searchInput({ from: "2026-11-02", to: "2026-11-02" })),
    );
    expect(otherWeek.status === "no_compatible_slot" && otherWeek.coordination.referenceCode).toBe(
      coordination.referenceCode,
    );
  });

  test("el cupo presencial con sala vigente que cubre las necesidades se ofrece", async () => {
    const auth = studentSearchAuth();
    const need = { id: "need-1", label: "Sala accesible" };
    const deps = searchDeps(auth, {
      availability: fakeAvailability({ blocks: dailyInPersonBlocks("user-pro", "space-1") }),
      needs: fakeNeeds([need]),
      compatibility: fakeCompatibility({
        spaces: { "space-1": { space: fictitiousSpace, isActive: true, satisfiedNeeds: [need] } },
      }),
    });
    const data = requireAvailable(await searchAvailabilitySlots(deps, searchInput()));
    expect(data.items).toHaveLength(1);
    expect(data.items[0]?.spaceId).toBe("space-1");
    // Trae la ubicación y el acceso de su sala, sin la versión del catálogo.
    expect(data.items[0]?.space).toEqual({
      campus: "Campus ficticio",
      building: "Edificio ficticio",
      floor: "Piso 1",
      room: "Sala 101",
      accessConditions: "Acceso ficticio sin barreras",
      arrivalInstructions: "Instrucciones ficticias de llegada",
    });
  });

  test("el cupo en línea no trae sala", async () => {
    const data = requireAvailable(
      await searchAvailabilitySlots(searchDeps(studentSearchAuth()), searchInput()),
    );
    expect(data.items[0]).not.toHaveProperty("space");
  });

  test("la ocupación se consulta con el profesional, el estudiante del acompañamiento y la sala del cupo", async () => {
    type OccupancyQuery = Parameters<SlotOccupancyReader["isSlotOccupied"]>[0];
    const recordingOccupancy = () => {
      const received: OccupancyQuery[] = [];
      const occupancy: SlotOccupancyReader = {
        isSlotOccupied: async (query) => {
          received.push(query);
          return false;
        },
      };
      return { occupancy, received };
    };
    const inPersonDeps = (auth: AuthorizationReader, occupancy: SlotOccupancyReader) =>
      searchDeps(auth, {
        availability: fakeAvailability({ blocks: dailyInPersonBlocks("user-pro", "space-1") }),
        compatibility: fakeCompatibility({
          spaces: { "space-1": { space: fictitiousSpace, isActive: true, satisfiedNeeds: [] } },
        }),
        occupancy,
      });

    // Presencial: lleva la sala del cupo.
    const inPerson = recordingOccupancy();
    requireOk(
      await searchAvailabilitySlots(
        inPersonDeps(studentSearchAuth(), inPerson.occupancy),
        searchInput(),
      ),
    );
    expect(inPerson.received).toHaveLength(1);
    expect(inPerson.received[0]).toEqual({
      professionalId: "user-pro",
      studentId: "user-student",
      spaceId: "space-1",
      startAt: expect.any(Number),
      endAt: expect.any(Number),
    });

    // En línea: sin sala.
    const online = recordingOccupancy();
    requireOk(
      await searchAvailabilitySlots(
        searchDeps(studentSearchAuth(), { occupancy: online.occupancy }),
        searchInput(),
      ),
    );
    expect(online.received).toHaveLength(1);
    expect(online.received[0]).not.toHaveProperty("spaceId");
    expect(online.received[0]?.studentId).toBe("user-student");

    // Cuando busca el profesional asignado, el estudiante sigue siendo el del
    // acompañamiento, no quien llama.
    const byProfessional = recordingOccupancy();
    const proAuth = fakeAuth({
      profiles: [professional],
      accompaniments: [activeAccompaniment],
      assignments: [activeAssignment()],
    });
    requireOk(
      await searchAvailabilitySlots(
        inPersonDeps(proAuth, byProfessional.occupancy),
        searchInput({ tokenIdentifier: "token-pro" }),
      ),
    );
    expect(byProfessional.received[0]?.studentId).toBe("user-student");
  });

  test("la sala retirada no se ofrece y no se explica como necesidad sin cubrir", async () => {
    // Sin necesidades declaradas, culpar a las necesidades sería falso: el
    // cupo simplemente no se puede ofrecer.
    const auth = studentSearchAuth();
    const missing = searchDeps(auth, {
      availability: fakeAvailability({ blocks: dailyInPersonBlocks("user-pro", "space-1") }),
      compatibility: fakeCompatibility(),
    });
    expect(await searchAvailabilitySlots(missing, searchInput())).toEqual(
      noCompatibleSlot("no_published_slots"),
    );
    const inactive = searchDeps(auth, {
      availability: fakeAvailability({ blocks: dailyInPersonBlocks("user-pro", "space-1") }),
      compatibility: fakeCompatibility({
        spaces: { "space-1": { space: fictitiousSpace, isActive: false, satisfiedNeeds: [] } },
      }),
    });
    expect(await searchAvailabilitySlots(inactive, searchInput())).toEqual(
      noCompatibleSlot("no_published_slots"),
    );
  });

  test("versión, límite, rango y zona inválidos responden conflicto sin filtrar", async () => {
    const auth = studentSearchAuth();
    const deps = searchDeps(auth);
    expect(await searchAvailabilitySlots(deps, searchInput({ version: "v9" }))).toEqual(CONFLICT);
    expect(await searchAvailabilitySlots(deps, searchInput({ limit: 0 }))).toEqual(CONFLICT);
    expect(
      await searchAvailabilitySlots(
        deps,
        searchInput({ limit: SEARCH_AVAILABILITY_PAGE_LIMIT_MAX + 1 }),
      ),
    ).toEqual(CONFLICT);
    expect(
      await searchAvailabilitySlots(deps, searchInput({ from: "2026-10-27", to: "2026-10-26" })),
    ).toEqual(CONFLICT);
    expect(
      await searchAvailabilitySlots(deps, searchInput({ timeZone: "Zona/Inexistente" })),
    ).toEqual(CONFLICT);
  });

  test("la página acota resultados y el cursor avanza sin exponer el calendario completo", async () => {
    const auth = studentSearchAuth();
    const deps = searchDeps(auth);
    const range = searchInput({ from: "2026-10-26", to: "2026-10-28", limit: 2 });
    const first = requireAvailable(await searchAvailabilitySlots(deps, range));
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = requireAvailable(
      await searchAvailabilitySlots(deps, { ...range, cursor: first.nextCursor ?? undefined }),
    );
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
  });

  test("la página que sigue al último cupo llega vacía, no como ausencia de horario", async () => {
    // Hay cupos compatibles: pedir la página siguiente al último no es una
    // ausencia de horario compatible ni un conflicto.
    const deps = searchDeps(studentSearchAuth());
    const range = searchInput({ from: "2026-10-26", to: "2026-10-26" });
    const first = requireAvailable(await searchAvailabilitySlots(deps, range));
    const last = first.items[first.items.length - 1];
    if (last === undefined) throw new Error("La primera página debe traer un cupo");
    expect(await searchAvailabilitySlots(deps, { ...range, cursor: last.id })).toEqual({
      status: "ok",
      data: {
        status: "available",
        items: [],
        hasMore: false,
        nextCursor: null,
        version: AVAILABILITY_CONTRACT_VERSION,
      },
    });
  });

  test("el cursor ocupado entre páginas responde conflicto sin repetir resultados", async () => {
    const auth = studentSearchAuth();
    const occupancy = fakeOccupancy();
    const deps = searchDeps(auth, { occupancy });
    const range = searchInput({ from: "2026-10-26", to: "2026-10-27", limit: 1 });
    const first = requireAvailable(await searchAvailabilitySlots(deps, range));
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);

    const cursorSlot = first.items[0];
    if (cursorSlot === undefined) throw new Error("La primera página debe traer un cupo");
    occupancy.occupiedStarts.add(cursorSlot.startAt);
    expect(await searchAvailabilitySlots(deps, { ...range, cursor: cursorSlot.id })).toEqual(
      CONFLICT,
    );
  });
});

describe("lectura de la disponibilidad propia (TI2-111)", () => {
  const ownException: StoredAvailabilityException = {
    id: "exc-1",
    professionalId: "user-pro",
    date: "2026-11-02",
    kind: "cancelled",
    reason: "Motivo ficticio",
    version: AVAILABILITY_CONTRACT_VERSION,
  };

  /** Lector que registra con qué profesional y rango se le consulta. */
  function recordingStore(data: {
    readonly exceptionsResult?: ApiResult<readonly StoredAvailabilityException[]>;
  }) {
    const base = fakeAvailability({ blocks: dailyOnlineBlocks("user-pro").slice(0, 2) });
    const queries: unknown[] = [];
    const store: AvailabilityReader = {
      ...base,
      listActiveBlocks: async (professionalId) => {
        queries.push({ blocksOf: professionalId });
        return await base.listActiveBlocks(professionalId);
      },
      listExceptions: async (range) => {
        queries.push({ exceptionsOf: range });
        return data.exceptionsResult ?? { status: "ok", data: [ownException] };
      },
    };
    return { store, queries };
  }

  test("el profesional lee sus bloques vigentes en la forma del contrato y sus excepciones del rango", async () => {
    const { store, queries } = recordingStore({});
    const result = requireOk(
      await listOwnAvailability(fakeAuth({ profiles: [professional] }), store, {
        tokenIdentifier: "token-pro",
        from: "2026-11-01",
        to: "2026-11-30",
      }),
    );
    // Sin `isActive`: todo lo listado está vigente.
    expect(result.blocks).toEqual(
      dailyOnlineBlocks("user-pro")
        .slice(0, 2)
        .map(({ isActive: _isActive, ...block }) => block),
    );
    expect(result.blocks.every((block) => !("isActive" in block))).toBe(true);
    expect(result.exceptions).toEqual([ownException]);
    // El profesional sale de la identidad del servidor, nunca de la entrada.
    expect(queries).toEqual([
      { blocksOf: "user-pro" },
      { exceptionsOf: { professionalId: "user-pro", from: "2026-11-01", to: "2026-11-30" } },
    ]);
  });

  test("quien no es profesional vigente no lee nada", async () => {
    const callers = [
      { auth: fakeAuth({ profiles: [student] }), tokenIdentifier: "token-student" },
      { auth: fakeAuth({ profiles: [intern] }), tokenIdentifier: "token-intern" },
      {
        auth: fakeAuth({ profiles: [{ ...professional, accountStatus: "inactive" }] }),
        tokenIdentifier: "token-pro",
      },
      { auth: fakeAuth({ profiles: [professional] }), tokenIdentifier: null },
    ];
    for (const caller of callers) {
      const { store, queries } = recordingStore({});
      expect(
        await listOwnAvailability(caller.auth, store, {
          tokenIdentifier: caller.tokenIdentifier,
          from: "2026-11-01",
          to: "2026-11-30",
        }),
      ).toEqual(DENIED);
      expect(queries).toEqual([]);
    }
  });

  test("un rango inválido o un tope superado responde conflicto sin lista cortada", async () => {
    const { store } = recordingStore({
      exceptionsResult: {
        status: "error",
        error: {
          code: "conflict",
          message: "La solicitud entra en conflicto con el estado actual.",
        },
      },
    });
    expect(
      await listOwnAvailability(fakeAuth({ profiles: [professional] }), store, {
        tokenIdentifier: "token-pro",
        from: "2026-11-30",
        to: "2026-11-01",
      }),
    ).toEqual(CONFLICT);
    // Más bloques vigentes que el tope: tampoco se entrega una lista cortada.
    const { store: overCap } = recordingStore({});
    expect(
      await listOwnAvailability(
        fakeAuth({ profiles: [professional] }),
        {
          ...overCap,
          listActiveBlocks: async () => ({
            status: "error",
            error: {
              code: "conflict",
              message: "La solicitud entra en conflicto con el estado actual.",
            },
          }),
        },
        { tokenIdentifier: "token-pro", from: "2026-11-01", to: "2026-11-30" },
      ),
    ).toEqual(CONFLICT);
  });
});

describe("profesionales reservables del acompañamiento (TI2-123)", () => {
  const input = { tokenIdentifier: "token-student", accompanimentId: "acc-1" };

  test("entrega solo a quien la búsqueda aceptaría", async () => {
    await expect(
      listBookableProfessionals(
        {
          auth: studentSearchAuth(),
          professionals: { listActiveProfessionalIds: async () => ["user-pro", "user-sin-perfil"] },
        },
        input,
      ),
    ).resolves.toEqual({
      status: "ok",
      data: { professionalIds: ["user-pro"], version: AVAILABILITY_CONTRACT_VERSION },
    });
  });

  test("sin profesionales responde una lista vacía, no falta de cupo", async () => {
    await expect(
      listBookableProfessionals(
        {
          auth: studentSearchAuth(),
          professionals: { listActiveProfessionalIds: async () => [] },
        },
        input,
      ),
    ).resolves.toEqual({
      status: "ok",
      data: { professionalIds: [], version: AVAILABILITY_CONTRACT_VERSION },
    });
  });

  test("una lectura que no alcanzó responde conflict, nunca una lista cortada", async () => {
    await expect(
      listBookableProfessionals(
        {
          auth: studentSearchAuth(),
          professionals: { listActiveProfessionalIds: async () => null },
        },
        input,
      ),
    ).resolves.toEqual(CONFLICT);
  });

  test("deniega sin leer candidatos a quien no puede ver la agenda", async () => {
    let reads = 0;
    await expect(
      listBookableProfessionals(
        {
          auth: studentSearchAuth(),
          professionals: {
            listActiveProfessionalIds: async () => {
              reads += 1;
              return ["user-pro"];
            },
          },
        },
        { ...input, tokenIdentifier: "token-desconocido" },
      ),
    ).resolves.toEqual(DENIED);
    expect(reads).toBe(0);
  });
});
