import { describe, expect, test } from "vitest";
import type { ApiResult } from "../../domain/errors/api_error";
import {
  AVAILABILITY_CONTRACT_VERSION,
  type AvailabilityBlock,
} from "../../domain/availability/availability";
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
const NO_AVAILABILITY = {
  status: "error",
  error: {
    code: "no_availability",
    message: "Sin cupo disponible. Coordina por el canal oficial con la referencia indicada.",
  },
};

/** Extrae el éxito o falla la prueba sin `expect` condicional (regla de lint). */
function requireOk<T>(result: ApiResult<T>): T {
  if (result.status !== "ok") throw new Error(`Se esperaba éxito y llegó ${result.error.code}`);
  return result.data;
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
    const studentAuth = fakeAuth({ profiles: [student], accompaniments: [activeAccompaniment] });
    const studentData = requireOk(
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
    const studentAuth = fakeAuth({ profiles: [student], accompaniments: [activeAccompaniment] });
    const missing = await searchAvailabilitySlots(
      searchDeps(studentAuth),
      searchInput({ accompanimentId: "acc-inexistente" }),
    );
    expect(internResult).toEqual(DENIED);
    expect(missing).toEqual(DENIED);
  });

  test("sin necesidades resueltas la búsqueda responde conflicto sin filtrar", async () => {
    const auth = fakeAuth({ profiles: [student], accompaniments: [activeAccompaniment] });
    const deps = searchDeps(auth, {
      needs: { findAccompanimentNeeds: async () => null },
    });
    expect(await searchAvailabilitySlots(deps, searchInput())).toEqual(CONFLICT);
  });

  test("el tope de lectura superado responde conflicto sin lista cortada", async () => {
    const auth = fakeAuth({ profiles: [student], accompaniments: [activeAccompaniment] });
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

  test("sin bloques el vacío responde ausencia de cupo para coordinar por el canal oficial", async () => {
    const auth = fakeAuth({ profiles: [student], accompaniments: [activeAccompaniment] });
    const deps = searchDeps(auth, { availability: fakeAvailability({ blocks: [] }) });
    expect(await searchAvailabilitySlots(deps, searchInput())).toEqual(NO_AVAILABILITY);
  });

  test("el cupo ocupado se descuenta y el vacío responde ausencia de cupo", async () => {
    const auth = fakeAuth({ profiles: [student], accompaniments: [activeAccompaniment] });
    const deps = searchDeps(auth, { occupancy: fakeOccupancy({ occupyAll: true }) });
    expect(await searchAvailabilitySlots(deps, searchInput())).toEqual(NO_AVAILABILITY);
  });

  test("el intervalo decide: conserva el cupo contiguo y descarta el solapado con igual inicio", async () => {
    const auth = fakeAuth({ profiles: [student], accompaniments: [activeAccompaniment] });
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
    const first = requireOk(await searchAvailabilitySlots(probe, searchInput()));
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
    const second = requireOk(await searchAvailabilitySlots(deps, searchInput()));
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.endAt).toBe(short.endAt);

    // Igual inicio con distinto fin genera consultas distintas.
    expect(occupancy.received).toHaveLength(2);
    expect(occupancy.received[0]?.startAt).toBe(occupancy.received[1]?.startAt);
    expect(occupancy.received[0]?.endAt).not.toBe(occupancy.received[1]?.endAt);
  });

  test("la necesidad sin cobertura no se rebaja: responde ausencia de cupo", async () => {
    const auth = fakeAuth({ profiles: [student], accompaniments: [activeAccompaniment] });
    const deps = searchDeps(auth, {
      needs: fakeNeeds([{ id: "need-1", label: "Sala accesible" }]),
    });
    expect(await searchAvailabilitySlots(deps, searchInput())).toEqual(NO_AVAILABILITY);
  });

  test("el cupo presencial con sala vigente que cubre las necesidades se ofrece", async () => {
    const auth = fakeAuth({ profiles: [student], accompaniments: [activeAccompaniment] });
    const need = { id: "need-1", label: "Sala accesible" };
    const deps = searchDeps(auth, {
      availability: fakeAvailability({ blocks: dailyInPersonBlocks("user-pro", "space-1") }),
      needs: fakeNeeds([need]),
      compatibility: fakeCompatibility({
        spaces: { "space-1": { space: fictitiousSpace, isActive: true, satisfiedNeeds: [need] } },
      }),
    });
    const data = requireOk(await searchAvailabilitySlots(deps, searchInput()));
    expect(data.items).toHaveLength(1);
    expect(data.items[0]?.spaceId).toBe("space-1");
  });

  test("la sala retirada no se ofrece y el vacío responde ausencia de cupo", async () => {
    const auth = fakeAuth({ profiles: [student], accompaniments: [activeAccompaniment] });
    const deps = searchDeps(auth, {
      availability: fakeAvailability({ blocks: dailyInPersonBlocks("user-pro", "space-1") }),
      compatibility: fakeCompatibility(),
    });
    expect(await searchAvailabilitySlots(deps, searchInput())).toEqual(NO_AVAILABILITY);
  });

  test("versión, límite, rango y zona inválidos responden conflicto sin filtrar", async () => {
    const auth = fakeAuth({ profiles: [student], accompaniments: [activeAccompaniment] });
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
    const auth = fakeAuth({ profiles: [student], accompaniments: [activeAccompaniment] });
    const deps = searchDeps(auth);
    const range = searchInput({ from: "2026-10-26", to: "2026-10-28", limit: 2 });
    const first = requireOk(await searchAvailabilitySlots(deps, range));
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = requireOk(
      await searchAvailabilitySlots(deps, { ...range, cursor: first.nextCursor ?? undefined }),
    );
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
  });

  test("el cursor ocupado entre páginas responde conflicto sin repetir resultados", async () => {
    const auth = fakeAuth({ profiles: [student], accompaniments: [activeAccompaniment] });
    const occupancy = fakeOccupancy();
    const deps = searchDeps(auth, { occupancy });
    const range = searchInput({ from: "2026-10-26", to: "2026-10-27", limit: 1 });
    const first = requireOk(await searchAvailabilitySlots(deps, range));
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
