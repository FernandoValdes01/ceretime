/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

// `createTestRequest` es una semilla guardada: solo opera con el interruptor
// activado, como en `database.test.ts` (aislado por archivo).
vi.stubEnv("TEST_SEEDS_ENABLED", "true");

/**
 * Permisos base de los cuatro roles (TI2-12).
 *
 * Cubre las celdas que la matriz de TI2-12, en `docs/`, marcaba sin
 * prueba. Cada escenario tiene una prueba de control donde quien
 * corresponde sí opera: sin ella, un escenario mal armado haría pasar los
 * rechazos por cualquier motivo. Basta demostrar el rechazo: Convex descarta
 * lo que escribió una mutación que lanza. Datos ficticios.
 */

const ISSUER = "https://accounts.google.com";

// Exacto y no por inclusión: un mensaje que agregue el motivo debe fallar.
const DENIED = /^No autorizado$/;

type Role = "student" | "professional" | "intern" | "admin";
type TestConvex = ReturnType<typeof convexTest>;
type Caller = Pick<TestConvex, "query" | "mutation">;

const ACCOUNTS: Record<Role, { subject: string; email: string; label: string }> = {
  student: { subject: "ti12-est", email: "ti12-est@alu.uct.cl", label: "el Estudiante" },
  professional: { subject: "ti12-pro", email: "ti12-pro@uct.cl", label: "el Profesional" },
  intern: { subject: "ti12-int", email: "ti12-int@alu.uct.cl", label: "el Practicante" },
  admin: { subject: "ti12-adm", email: "ti12-adm@uct.cl", label: "el Administrador" },
};

const PAGE = { numItems: 10, cursor: null };

function asRole(t: TestConvex, role: Role): Caller {
  const { subject, email } = ACCOUNTS[role];
  return t.withIdentity({
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email,
    name: "Ficticio",
  });
}

async function seedAccounts(t: TestConvex) {
  const ids = {} as Record<Role, Id<"users">>;
  for (const role of Object.keys(ACCOUNTS) as Array<Role>) {
    const { subject, email } = ACCOUNTS[role];
    ids[role] = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email,
        fullName: "Ficticio",
        role,
        institutionalStatus: "enabled",
        accountStatus: "active",
        tokenIdentifier: `${ISSUER}|${subject}`,
      });
    });
  }
  return ids;
}

/** Una solicitud recibida sin toma y otra en revisión tomada por el Profesional. */
async function seedRequests(t: TestConvex) {
  const ids = await seedAccounts(t);
  const received = await t.mutation(internal.requests.createTestRequest, {
    studentId: ids.student,
    status: "received",
    accessNeeds: "Necesidad de acceso ficticia",
  });
  const underReview = await t.mutation(internal.requests.createTestRequest, {
    studentId: ids.student,
    status: "received",
    accessNeeds: "Necesidad de acceso ficticia",
  });
  await asRole(t, "professional").mutation(api.presentation.requests.takeRequest, {
    requestId: underReview,
  });
  return { ids, received, underReview };
}

type RequestScenario = Awaited<ReturnType<typeof seedRequests>>;

type RequestOperation = {
  name: string;
  allowed: Role;
  call: (caller: Caller, scenario: RequestScenario) => Promise<unknown>;
};

const LIST_OPEN_REQUESTS: RequestOperation = {
  name: "ver la bandeja de recibidas",
  allowed: "professional",
  call: (caller) =>
    caller.query(api.presentation.requests.listOpenRequests, { paginationOpts: PAGE }),
};

const TAKE_REQUEST: RequestOperation = {
  name: "tomar una solicitud",
  allowed: "professional",
  call: (caller, scenario) =>
    caller.mutation(api.presentation.requests.takeRequest, { requestId: scenario.received }),
};

const REQUEST_OPERATIONS: Array<RequestOperation> = [
  {
    name: "registrar una solicitud",
    allowed: "student",
    call: (caller) =>
      caller.mutation(api.presentation.requests.createRequest, {
        accessNeeds: "Necesidad de acceso ficticia",
      }),
  },
  {
    name: "listar sus solicitudes propias",
    allowed: "student",
    call: (caller) =>
      caller.query(api.presentation.requests.listOwnRequests, { paginationOpts: PAGE }),
  },
  {
    name: "listar las solicitudes tomadas",
    allowed: "professional",
    call: (caller) =>
      caller.query(api.presentation.requests.listAuthorizedRequests, { paginationOpts: PAGE }),
  },
  LIST_OPEN_REQUESTS,
  TAKE_REQUEST,
  {
    name: "pedir información adicional",
    allowed: "professional",
    call: (caller, scenario) =>
      caller.mutation(api.presentation.requests.requestAdditionalInformation, {
        requestId: scenario.underReview,
        reason: "Falta el horario disponible",
      }),
  },
  {
    name: "aceptar una solicitud",
    allowed: "professional",
    call: (caller, scenario) =>
      caller.mutation(api.presentation.requests.acceptRequest, {
        requestId: scenario.underReview,
        objective: "Objetivo ficticio",
      }),
  },
];

const TRIAGE_OPERATIONS = [LIST_OPEN_REQUESTS, TAKE_REQUEST];

describe("solicitudes: control del escenario (TI2-12)", () => {
  const controls = REQUEST_OPERATIONS.map((operation) => ({
    ...operation,
    who: ACCOUNTS[operation.allowed].label,
  }));

  test.each(controls)("$who puede $name", async (operation) => {
    const t = convexTest(schema, modules);
    const scenario = await seedRequests(t);

    await expect(operation.call(asRole(t, operation.allowed), scenario)).resolves.toBeDefined();
  });
});

describe.each([
  { role: "intern" as const, label: ACCOUNTS.intern.label },
  { role: "admin" as const, label: ACCOUNTS.admin.label },
])("solicitudes con $label (TI2-12)", ({ role, label }) => {
  test.each(REQUEST_OPERATIONS)(`${label} no puede $name`, async (operation) => {
    const t = convexTest(schema, modules);
    const scenario = await seedRequests(t);

    await expect(operation.call(asRole(t, role), scenario)).rejects.toThrow(DENIED);
  });
});

describe("bandeja y toma fuera del Profesional (TI2-12)", () => {
  test.each(TRIAGE_OPERATIONS)("el Estudiante no puede $name", async (operation) => {
    const t = convexTest(schema, modules);
    const scenario = await seedRequests(t);

    await expect(operation.call(asRole(t, "student"), scenario)).rejects.toThrow(DENIED);
  });

  test.each(TRIAGE_OPERATIONS)("sin identidad no se puede $name", async (operation) => {
    const t = convexTest(schema, modules);
    const scenario = await seedRequests(t);

    await expect(operation.call(t, scenario)).rejects.toThrow(DENIED);
  });
});

describe("perfil propio del personal (TI2-12)", () => {
  test.each([
    { role: "professional" as const, label: ACCOUNTS.professional.label },
    { role: "intern" as const, label: ACCOUNTS.intern.label },
    { role: "admin" as const, label: ACCOUNTS.admin.label },
  ])("$label consulta solo su propio perfil", async ({ role }) => {
    const t = convexTest(schema, modules);
    await seedAccounts(t);

    const profile = await asRole(t, role).query(api.presentation.session.getMyProfile, {});
    expect(profile).toEqual({
      fullName: "Ficticio",
      email: ACCOUNTS[role].email,
      role,
      institutionalStatus: "enabled",
      accountStatus: "active",
    });
    expect(profile).not.toHaveProperty("tokenIdentifier");
  });
});

/**
 * Un acompañamiento del Estudiante abierto por la aceptación real, con el
 * Profesional asignado por TI2-24, el Practicante asignado por él y una
 * nota interna.
 */
async function seedAccompaniment(t: TestConvex) {
  const { ids, underReview } = await seedRequests(t);
  const accompaniment = await asRole(t, "professional").mutation(
    api.presentation.requests.acceptRequest,
    { requestId: underReview, objective: "Objetivo ficticio" },
  );
  await asRole(t, "professional").mutation(internal.assignments.assign, {
    accompanimentId: accompaniment._id,
    userId: ids.intern,
    assignedRole: "intern",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("followUpNotes", {
      accompanimentId: accompaniment._id,
      authorId: ids.professional,
      body: "Nota interna ficticia",
    });
  });
  return accompaniment._id;
}

describe("acompañamientos por rol (TI2-12)", () => {
  test("control: cada listado y las notas responden a su rol", async () => {
    const t = convexTest(schema, modules);
    const accompanimentId = await seedAccompaniment(t);

    const owned = await asRole(t, "student").query(
      api.presentation.accompaniments.listOwnedAccompaniments,
      { paginationOpts: PAGE },
    );
    expect(owned.page.map((item) => item._id)).toEqual([accompanimentId]);
    for (const role of ["professional", "intern"] as const) {
      const assigned = await asRole(t, role).query(
        api.presentation.accompaniments.listAssignedAccompaniments,
        { limit: 10 },
      );
      expect(assigned.items.map((item) => item._id)).toEqual([accompanimentId]);
    }
    const notes = await asRole(t, "professional").query(
      api.presentation.accompaniments.getInternalNotes,
      { accompanimentId, paginationOpts: PAGE },
    );
    expect(notes.page).toHaveLength(1);
  });

  // El Practicante ya lo prueba `practitionerMinimization` (TI2-25).
  test("el Profesional asignado no lista acompañamientos como propios", async () => {
    const t = convexTest(schema, modules);
    await seedAccompaniment(t);

    await expect(
      asRole(t, "professional").query(api.presentation.accompaniments.listOwnedAccompaniments, {
        paginationOpts: PAGE,
      }),
    ).rejects.toThrow(DENIED);
  });

  test("el Estudiante no lista acompañamientos como asignados", async () => {
    const t = convexTest(schema, modules);
    await seedAccompaniment(t);

    await expect(
      asRole(t, "student").query(api.presentation.accompaniments.listAssignedAccompaniments, {
        limit: 10,
      }),
    ).rejects.toThrow(DENIED);
  });

  test("sin identidad no se listan acompañamientos propios ni asignados", async () => {
    const t = convexTest(schema, modules);
    await seedAccompaniment(t);

    await expect(
      t.query(api.presentation.accompaniments.listOwnedAccompaniments, { paginationOpts: PAGE }),
    ).rejects.toThrow(DENIED);
    await expect(
      t.query(api.presentation.accompaniments.listAssignedAccompaniments, { limit: 10 }),
    ).rejects.toThrow(DENIED);
  });

  test("sin identidad no se leen notas internas", async () => {
    const t = convexTest(schema, modules);
    const accompanimentId = await seedAccompaniment(t);

    await expect(
      t.query(api.presentation.accompaniments.getInternalNotes, {
        accompanimentId,
        paginationOpts: PAGE,
      }),
    ).rejects.toThrow(DENIED);
  });
});
