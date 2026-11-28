import { describe, expect, test } from "vitest";
import type { ApiResult } from "../../domain/errors/api_error";
import {
  AVAILABILITY_CONTRACT_VERSION,
  type AvailabilitySearchResult,
} from "../../domain/availability/availability";
import { toOfficialChannelCoordination } from "../../domain/availability/official_channel";
import type { AccessNeed } from "../../domain/requests/request";
import type {
  AuthorizableAgendaAccompaniment,
  AuthorizableAssignment,
  AuthorizableProfile,
  AuthorizationReader,
} from "../authorization/authorize";
import {
  searchAccompanimentSlots,
  type SearchAccompanimentSlotsDeps,
  type SearchAccompanimentSlotsInput,
} from "./accompaniment_slots";
import type { AvailabilityReader, StoredAvailabilityBlock } from "./ports";

/*
 * TI4-84 (parte de Convex de TI4-70): búsqueda de horarios por acompañamiento
 * con dobles en memoria. Cada doble anota lo que se le pidió, así se cuentan
 * las comprobaciones de ocupación.
 */

type FakeProfile = AuthorizableProfile & { readonly tokenIdentifier: string };

function profile(id: string, role: FakeProfile["role"]): FakeProfile {
  return {
    _id: id,
    role,
    institutionalStatus: "enabled",
    accountStatus: "active",
    tokenIdentifier: `token-${id}`,
  };
}

const STUDENT = profile("est", "student");
const PRO_A = profile("pro-a", "professional");
const PRO_B = profile("pro-b", "professional");
const INTERN = profile("int", "intern");

const ACCOMPANIMENT: AuthorizableAgendaAccompaniment = {
  _id: "acc-1",
  studentId: "est",
  status: "active",
};

function assignment(userId: string, assignedRole: "professional" | "intern" = "professional") {
  return { accompanimentId: "acc-1", userId, assignedRole, status: "active" } as const;
}

function fakeAuth(assignments: readonly AuthorizableAssignment[]): AuthorizationReader {
  const profiles = [STUDENT, PRO_A, PRO_B, INTERN];
  return {
    findProfileByTokenIdentifier: async (tokenIdentifier) =>
      profiles.find((row) => row.tokenIdentifier === tokenIdentifier) ?? null,
    getProfileById: async (userId) => profiles.find((row) => row._id === userId) ?? null,
    getAccompaniment: async (accompanimentId) =>
      accompanimentId === ACCOMPANIMENT._id ? ACCOMPANIMENT : null,
    findActiveAssignments: async (accompanimentId, userId) =>
      assignments.filter((row) => row.accompanimentId === accompanimentId && row.userId === userId),
  };
}

/** Un cupo en línea de 9:00 a 10:00 cada día, igual para todos los profesionales. */
function dailyOnlineBlocks(professionalId: string): StoredAvailabilityBlock[] {
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    id: `block-${professionalId}-${weekday}`,
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

function fakeAvailability(failing: readonly string[] = []): AvailabilityReader {
  return {
    getBlock: async () => null,
    listActiveBlocks: async (professionalId) =>
      failing.includes(professionalId)
        ? { status: "error", error: { code: "conflict", message: "Lectura truncada" } }
        : { status: "ok", data: dailyOnlineBlocks(professionalId) },
    getException: async () => null,
    listExceptions: async () => ({ status: "ok", data: [] }),
  };
}

function world(
  options: {
    readonly professionals?: readonly string[];
    readonly loads?: Readonly<Record<string, number>>;
    readonly failing?: readonly string[];
    readonly needs?: readonly AccessNeed[];
  } = {},
) {
  const professionals = options.professionals ?? ["pro-a", "pro-b"];
  const occupied = new Set<string>();
  const checks: { readonly professionalId: string; readonly startAt: number }[] = [];
  const deps: SearchAccompanimentSlotsDeps = {
    auth: fakeAuth([assignment("pro-a"), assignment("pro-b"), assignment("int", "intern")]),
    professionals: { listActiveProfessionalIds: async () => professionals },
    availability: fakeAvailability(options.failing),
    needs: {
      findAccompanimentNeeds: async () => ({ _id: "acc-1", needs: options.needs ?? [] }),
    },
    compatibility: {
      findCompatibilitySpace: async () => null,
      listOnlineSupports: async () => [],
    },
    occupancy: {
      isSlotOccupied: async ({ professionalId, startAt }) => {
        checks.push({ professionalId, startAt });
        return occupied.has(`${professionalId}:${startAt}`);
      },
    },
    load: {
      countProfessionalAppointments: async ({ professionalId }) =>
        options.loads?.[professionalId] ?? 0,
    },
  };
  return { deps, occupied, checks };
}

function input(
  overrides: Partial<SearchAccompanimentSlotsInput> = {},
): SearchAccompanimentSlotsInput {
  return {
    tokenIdentifier: "token-est",
    accompanimentId: "acc-1",
    from: "2026-10-26",
    to: "2026-10-28",
    timeZone: "America/Santiago",
    limit: 1,
    version: AVAILABILITY_CONTRACT_VERSION,
    ...overrides,
  };
}

function requireAvailable(result: ApiResult<AvailabilitySearchResult>) {
  if (result.status !== "ok") throw new Error(`Se esperaba éxito y llegó ${result.error.code}`);
  if (result.data.status !== "available") throw new Error("Se esperaban cupos");
  return result.data;
}

describe("searchAccompanimentSlots (TI4-84)", () => {
  test("agrupa los cupos equivalentes de varios profesionales y los ordena por inicio", async () => {
    const { deps } = world();
    const page = requireAvailable(await searchAccompanimentSlots(deps, input({ limit: 10 })));
    expect(page.items.map((slot) => slot.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"]);
    // Mismo inicio, misma carga: gana el menor identificador.
    expect(page.items.map((slot) => slot.professionalId)).toEqual(["pro-a", "pro-a", "pro-a"]);
    expect(page.hasMore).toBe(false);
  });

  test("la segunda página no vuelve a comprobar la ocupación de la primera", async () => {
    const { deps, checks } = world();
    const first = requireAvailable(await searchAccompanimentSlots(deps, input()));
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const firstStart = first.items[0]?.startAt;
    // Para llenar una página de 1 y saber si hay más basta comprobar dos grupos.
    expect(checks).toHaveLength(2);

    checks.length = 0;
    const second = requireAvailable(
      await searchAccompanimentSlots(deps, input({ cursor: first.nextCursor ?? undefined })),
    );
    expect(second.items[0]?.startAt).toBeGreaterThan(firstStart ?? Infinity);
    expect(checks.map((check) => check.startAt)).not.toContain(firstStart);
    expect(checks).toHaveLength(2);
  });

  test("el mismo resultado con los profesionales en otro orden", async () => {
    const ab = requireAvailable(await searchAccompanimentSlots(world().deps, input({ limit: 10 })));
    const ba = requireAvailable(
      await searchAccompanimentSlots(
        world({ professionals: ["pro-b", "pro-a"] }).deps,
        input({ limit: 10 }),
      ),
    );
    expect(ba).toEqual(ab);
  });

  test("ofrece al profesional con menos atenciones esa semana", async () => {
    const { deps } = world({ loads: { "pro-a": 3, "pro-b": 1 } });
    const page = requireAvailable(await searchAccompanimentSlots(deps, input({ limit: 10 })));
    expect(page.items.every((slot) => slot.professionalId === "pro-b")).toBe(true);
  });

  test("si el preferido está ocupado ofrece al otro profesional del grupo", async () => {
    const { deps, occupied } = world();
    const first = requireAvailable(await searchAccompanimentSlots(deps, input({ limit: 10 })));
    const start = first.items[0]?.startAt ?? 0;
    occupied.add(`pro-a:${start}`);
    const again = requireAvailable(await searchAccompanimentSlots(deps, input({ limit: 10 })));
    expect(again.items[0]).toMatchObject({ startAt: start, professionalId: "pro-b" });
  });

  test("el cursor sigue sirviendo aunque se ocupe un cupo entre consultas", async () => {
    const { deps, occupied } = world();
    const first = requireAvailable(await searchAccompanimentSlots(deps, input()));
    const start = first.items[0]?.startAt ?? 0;
    occupied.add(`pro-a:${start}`);
    occupied.add(`pro-b:${start}`);
    const second = requireAvailable(
      await searchAccompanimentSlots(deps, input({ cursor: first.nextCursor ?? undefined })),
    );
    expect(second.items[0]?.date).toBe("2026-10-27");
  });

  test("un profesional que falla no impide ofrecer los cupos de los demás", async () => {
    const { deps } = world({ failing: ["pro-a"] });
    const page = requireAvailable(await searchAccompanimentSlots(deps, input({ limit: 10 })));
    expect(page.items.map((slot) => slot.professionalId)).toEqual(["pro-b", "pro-b", "pro-b"]);
    const allFail = world({ failing: ["pro-a", "pro-b"] });
    expect(await searchAccompanimentSlots(allFail.deps, input())).toMatchObject({
      status: "error",
      error: { code: "conflict" },
    });
  });

  test("sin cupo libre en ningún profesional responde no_compatible_slot con su motivo", async () => {
    const { deps, occupied } = world();
    for (const professionalId of ["pro-a", "pro-b"]) {
      const page = requireAvailable(
        await searchAccompanimentSlots(world().deps, input({ limit: 10 })),
      );
      for (const slot of page.items) occupied.add(`${professionalId}:${slot.startAt}`);
    }
    expect(await searchAccompanimentSlots(deps, input({ limit: 10 }))).toEqual({
      status: "ok",
      data: {
        status: "no_compatible_slot",
        coordination: toOfficialChannelCoordination("acc-1", "slots_occupied"),
        version: AVAILABILITY_CONTRACT_VERSION,
      },
    });
    const nobody = world({ professionals: [] });
    expect(await searchAccompanimentSlots(nobody.deps, input())).toMatchObject({
      status: "ok",
      data: { coordination: { reason: "no_published_slots" } },
    });
  });

  test("la autorización es la de searchSlots", async () => {
    const { deps } = world();
    for (const tokenIdentifier of ["token-int", "token-desconocido", null]) {
      expect(await searchAccompanimentSlots(deps, input({ tokenIdentifier }))).toEqual({
        status: "error",
        error: { code: "unauthorized", message: "No autorizado" },
      });
    }
    expect(
      await searchAccompanimentSlots(deps, input({ tokenIdentifier: "token-pro-a" })),
    ).toMatchObject({ status: "ok" });
  });

  test("un bloqueo temporal de las atenciones del titular deniega la búsqueda (TI2-168)", async () => {
    const { deps } = world();
    const blocked: SearchAccompanimentSlotsDeps = {
      ...deps,
      auth: {
        ...deps.auth,
        listActivePrivacyBlocks: async () => [
          {
            id: "bloqueo-1",
            scope: "all_personal_data",
            startsAt: 0,
            endsAt: Number.MAX_SAFE_INTEGER,
          },
        ],
      },
    };
    expect(await searchAccompanimentSlots(blocked, input())).toEqual({
      status: "error",
      error: { code: "unauthorized", message: "No autorizado" },
    });
  });

  test("un cursor que esta búsqueda no emitió responde conflict", async () => {
    const { deps } = world();
    expect(
      await searchAccompanimentSlots(deps, input({ cursor: "pro-a:2026-10-26:1" })),
    ).toMatchObject({ status: "error", error: { code: "conflict" } });
  });
});
