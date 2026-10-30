/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type {
  AccompanimentNeedsReader,
  AvailabilityReader,
  AvailabilityWriter,
  CompatibilitySpaceSource,
} from "../application/availability/ports";
import type { SpaceReader } from "../application/spaces/ports";
import { expandAvailabilitySlots } from "../domain/availability/availability";
import { toAccompanimentRequest } from "../domain/requests/request";
import { transitionRequest } from "../domain/requests/transition_policy";
import { assessCompatibility } from "../domain/spaces/compatibility";
import { SPACE_CATALOG_CONTRACT_VERSION } from "../domain/spaces/space";
import { accompanimentNeedsReader } from "../infrastructure/accompaniments/repository";
import {
  availabilityReader,
  availabilityWriter,
  MAX_ACTIVE_BLOCKS,
  MAX_EXCEPTIONS_IN_RANGE,
} from "../infrastructure/availability/repository";
import {
  accessNeedsFromLines,
  compatibilitySpaceSource,
  findSpaceRowByLocation,
  getSpaceRow,
  insertSpace,
  spaceReader,
} from "../infrastructure/spaces/repository";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

// Las semillas guardadas solo operan con el interruptor activado, igual que
// en `users.test.ts` (aislado por archivo).
vi.stubEnv("TEST_SEEDS_ENABLED", "true");

/**
 * Database mínima de Sprint 1 (TI2-17): migraciones, índices y pruebas.
 *
 * Cada prueba parte de una base vacía (`convexTest` con el esquema real), lo
 * que demuestra que la persistencia mínima se reproduce desde cero. Se cubre
 * que cada índice declarado responde (identidad y pertenencia), la unicidad
 * de identidad y correo, la integridad de escritura de asignaciones, la
 * trazabilidad mínima de las operaciones sensibles, el aislamiento del
 * Practicante mediante consultas de persistencia y la auditoría de filas
 * legacy. Todo opera con datos ficticios.
 */

const ISSUER = "https://accounts.google.com";

function identityFor(subject: string, email: string) {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email,
    name: "Ficticio",
  };
}

type SeedRole = "student" | "professional" | "intern" | "admin";

/** Usuario ficticio persistido con identidad vinculada. */
async function seedUser(
  t: ReturnType<typeof convexTest>,
  input: {
    subject: string;
    email: string;
    role: SeedRole;
    institutionalStatus?: "enabled" | "disabled" | "pending";
    accountStatus?: "active" | "inactive";
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: input.email,
      fullName: "Ficticio",
      role: input.role,
      institutionalStatus: input.institutionalStatus ?? "enabled",
      accountStatus: input.accountStatus ?? "active",
      tokenIdentifier: `${ISSUER}|${input.subject}`,
    });
  });
}

type Sprint1RequestStatus =
  | "received"
  | "under_review"
  | "awaiting_information_or_acceptance"
  | "accepted";

/** Solicitud ficticia del estudiante con fecha de creación fija. */
async function seedRequest(
  t: ReturnType<typeof convexTest>,
  studentId: Id<"users">,
  status: Sprint1RequestStatus,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("requests", {
      studentId,
      status,
      accessNeeds: "Necesidad de acceso ficticia",
      createdAt: 1,
    });
  });
}

/** Acompañamiento ficticio, vinculado a su solicitud cuando se conoce. */
async function seedAccompaniment(
  t: ReturnType<typeof convexTest>,
  studentId: Id<"users">,
  requestId?: Id<"requests">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad de acceso ficticia",
      ...(requestId === undefined ? {} : { requestId }),
    });
  });
}

test("índices por identidad: correo, token, rol y habilitación responden lo sembrado", async () => {
  const t = convexTest(schema, modules);
  const adminId = await seedUser(t, {
    subject: "ti17-adm-1",
    email: "adm1@uct.cl",
    role: "admin",
  });
  const internId = await seedUser(t, {
    subject: "ti17-int-1",
    email: "int1@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });

  const byEmail = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "adm1@uct.cl"))
      .take(1);
  });
  expect(byEmail.map((user) => user._id)).toEqual([adminId]);

  const byToken = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", `${ISSUER}|ti17-int-1`))
      .unique();
  });
  expect(byToken?._id).toEqual(internId);

  const pending = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_institutional_status", (q) => q.eq("institutionalStatus", "pending"))
      .take(10);
  });
  expect(pending.map((user) => user._id)).toEqual([internId]);

  const admins = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .take(10);
  });
  expect(admins.map((user) => user._id)).toEqual([adminId]);
});

test("unicidad de identidad: correo e identificador duplicados se rechazan", async () => {
  const t = convexTest(schema, modules);
  const profile = {
    email: "duplicado@alu.uct.cl",
    fullName: "Ficticio",
    role: "student" as const,
    institutionalStatus: "enabled" as const,
    accountStatus: "active" as const,
    tokenIdentifier: `${ISSUER}|ti17-duplicado-1`,
  };
  await t.mutation(internal.operations.users.createTestUser, profile);

  await expect(
    t.mutation(internal.operations.users.createTestUser, {
      ...profile,
      email: "otro@alu.uct.cl",
    }),
  ).rejects.toThrow("Ya existe un perfil");

  await expect(
    t.mutation(internal.operations.users.createTestUser, {
      ...profile,
      tokenIdentifier: `${ISSUER}|ti17-duplicado-2`,
    }),
  ).rejects.toThrow("Ya existe un perfil con este correo");

  await expect(
    t.mutation(internal.operations.users.createTestUser, {
      ...profile,
      email: "Duplicado@alu.uct.cl",
      tokenIdentifier: `${ISSUER}|ti17-duplicado-3`,
    }),
  ).rejects.toThrow("Ya existe un perfil con este correo");

  await expect(
    t.mutation(internal.operations.users.createTestUser, {
      ...profile,
      email: "  duplicado@alu.uct.cl  ",
      tokenIdentifier: `${ISSUER}|ti17-duplicado-4`,
    }),
  ).rejects.toThrow("Ya existe un perfil con este correo");
});

test("la semilla normaliza el correo antes de guardarlo", async () => {
  const t = convexTest(schema, modules);
  const createdId = await t.mutation(internal.operations.users.createTestUser, {
    email: "  Mezclado@alu.uct.cl  ",
    fullName: "Ficticio",
    role: "student" as const,
    institutionalStatus: "enabled" as const,
    accountStatus: "active" as const,
    tokenIdentifier: `${ISSUER}|ti17-mezclado-1`,
  });
  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(createdId);
  });
  expect(stored?.email).toBe("mezclado@alu.uct.cl");
});

test("el arranque rechaza el correo de un perfil existente", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti17-boot-pro",
    email: "previo@uct.cl",
    role: "professional",
  });

  await expect(
    t.mutation(internal.operations.accounts.ensureBootstrapAdmin, {
      email: "previo@uct.cl",
      fullName: "Ficticio",
      tokenIdentifier: `${ISSUER}|ti17-boot-nuevo`,
    }),
  ).rejects.toThrow("Ya existe un perfil con este correo");
});

test("índices por pertenencia: solicitudes propias, por estado y por ambas", async () => {
  const t = convexTest(schema, modules);
  const studentA = await seedUser(t, {
    subject: "ti17-req-a",
    email: "reqa@alu.uct.cl",
    role: "student",
  });
  const studentB = await seedUser(t, {
    subject: "ti17-req-b",
    email: "reqb@alu.uct.cl",
    role: "student",
  });
  const aReceived = await seedRequest(t, studentA, "received");
  const aReview = await seedRequest(t, studentA, "under_review");
  const bReceived = await seedRequest(t, studentB, "received");

  const ownA = await t.run(async (ctx) => {
    return await ctx.db
      .query("requests")
      .withIndex("by_student", (q) => q.eq("studentId", studentA))
      .take(10);
  });
  expect(ownA.map((request) => request._id).sort()).toEqual([aReceived, aReview].sort());

  const received = await t.run(async (ctx) => {
    return await ctx.db
      .query("requests")
      .withIndex("by_status", (q) => q.eq("status", "received"))
      .take(10);
  });
  expect(received.map((request) => request._id).sort()).toEqual([aReceived, bReceived].sort());

  const ownReceived = await t.run(async (ctx) => {
    return await ctx.db
      .query("requests")
      .withIndex("by_student_and_status", (q) =>
        q.eq("studentId", studentA).eq("status", "received"),
      )
      .take(10);
  });
  expect(ownReceived.map((request) => request._id)).toEqual([aReceived]);
});

test("trazabilidad solicitud-acompañamiento: by_request solo devuelve el vinculado", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti17-traza-est",
    email: "trazaest@alu.uct.cl",
    role: "student",
  });
  const requestId = await seedRequest(t, student, "accepted");
  const linked = await seedAccompaniment(t, student, requestId);
  const unlinked = await seedAccompaniment(t, student);

  const found = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompaniments")
      .withIndex("by_request", (q) => q.eq("requestId", requestId))
      .take(10);
  });
  expect(found.map((accompaniment) => accompaniment._id)).toEqual([linked]);

  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(unlinked);
  });
  expect(stored?.requestId).toBeUndefined();
});

test("integridad de asignaciones: el acompañamiento y el usuario deben existir", async () => {
  const t = convexTest(schema, modules);
  const proId = await seedUser(t, {
    subject: "ti17-miss-pro",
    email: "misspro@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti17-miss-boot",
    email: "missboot@uct.cl",
    role: "professional",
  });
  const intern = await seedUser(t, {
    subject: "ti17-miss-int",
    email: "missint@alu.uct.cl",
    role: "intern",
  });
  const student = await seedUser(t, {
    subject: "ti17-miss-est",
    email: "missest@alu.uct.cl",
    role: "student",
  });
  const missingAccompaniment = await t.run(async (ctx) => {
    const id = await ctx.db.insert("accompaniments", {
      studentId: student,
      status: "active",
      objective: "Temporal ficticio",
      accessNeeds: "Temporal ficticio",
    });
    await ctx.db.delete(id);
    return id;
  });
  const missingUser = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      email: "temporal@alu.uct.cl",
      fullName: "Temporal Ficticio",
      role: "intern",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|ti17-miss-temporal`,
    });
    await ctx.db.delete(id);
    return id;
  });
  const accompaniment = await seedAccompaniment(t, student);

  // El llamante está autorizado sobre el acompañamiento existente, así la
  // denegación prueba el recurso inexistente y no la falta de alcance.
  const asBootstrap = t.withIdentity(identityFor("ti17-miss-boot", "missboot@uct.cl"));
  await asBootstrap.mutation(internal.operations.assignments.assign, {
    accompanimentId: accompaniment,
    userId: proId,
    assignedRole: "professional",
  });
  const asPro = t.withIdentity(identityFor("ti17-miss-pro", "misspro@uct.cl"));
  // TI2-28: el recurso inexistente se deniega con el mismo error genérico,
  // sin revelar existencia, y no se crea ninguna fila.
  await expect(
    asPro.mutation(internal.operations.assignments.assign, {
      accompanimentId: missingAccompaniment,
      userId: intern,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asPro.mutation(internal.operations.assignments.assign, {
      accompanimentId: accompaniment,
      userId: missingUser,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("No autorizado");
  const orphanByAccompaniment = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", missingAccompaniment)
          .eq("userId", intern)
          .eq("status", "active")
          .eq("assignedRole", "intern"),
      )
      .take(1);
  });
  expect(orphanByAccompaniment).toHaveLength(0);
  const orphanByUser = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", accompaniment)
          .eq("userId", missingUser)
          .eq("status", "active")
          .eq("assignedRole", "intern"),
      )
      .take(1);
  });
  expect(orphanByUser).toHaveLength(0);
});

test("trazabilidad mínima de Sprint 1: habilitación, solicitud, acompañamiento, asignación y revocación", async () => {
  const t = convexTest(schema, modules);
  const adminId = await t.mutation(internal.operations.accounts.ensureBootstrapAdmin, {
    email: "traza@uct.cl",
    fullName: "Administrador Ficticio",
    tokenIdentifier: `${ISSUER}|ti17-traza-adm`,
  });
  const internId = await seedUser(t, {
    subject: "ti17-traza-int",
    email: "trazaint@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });
  const proId = await seedUser(t, {
    subject: "ti17-traza-pro",
    email: "trazapro@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti17-traza-boot",
    email: "trazaboot@uct.cl",
    role: "professional",
  });
  const studentId = await seedUser(t, {
    subject: "ti17-traza-estudiante",
    email: "trazaestudiante@alu.uct.cl",
    role: "student",
  });

  const asAdmin = t.withIdentity(identityFor("ti17-traza-adm", "traza@uct.cl"));
  await asAdmin.mutation(internal.operations.accounts.enableIntern, { userId: internId });
  const enabled = await t.run(async (ctx) => {
    return await ctx.db.get(internId);
  });
  expect(enabled?.institutionalStatus).toBe("enabled");
  expect(enabled?.enabledBy).toEqual(adminId);
  expect(typeof enabled?.enabledAt).toBe("number");

  const requestId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "accepted",
    accessNeeds: "Necesidad de acceso ficticia",
  });
  const request = await t.query(internal.operations.requests.getRequestById, { id: requestId });
  expect(typeof request?.createdAt).toBe("number");

  const accompanimentId = await seedAccompaniment(t, studentId, requestId);

  // TI2-28: la concesión a Practicante exige profesional autorizado sobre el
  // acompañamiento; esta fila profesional suma una unidad al barrido.
  const asBootstrap = t.withIdentity(identityFor("ti17-traza-boot", "trazaboot@uct.cl"));
  await asBootstrap.mutation(internal.operations.assignments.assign, {
    accompanimentId,
    userId: proId,
    assignedRole: "professional",
  });
  const asPro = t.withIdentity(identityFor("ti17-traza-pro", "trazapro@uct.cl"));
  const input = {
    accompanimentId,
    userId: internId,
    assignedRole: "intern" as const,
  };
  await asPro.mutation(internal.operations.assignments.assign, input);
  const assigned = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", accompanimentId)
          .eq("userId", internId)
          .eq("status", "active")
          .eq("assignedRole", "intern"),
      )
      .take(1);
  });
  expect(assigned).toHaveLength(1);
  expect(assigned[0]?.grantedBy).toEqual(proId);
  expect(typeof assigned[0]?.grantedAt).toBe("number");

  await asPro.mutation(internal.operations.assignments.revoke, input);
  const revoked = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", accompanimentId)
          .eq("userId", internId)
          .eq("status", "revoked")
          .eq("assignedRole", "intern"),
      )
      .take(1);
  });
  expect(revoked).toHaveLength(1);
  expect(revoked[0]?.grantedBy).toEqual(proId);
  expect(revoked[0]?.revokedBy).toEqual(proId);
  expect(typeof revoked[0]?.revokedAt).toBe("number");

  const audit = await t.query(internal.operations.migrations.auditAssignmentTraceability, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(audit.scanned).toBe(2);
  expect(audit.missingGrant).toBe(0);
  expect(audit.activeMissingGrant).toBe(0);
  expect(audit.missingRevoke).toBe(0);
  expect(audit.isDone).toBe(true);
});

test("practicante no recupera recursos fuera de sus asignaciones", async () => {
  const t = convexTest(schema, modules);
  const studentA = await seedUser(t, {
    subject: "ti17-iso-est-a",
    email: "isoa@alu.uct.cl",
    role: "student",
  });
  const studentB = await seedUser(t, {
    subject: "ti17-iso-est-b",
    email: "isob@alu.uct.cl",
    role: "student",
  });
  const proId = await seedUser(t, {
    subject: "ti17-iso-pro",
    email: "isopro@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti17-iso-boot",
    email: "isoboot@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti17-iso-int",
    email: "isoint@alu.uct.cl",
    role: "intern",
  });
  const accA = await seedAccompaniment(t, studentA);
  const accB = await seedAccompaniment(t, studentB);
  await t.run(async (ctx) => {
    await ctx.db.insert("followUpNotes", {
      accompanimentId: accA,
      authorId: proId,
      body: "Nota interna ficticia",
    });
    await ctx.db.insert("followUpNotes", {
      accompanimentId: accB,
      authorId: proId,
      body: "Nota interna ficticia",
    });
  });

  const asPro = t.withIdentity(identityFor("ti17-iso-pro", "isopro@uct.cl"));
  // TI2-28: solo un profesional autorizado sobre accA puede conceder al
  // Practicante; la fila profesional no afecta las consultas por rol intern.
  const asBootstrap = t.withIdentity(identityFor("ti17-iso-boot", "isoboot@uct.cl"));
  await asBootstrap.mutation(internal.operations.assignments.assign, {
    accompanimentId: accA,
    userId: proId,
    assignedRole: "professional",
  });
  await asPro.mutation(internal.operations.assignments.assign, {
    accompanimentId: accA,
    userId: internId,
    assignedRole: "intern",
  });

  // Persistencia: las filas del practicante solo cubren el acompañamiento asignado.
  const mine = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_user_and_status_and_assigned_role_and_accompaniment", (q) =>
        q.eq("userId", internId).eq("status", "active").eq("assignedRole", "intern"),
      )
      .take(10);
  });
  expect(mine.map((row) => row.accompanimentId)).toEqual([accA]);

  const foreign = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", accB)
          .eq("userId", internId)
          .eq("status", "active")
          .eq("assignedRole", "intern"),
      )
      .take(1);
  });
  expect(foreign).toHaveLength(0);

  // Borde: lectura minimizada en lo asignado y denegación en todo lo demás.
  const asIntern = t.withIdentity(identityFor("ti17-iso-int", "isoint@alu.uct.cl"));
  const own = await asIntern.query(api.presentation.accompaniments.getAccompaniment, {
    accompanimentId: accA,
  });
  expect(own.view).toBe("minimized");
  await expect(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId: accB,
    }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asIntern.query(api.presentation.accompaniments.getInternalNotes, {
      accompanimentId: accA,
      paginationOpts: { numItems: 10, cursor: null },
    }),
  ).rejects.toThrow("No autorizado");
  const list = await asIntern.query(api.presentation.accompaniments.listAssignedAccompaniments, {
    limit: 10,
  });
  expect(list.items.map((item) => item._id)).toEqual([accA]);
});

test("la auditoría detecta filas legacy y aprueba la vía guardada", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti17-audit-est",
    email: "auditest@alu.uct.cl",
    role: "student",
  });
  const proId = await seedUser(t, {
    subject: "ti17-audit-pro",
    email: "auditpro@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti17-audit-otorga",
    email: "auditotorga@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti17-audit-int",
    email: "auditint@alu.uct.cl",
    role: "intern",
  });
  const legacyActive = await seedAccompaniment(t, student);
  const legacyRevoked = await seedAccompaniment(t, student);
  const guarded = await seedAccompaniment(t, student);
  // Filas anteriores a TI2-16: existen en disco pero sin trazabilidad.
  await t.run(async (ctx) => {
    await ctx.db.insert("accompanimentAssignments", {
      accompanimentId: legacyActive,
      userId: internId,
      assignedRole: "intern",
      status: "active",
    });
    await ctx.db.insert("accompanimentAssignments", {
      accompanimentId: legacyRevoked,
      userId: internId,
      assignedRole: "intern",
      status: "revoked",
    });
  });

  const asPro = t.withIdentity(identityFor("ti17-audit-otorga", "auditotorga@uct.cl"));
  await asPro.mutation(internal.operations.assignments.assign, {
    accompanimentId: guarded,
    userId: proId,
    assignedRole: "professional",
  });

  const first = await t.query(internal.operations.migrations.auditAssignmentTraceability, {
    paginationOpts: { numItems: 2, cursor: null },
  });
  expect(first.scanned).toBe(2);
  expect(first.missingGrant).toBe(2);
  expect(first.activeMissingGrant).toBe(1);
  expect(first.missingRevoke).toBe(1);
  expect(first.sampleLegacyIds).toHaveLength(2);
  expect(first.isDone).toBe(false);

  const second = await t.query(internal.operations.migrations.auditAssignmentTraceability, {
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  expect(second.scanned).toBe(1);
  expect(second.missingGrant).toBe(0);
  expect(second.activeMissingGrant).toBe(0);
  expect(second.missingRevoke).toBe(0);
  expect(second.isDone).toBe(true);
});

test("la migración exige administrador vigente", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti17-mig-est",
    email: "migest@alu.uct.cl",
    role: "student",
  });
  await seedUser(t, {
    subject: "ti17-mig-pro",
    email: "migpro@uct.cl",
    role: "professional",
  });
  const input = { paginationOpts: { numItems: 10, cursor: null } };

  await expect(
    t.mutation(internal.operations.migrations.migrateLegacyAssignments, input),
  ).rejects.toThrow("No autorizado");

  const asStudent = t.withIdentity(identityFor("ti17-mig-est", "migest@alu.uct.cl"));
  await expect(
    asStudent.mutation(internal.operations.migrations.migrateLegacyAssignments, input),
  ).rejects.toThrow("No autorizado");

  const asPro = t.withIdentity(identityFor("ti17-mig-pro", "migpro@uct.cl"));
  await expect(
    asPro.mutation(internal.operations.migrations.migrateLegacyAssignments, input),
  ).rejects.toThrow("No autorizado");
});

test("la migración acepta la identidad mínima del CLI (subject, issuer y tokenIdentifier)", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.operations.accounts.ensureBootstrapAdmin, {
    email: "migcli@uct.cl",
    fullName: "Administrador Ficticio",
    tokenIdentifier: `${ISSUER}|ti17-mig-cli`,
  });

  // Misma forma que `--identity` del CLI: basta el tokenIdentifier vinculado.
  const asCliAdmin = t.withIdentity({
    subject: "ti17-mig-cli",
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|ti17-mig-cli`,
  });
  const migrated = await asCliAdmin.mutation(
    internal.operations.migrations.migrateLegacyAssignments,
    {
      paginationOpts: { numItems: 10, cursor: null },
    },
  );
  expect(migrated.scanned).toBe(0);
  expect(migrated.revoked).toBe(0);
  expect(migrated.isDone).toBe(true);
});

test("la migración revoca activas legacy sin inventar concesión", async () => {
  const t = convexTest(schema, modules);
  const adminId = await t.mutation(internal.operations.accounts.ensureBootstrapAdmin, {
    email: "migadmin@uct.cl",
    fullName: "Administrador Ficticio",
    tokenIdentifier: `${ISSUER}|ti17-mig-adm`,
  });
  const proId = await seedUser(t, {
    subject: "ti17-mig-pro-2",
    email: "migpro2@uct.cl",
    role: "professional",
  });
  const granterId = await seedUser(t, {
    subject: "ti17-mig-otorga",
    email: "migotorga@uct.cl",
    role: "professional",
  });
  const internId = await seedUser(t, {
    subject: "ti17-mig-int",
    email: "migint@alu.uct.cl",
    role: "intern",
  });
  const student = await seedUser(t, {
    subject: "ti17-mig-est-2",
    email: "migest2@alu.uct.cl",
    role: "student",
  });
  const legacyActive = await seedAccompaniment(t, student);
  const legacyRevoked = await seedAccompaniment(t, student);
  const guarded = await seedAccompaniment(t, student);
  await t.run(async (ctx) => {
    await ctx.db.insert("accompanimentAssignments", {
      accompanimentId: legacyActive,
      userId: internId,
      assignedRole: "intern",
      status: "active",
    });
    await ctx.db.insert("accompanimentAssignments", {
      accompanimentId: legacyRevoked,
      userId: internId,
      assignedRole: "intern",
      status: "revoked",
    });
  });
  const asPro = t.withIdentity(identityFor("ti17-mig-otorga", "migotorga@uct.cl"));
  await asPro.mutation(internal.operations.assignments.assign, {
    accompanimentId: guarded,
    userId: proId,
    assignedRole: "professional",
  });

  const asAdmin = t.withIdentity(identityFor("ti17-mig-adm", "migadmin@uct.cl"));
  const migrated = await asAdmin.mutation(internal.operations.migrations.migrateLegacyAssignments, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(migrated.scanned).toBe(3);
  expect(migrated.revoked).toBe(1);
  expect(migrated.revokedIds).toHaveLength(1);
  expect(migrated.isDone).toBe(true);

  // La fila migrada conserva la brecha de concesión como evidencia y registra
  // la revocación real del operador.
  const quarantined = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", legacyActive)
          .eq("userId", internId)
          .eq("status", "revoked")
          .eq("assignedRole", "intern"),
      )
      .take(10);
  });
  expect(quarantined).toHaveLength(1);
  expect(quarantined[0]?.grantedBy).toBeUndefined();
  expect(quarantined[0]?.revokedBy).toEqual(adminId);
  expect(typeof quarantined[0]?.revokedAt).toBe("number");

  // La vía guardada y la ya revocada quedan intactas.
  const kept = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", guarded)
          .eq("userId", proId)
          .eq("status", "active")
          .eq("assignedRole", "professional"),
      )
      .take(10);
  });
  expect(kept).toHaveLength(1);
  expect(kept[0]?.grantedBy).toEqual(granterId);
  expect(kept[0]?.revokedBy).toBeUndefined();

  const untouched = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", legacyRevoked)
          .eq("userId", internId)
          .eq("status", "revoked")
          .eq("assignedRole", "intern"),
      )
      .take(10);
  });
  expect(untouched).toHaveLength(1);
  expect(untouched[0]?.revokedBy).toBeUndefined();

  // Sin acceso para el practicante y sin activas pendientes en la auditoría.
  const asIntern = t.withIdentity(identityFor("ti17-mig-int", "migint@alu.uct.cl"));
  await expect(
    asIntern.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId: legacyActive,
    }),
  ).rejects.toThrow("No autorizado");

  const audit = await t.query(internal.operations.migrations.auditAssignmentTraceability, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(audit.activeMissingGrant).toBe(0);
  expect(audit.missingGrant).toBe(2);
  expect(audit.isDone).toBe(true);
});

test("la migración avanza por páginas hasta agotar las filas", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.operations.accounts.ensureBootstrapAdmin, {
    email: "migpaginado@uct.cl",
    fullName: "Administrador Ficticio",
    tokenIdentifier: `${ISSUER}|ti17-mig-paginado`,
  });
  const internId = await seedUser(t, {
    subject: "ti17-mig-pag-int",
    email: "migpagint@alu.uct.cl",
    role: "intern",
  });
  const student = await seedUser(t, {
    subject: "ti17-mig-pag-est",
    email: "migpagest@alu.uct.cl",
    role: "student",
  });
  const accompaniments: Id<"accompaniments">[] = [];
  for (let round = 0; round < 3; round++) {
    accompaniments.push(await seedAccompaniment(t, student));
  }
  await t.run(async (ctx) => {
    for (const accompanimentId of accompaniments) {
      await ctx.db.insert("accompanimentAssignments", {
        accompanimentId,
        userId: internId,
        assignedRole: "intern",
        status: "active",
      });
    }
  });

  const asAdmin = t.withIdentity(identityFor("ti17-mig-paginado", "migpaginado@uct.cl"));
  const first = await asAdmin.mutation(internal.operations.migrations.migrateLegacyAssignments, {
    paginationOpts: { numItems: 2, cursor: null },
  });
  expect(first.scanned).toBe(2);
  expect(first.revoked).toBe(2);
  expect(first.isDone).toBe(false);

  const second = await asAdmin.mutation(internal.operations.migrations.migrateLegacyAssignments, {
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  expect(second.scanned).toBe(1);
  expect(second.revoked).toBe(1);
  expect(second.isDone).toBe(true);
});

/**
 * Agenda de Sprint 2 (TI2-83): espacios, bloques recurrentes, excepciones y
 * la única tabla de atención (`appointments`, no `reservations`).
 *
 * Cada prueba parte de una base vacía y siembra solo datos ficticios con
 * `ctx.db`, lo que demuestra que cada índice declarado responde en el orden
 * declarado sin datos previos. Solo persistencia: la ocupación atómica es
 * TI2-84, el catálogo autorizado es TI2-99, los repositorios de escritura
 * son TI2-95 y las reglas de TI2-81/TI2-82/TI2-93 no se implementan acá.
 */

/** Lunes 2026-10-12 00:00 UTC en milisegundos de época. */
const TI83_MONDAY = Date.UTC(2026, 9, 12);
/** Martes 2026-10-13 00:00 UTC en milisegundos de época. */
const TI83_TUESDAY = Date.UTC(2026, 9, 13);
/** Lunes 2026-10-12 09:00 UTC en milisegundos de época. */
const TI83_MONDAY_9H = TI83_MONDAY + 9 * 3_600_000;
/** Lunes 2026-10-12 10:00 UTC en milisegundos de época. */
const TI83_MONDAY_10H = TI83_MONDAY + 10 * 3_600_000;

/** Sala ficticia del catálogo. */
async function seedTi83Space(
  t: ReturnType<typeof convexTest>,
  input: { campus: string; building: string; floor: string; room: string; isActive?: boolean },
): Promise<Id<"spaces">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("spaces", {
      campus: input.campus,
      building: input.building,
      floor: input.floor,
      room: input.room,
      accessConditions: "Condición de acceso ficticia",
      accessInstructions: "Instrucción de llegada ficticia",
      isActive: input.isActive ?? true,
    });
  });
}

/** Bloque recurrente ficticio del profesional. */
async function seedTi83Block(
  t: ReturnType<typeof convexTest>,
  input: {
    professionalId: Id<"users">;
    weekday: number;
    modality?: "inPerson" | "online";
    spaceId?: Id<"spaces">;
    isActive?: boolean;
    slotMinutes?: number;
  },
): Promise<Id<"availabilityBlocks">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("availabilityBlocks", {
      professionalId: input.professionalId,
      weekday: input.weekday,
      startMinute: 540,
      endMinute: 720,
      slotMinutes: input.slotMinutes ?? 60,
      modality: input.modality ?? "inPerson",
      ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
      isActive: input.isActive ?? true,
    });
  });
}

/** Excepción ficticia del profesional en un día. */
async function seedTi83Exception(
  t: ReturnType<typeof convexTest>,
  input: {
    professionalId: Id<"users">;
    date: number;
    kind?: "cancelled" | "added";
    blockId?: Id<"availabilityBlocks">;
    startMinute?: number;
    endMinute?: number;
    slotMinutes?: number;
    modality?: "inPerson" | "online";
    spaceId?: Id<"spaces">;
  },
): Promise<Id<"availabilityExceptions">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("availabilityExceptions", {
      professionalId: input.professionalId,
      date: input.date,
      kind: input.kind ?? "cancelled",
      ...(input.blockId === undefined ? {} : { blockId: input.blockId }),
      ...(input.startMinute === undefined ? {} : { startMinute: input.startMinute }),
      ...(input.endMinute === undefined ? {} : { endMinute: input.endMinute }),
      ...(input.slotMinutes === undefined ? {} : { slotMinutes: input.slotMinutes }),
      ...(input.modality === undefined ? {} : { modality: input.modality }),
      ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
      reason: "Motivo ficticio",
    });
  });
}

/** Atención reservada ficticia en la única tabla `appointments`. */
async function seedTi83Appointment(
  t: ReturnType<typeof convexTest>,
  input: {
    accompanimentId: Id<"accompaniments">;
    studentId: Id<"users">;
    professionalId: Id<"users">;
    startsAt: number;
    endsAt: number;
    modality?: "inPerson" | "online";
    status?:
      | "scheduled"
      | "completed"
      | "cancelled_by_student"
      | "cancelled_by_cereti"
      | "rescheduled"
      | "no_show";
    spaceId?: Id<"spaces">;
    originalStartsAt?: number;
    cancelReason?: string;
  },
): Promise<Id<"appointments">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("appointments", {
      accompanimentId: input.accompanimentId,
      studentId: input.studentId,
      professionalId: input.professionalId,
      ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
      modality: input.modality ?? "inPerson",
      status: input.status ?? "scheduled",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      ...(input.originalStartsAt === undefined ? {} : { originalStartsAt: input.originalStartsAt }),
      ...(input.cancelReason === undefined ? {} : { cancelReason: input.cancelReason }),
      createdAt: 1,
    });
  });
}

test("índices de espacios TI2-83: catálogo vigente y sala exacta", async () => {
  const t = convexTest(schema, modules);
  const activeId = await seedTi83Space(t, {
    campus: "Campus Norte",
    building: "Edificio C",
    floor: "2",
    room: "C-204",
  });
  const retiredId = await seedTi83Space(t, {
    campus: "Campus Norte",
    building: "Edificio C",
    floor: "2",
    room: "C-205",
    isActive: false,
  });

  const active = await t.run(async (ctx) => {
    return await ctx.db
      .query("spaces")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .take(10);
  });
  expect(active.map((space) => space._id)).toEqual([activeId]);

  const retired = await t.run(async (ctx) => {
    return await ctx.db
      .query("spaces")
      .withIndex("by_isActive", (q) => q.eq("isActive", false))
      .take(10);
  });
  expect(retired.map((space) => space._id)).toEqual([retiredId]);

  const found = await t.run(async (ctx) => {
    return await ctx.db
      .query("spaces")
      .withIndex("by_campus_and_building_and_floor_and_room", (q) =>
        q
          .eq("campus", "Campus Norte")
          .eq("building", "Edificio C")
          .eq("floor", "2")
          .eq("room", "C-204"),
      )
      .take(1);
  });
  expect(found.map((space) => space._id)).toEqual([activeId]);

  const missing = await t.run(async (ctx) => {
    return await ctx.db
      .query("spaces")
      .withIndex("by_campus_and_building_and_floor_and_room", (q) =>
        q
          .eq("campus", "Campus Norte")
          .eq("building", "Edificio C")
          .eq("floor", "2")
          .eq("room", "C-999"),
      )
      .take(1);
  });
  expect(missing).toHaveLength(0);
});

test("índices de bloques TI2-83: profesional, día, vigencia y sala", async () => {
  const t = convexTest(schema, modules);
  const proA = await seedUser(t, {
    subject: "ti83-pro-a",
    email: "proa@uct.cl",
    role: "professional",
  });
  const proB = await seedUser(t, {
    subject: "ti83-pro-b",
    email: "prob@uct.cl",
    role: "professional",
  });
  const room = await seedTi83Space(t, {
    campus: "Norte",
    building: "C",
    floor: "2",
    room: "C-204",
  });
  // Lunes = 1, martes = 2 (0=domingo). Misma ventana 09:00–12:00 con
  // distinta duración de cupo: 30 frente a 60 minutos.
  const mondayBlock = await seedTi83Block(t, {
    professionalId: proA,
    weekday: 1,
    spaceId: room,
  });
  const shortBlock = await seedTi83Block(t, {
    professionalId: proA,
    weekday: 1,
    spaceId: room,
    slotMinutes: 30,
  });
  const tuesdayBlock = await seedTi83Block(t, {
    professionalId: proA,
    weekday: 2,
    spaceId: room,
  });
  const onlineBlock = await seedTi83Block(t, {
    professionalId: proA,
    weekday: 1,
    modality: "online",
  });
  const retiredBlock = await seedTi83Block(t, {
    professionalId: proA,
    weekday: 1,
    modality: "online",
    isActive: false,
  });
  await seedTi83Block(t, { professionalId: proB, weekday: 1, modality: "online" });

  const all = await t.run(async (ctx) => {
    return await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_professionalId", (q) => q.eq("professionalId", proA))
      .take(10);
  });
  expect(all.map((block) => block._id).sort()).toEqual(
    [mondayBlock, shortBlock, tuesdayBlock, onlineBlock, retiredBlock].sort(),
  );

  const monday = await t.run(async (ctx) => {
    return await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_professionalId_and_weekday", (q) =>
        q.eq("professionalId", proA).eq("weekday", 1),
      )
      .take(10);
  });
  expect(monday.map((block) => block._id).sort()).toEqual(
    [mondayBlock, shortBlock, onlineBlock, retiredBlock].sort(),
  );

  // La misma ventana conserva la diferencia de duración al leerse.
  const durations = await t.run(async (ctx) => {
    return await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_professionalId_and_weekday", (q) =>
        q.eq("professionalId", proA).eq("weekday", 1),
      )
      .take(10);
  });
  expect(
    durations
      .filter((block) => block.spaceId !== undefined)
      .map((block) => block.slotMinutes)
      .sort(),
  ).toEqual([30, 60]);

  const mondayActive = await t.run(async (ctx) => {
    return await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_professionalId_and_weekday_and_isActive", (q) =>
        q.eq("professionalId", proA).eq("weekday", 1).eq("isActive", true),
      )
      .take(10);
  });
  expect(mondayActive.map((block) => block._id).sort()).toEqual(
    [mondayBlock, shortBlock, onlineBlock].sort(),
  );

  const byRoom = await t.run(async (ctx) => {
    return await ctx.db
      .query("availabilityBlocks")
      .withIndex("by_spaceId", (q) => q.eq("spaceId", room))
      .take(10);
  });
  expect(byRoom.map((block) => block._id).sort()).toEqual(
    [mondayBlock, shortBlock, tuesdayBlock].sort(),
  );
});

test("índices de excepciones TI2-83: profesional-día y barrido por fecha", async () => {
  const t = convexTest(schema, modules);
  const proA = await seedUser(t, {
    subject: "ti83-exc-a",
    email: "exca@uct.cl",
    role: "professional",
  });
  const proB = await seedUser(t, {
    subject: "ti83-exc-b",
    email: "excb@uct.cl",
    role: "professional",
  });
  const block = await seedTi83Block(t, {
    professionalId: proA,
    weekday: 1,
    modality: "online",
  });
  const cancelled = await seedTi83Exception(t, {
    professionalId: proA,
    date: TI83_MONDAY,
    blockId: block,
  });
  const room = await seedTi83Space(t, {
    campus: "Norte",
    building: "C",
    floor: "2",
    room: "C-204",
  });
  const addedInPerson = await seedTi83Exception(t, {
    professionalId: proA,
    date: TI83_TUESDAY,
    kind: "added",
    startMinute: 660,
    endMinute: 720,
    slotMinutes: 60,
    modality: "inPerson",
    spaceId: room,
  });
  const addedOnline = await seedTi83Exception(t, {
    professionalId: proA,
    date: TI83_TUESDAY,
    kind: "added",
    startMinute: 780,
    endMinute: 840,
    slotMinutes: 30,
    modality: "online",
  });
  const otherPro = await seedTi83Exception(t, { professionalId: proB, date: TI83_MONDAY });

  const mondayMine = await t.run(async (ctx) => {
    return await ctx.db
      .query("availabilityExceptions")
      .withIndex("by_professionalId_and_date", (q) =>
        q.eq("professionalId", proA).eq("date", TI83_MONDAY),
      )
      .take(10);
  });
  expect(mondayMine.map((row) => row._id)).toEqual([cancelled]);

  const tuesdayMine = await t.run(async (ctx) => {
    return await ctx.db
      .query("availabilityExceptions")
      .withIndex("by_professionalId_and_date", (q) =>
        q.eq("professionalId", proA).eq("date", TI83_TUESDAY),
      )
      .take(10);
  });
  expect(tuesdayMine.map((row) => row._id).sort()).toEqual([addedInPerson, addedOnline].sort());

  const mondayAll = await t.run(async (ctx) => {
    return await ctx.db
      .query("availabilityExceptions")
      .withIndex("by_date", (q) => q.eq("date", TI83_MONDAY))
      .take(10);
  });
  expect(mondayAll.map((row) => row._id).sort()).toEqual([cancelled, otherPro].sort());

  // La cancelación conserva el vínculo al bloque y no trae ventana propia.
  const storedCancelled = await t.run(async (ctx) => {
    return await ctx.db.get(cancelled);
  });
  expect(storedCancelled?.blockId).toEqual(block);
  expect(storedCancelled?.startMinute).toBeUndefined();

  // La ventana agregada presencial conserva duración, modalidad y lugar;
  // la en línea conserva duración y modalidad sin sala.
  const storedInPerson = await t.run(async (ctx) => {
    return await ctx.db.get(addedInPerson);
  });
  expect(storedInPerson?.blockId).toBeUndefined();
  expect(storedInPerson?.startMinute).toBe(660);
  expect(storedInPerson?.endMinute).toBe(720);
  expect(storedInPerson?.slotMinutes).toBe(60);
  expect(storedInPerson?.modality).toBe("inPerson");
  expect(storedInPerson?.spaceId).toEqual(room);

  const storedOnline = await t.run(async (ctx) => {
    return await ctx.db.get(addedOnline);
  });
  expect(storedOnline?.slotMinutes).toBe(30);
  expect(storedOnline?.modality).toBe("online");
  expect(storedOnline?.spaceId).toBeUndefined();
});

test("índices de appointments TI2-83: estudiante, profesional, sala y acompañamiento", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti83-est",
    email: "est@alu.uct.cl",
    role: "student",
  });
  const otherStudent = await seedUser(t, {
    subject: "ti83-est-b",
    email: "estb@alu.uct.cl",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "ti83-ate-pro",
    email: "atepro@uct.cl",
    role: "professional",
  });
  const room = await seedTi83Space(t, {
    campus: "Norte",
    building: "C",
    floor: "2",
    room: "C-204",
  });
  const accompaniment = await seedAccompaniment(t, student);
  const otherAccompaniment = await seedAccompaniment(t, otherStudent);
  const early = await seedTi83Appointment(t, {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    spaceId: room,
    startsAt: TI83_MONDAY_9H,
    endsAt: TI83_MONDAY_10H,
  });
  const late = await seedTi83Appointment(t, {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    spaceId: room,
    startsAt: TI83_MONDAY_10H,
    endsAt: TI83_MONDAY_10H + 3_600_000,
    status: "rescheduled",
    originalStartsAt: TI83_MONDAY_9H,
  });
  const foreign = await seedTi83Appointment(t, {
    accompanimentId: otherAccompaniment,
    studentId: otherStudent,
    professionalId: pro,
    modality: "online",
    startsAt: TI83_MONDAY_9H,
    endsAt: TI83_MONDAY_10H,
  });

  const mine = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_studentId", (q) => q.eq("studentId", student))
      .take(10);
  });
  expect(mine.map((row) => row._id).sort()).toEqual([early, late].sort());

  // Aislamiento: el otro estudiante y el otro acompañamiento solo ven lo propio.
  const foreignMine = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_studentId", (q) => q.eq("studentId", otherStudent))
      .take(10);
  });
  expect(foreignMine.map((row) => row._id)).toEqual([foreign]);

  const foreignByAccompaniment = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_accompanimentId", (q) => q.eq("accompanimentId", otherAccompaniment))
      .take(10);
  });
  expect(foreignByAccompaniment.map((row) => row._id)).toEqual([foreign]);

  const mineFromLate = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_studentId_and_startsAt", (q) =>
        q.eq("studentId", student).gte("startsAt", TI83_MONDAY_10H),
      )
      .take(10);
  });
  expect(mineFromLate.map((row) => row._id)).toEqual([late]);

  const agenda = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_professionalId", (q) => q.eq("professionalId", pro))
      .take(10);
  });
  expect(agenda.map((row) => row._id).sort()).toEqual([early, late, foreign].sort());

  const agendaFrom = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_professionalId_and_startsAt", (q) =>
        q.eq("professionalId", pro).gte("startsAt", TI83_MONDAY_10H),
      )
      .take(10);
  });
  // La atención ajena empieza a las 09:00 y queda fuera de la ventana.
  expect(agendaFrom.map((row) => row._id)).toEqual([late]);

  const roomUse = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_spaceId", (q) => q.eq("spaceId", room))
      .take(10);
  });
  expect(roomUse.map((row) => row._id).sort()).toEqual([early, late].sort());

  const roomUseFrom = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_spaceId_and_startsAt", (q) =>
        q.eq("spaceId", room).gte("startsAt", TI83_MONDAY_10H),
      )
      .take(10);
  });
  expect(roomUseFrom.map((row) => row._id)).toEqual([late]);

  const byAccompaniment = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_accompanimentId", (q) => q.eq("accompanimentId", accompaniment))
      .take(10);
  });
  expect(byAccompaniment.map((row) => row._id).sort()).toEqual([early, late].sort());

  const rescheduled = await t.run(async (ctx) => {
    return await ctx.db.get(late);
  });
  expect(rescheduled?.originalStartsAt).toBe(TI83_MONDAY_9H);

  const online = await t.run(async (ctx) => {
    return await ctx.db.get(foreign);
  });
  expect(online?.spaceId).toBeUndefined();
});

test("appointments TI2-83: estados terminales, motivo y orden de ventana", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti83-est-term",
    email: "estterm@alu.uct.cl",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "ti83-pro-term",
    email: "proterm@uct.cl",
    role: "professional",
  });
  const accompaniment = await seedAccompaniment(t, student);
  const base = {
    accompanimentId: accompaniment,
    studentId: student,
    professionalId: pro,
    startsAt: TI83_MONDAY_9H,
    endsAt: TI83_MONDAY_10H,
  } as const;
  const completed = await seedTi83Appointment(t, { ...base, status: "completed" });
  const studentCancelled = await seedTi83Appointment(t, {
    ...base,
    status: "cancelled_by_student",
    startsAt: TI83_MONDAY_10H,
    endsAt: TI83_MONDAY_10H + 3_600_000,
  });
  const ceretiCancelled = await seedTi83Appointment(t, {
    ...base,
    status: "cancelled_by_cereti",
    startsAt: TI83_MONDAY_10H + 3_600_000,
    endsAt: TI83_MONDAY_10H + 7_200_000,
    cancelReason: "Sala no disponible",
  });
  const noShow = await seedTi83Appointment(t, {
    ...base,
    status: "no_show",
    startsAt: TI83_MONDAY_10H + 7_200_000,
    endsAt: TI83_MONDAY_10H + 10_800_000,
  });

  const storedStudent = await t.run(async (ctx) => {
    return await ctx.db.get(studentCancelled);
  });
  expect(storedStudent?.status).toBe("cancelled_by_student");
  expect(storedStudent?.cancelReason).toBeUndefined();

  const storedCereti = await t.run(async (ctx) => {
    return await ctx.db.get(ceretiCancelled);
  });
  expect(storedCereti?.status).toBe("cancelled_by_cereti");
  expect(storedCereti?.cancelReason).toBe("Sala no disponible");

  const storedNoShow = await t.run(async (ctx) => {
    return await ctx.db.get(noShow);
  });
  expect(storedNoShow?.status).toBe("no_show");

  const storedCompleted = await t.run(async (ctx) => {
    return await ctx.db.get(completed);
  });
  expect(storedCompleted?.status).toBe("completed");

  // Siembra tardía primero: el orden lo impone el índice, no la inserción.
  await seedTi83Appointment(t, {
    ...base,
    modality: "online",
    startsAt: TI83_MONDAY_10H,
    endsAt: TI83_MONDAY_10H + 3_600_000,
  });
  await seedTi83Appointment(t, {
    ...base,
    modality: "online",
    startsAt: TI83_MONDAY_9H,
    endsAt: TI83_MONDAY_10H,
  });
  const windowed = await t.run(async (ctx) => {
    return await ctx.db
      .query("appointments")
      .withIndex("by_studentId_and_startsAt", (q) =>
        q.eq("studentId", student).gte("startsAt", TI83_MONDAY_9H),
      )
      .take(10);
  });
  expect(windowed.map((row) => row.startsAt)).toEqual([
    TI83_MONDAY_9H,
    TI83_MONDAY_9H,
    TI83_MONDAY_10H,
    TI83_MONDAY_10H,
    TI83_MONDAY_10H + 3_600_000,
    TI83_MONDAY_10H + 7_200_000,
  ]);
});

test("límites TI2-83: el esquema rechaza literales desconocidos y filas incompletas", async () => {
  const t = convexTest(schema, modules);
  const pro = await seedUser(t, {
    subject: "ti83-lim-pro",
    email: "limpro@uct.cl",
    role: "professional",
  });

  await expect(
    t.run(async (ctx) => {
      await ctx.db.insert("availabilityBlocks", {
        professionalId: pro,
        weekday: 1,
        startMinute: 540,
        endMinute: 600,
        slotMinutes: 60,
        modality: "hybrid" as unknown as "inPerson",
        isActive: true,
      });
    }),
  ).rejects.toThrow("Validator error");

  const student = await seedUser(t, {
    subject: "ti83-lim-est",
    email: "limest@alu.uct.cl",
    role: "student",
  });
  const accompaniment = await seedAccompaniment(t, student);
  await expect(
    t.run(async (ctx) => {
      await ctx.db.insert("appointments", {
        accompanimentId: accompaniment,
        studentId: student,
        professionalId: pro,
        modality: "inPerson",
        status: "scheduled",
        startsAt: TI83_MONDAY_9H,
        createdAt: 1,
      } as never);
    }),
  ).rejects.toThrow("Validator error");

  await expect(
    t.run(async (ctx) => {
      await ctx.db.insert("appointments", {
        accompanimentId: accompaniment,
        studentId: student,
        professionalId: pro,
        modality: "inPerson",
        status: "justified" as unknown as "scheduled",
        startsAt: TI83_MONDAY_9H,
        endsAt: TI83_MONDAY_10H,
        createdAt: 1,
      });
    }),
  ).rejects.toThrow("Validator error");

  await expect(
    t.run(async (ctx) => {
      await ctx.db.insert("availabilityExceptions", {
        professionalId: pro,
        date: TI83_MONDAY,
        kind: "moved" as unknown as "cancelled",
      });
    }),
  ).rejects.toThrow("Validator error");
});

test("compatibilidad TI2-85: cancelación y cierre persisten y se leen", async () => {
  const t = convexTest(schema, modules);
  const student = await seedUser(t, {
    subject: "ti83-comp-est",
    email: "compest@alu.uct.cl",
    role: "student",
  });
  const pro = await seedUser(t, {
    subject: "ti83-comp-pro",
    email: "comppro@uct.cl",
    role: "professional",
  });
  const legacy = await seedRequest(t, student, "received");
  const cancelledId = await t.run(async (ctx) => {
    return await ctx.db.insert("requests", {
      studentId: student,
      status: "cancelled",
      accessNeeds: "Necesidad de acceso ficticia",
      createdAt: 2,
    });
  });
  const closedId = await t.run(async (ctx) => {
    return await ctx.db.insert("requests", {
      studentId: student,
      status: "closed_without_accompaniment",
      accessNeeds: "Necesidad de acceso ficticia",
      createdAt: 3,
    });
  });
  const transitionId = await t.run(async (ctx) => {
    return await ctx.db.insert("requestTransitions", {
      requestId: cancelledId,
      from: "received",
      to: "cancelled",
      actorId: student,
      occurredAt: 4,
    });
  });

  // Las lecturas anteriores siguen adaptando documentos de Sprint 1.
  const legacyStored = await t.run(async (ctx) => {
    return await ctx.db.get(legacy);
  });
  expect(
    toAccompanimentRequest({
      _id: legacy,
      studentId: student,
      status: legacyStored?.status ?? "",
      accessNeeds: legacyStored?.accessNeeds ?? "",
      createdAt: legacyStored?.createdAt ?? 0,
    }).status,
  ).toBe("received");

  // La cancelación y el cierre se persisten con los literales del dominio y
  // la proyección de TI2-85 los lee tal cual.
  for (const [id, status] of [
    [cancelledId, "cancelled"],
    [closedId, "closed_without_accompaniment"],
  ] as const) {
    const stored = await t.run(async (ctx) => {
      return await ctx.db.get(id);
    });
    expect(stored?.status).toBe(status);
    expect(
      toAccompanimentRequest({
        _id: id,
        studentId: student,
        status: stored?.status ?? "",
        accessNeeds: stored?.accessNeeds ?? "",
        createdAt: stored?.createdAt ?? 0,
      }).status,
    ).toBe(status);
  }

  const storedTransition = await t.run(async (ctx) => {
    return await ctx.db.get(transitionId);
  });
  expect(storedTransition?.to).toBe("cancelled");

  // Con las reglas de TI2-85 el paso existe y exige motivo: sin él se
  // rechaza de forma segura y con él se aplica sin abrir acompañamiento.
  const cancelAttempt = {
    from: "received",
    to: "cancelled",
    actorId: student,
    occurredAt: 5,
  } as const;
  expect(transitionRequest(cancelAttempt)).toEqual({
    status: "rejected",
    cause: "reason_required",
  });
  expect(transitionRequest({ ...cancelAttempt, reason: "Motivo ficticio" })).toMatchObject({
    status: "applied",
    opensAccompaniment: false,
  });
  // Cerrar desde una recibida no existe: el Profesional la toma primero.
  expect(
    transitionRequest({
      from: "received",
      to: "closed_without_accompaniment",
      actorId: pro,
      occurredAt: 5,
      reason: "Motivo ficticio",
    }),
  ).toEqual({ status: "rejected", cause: "transition_not_allowed" });

  // `referred` sigue sin habilitarse en el esquema.
  await expect(
    t.run(async (ctx) => {
      await ctx.db.insert("requests", {
        studentId: student,
        status: "referred" as unknown as "received",
        accessNeeds: "Necesidad de acceso ficticia",
        createdAt: 6,
      });
    }),
  ).rejects.toThrow("Validator error");
});

/**
 * Repositorio de disponibilidad (TI2-95): lecturas por profesional y rango
 * con el adaptador real sobre las semillas de TI2-83. Declarar el adaptador
 * como `AvailabilityReader` comprueba que cumple el puerto de Aplicación sin
 * que Infraestructura lo importe.
 */

const TI95_DAY_MS = 86_400_000;

const TI95_CONFLICT = {
  status: "error",
  error: { code: "conflict", message: "La solicitud entra en conflicto con el estado actual." },
} as const;

async function seedTi95Professionals(t: ReturnType<typeof convexTest>) {
  const proA = await seedUser(t, {
    subject: "ti95-pro-a",
    email: "ti95.proa@uct.cl",
    role: "professional",
  });
  const proB = await seedUser(t, {
    subject: "ti95-pro-b",
    email: "ti95.prob@uct.cl",
    role: "professional",
  });
  return { proA, proB };
}

test("repositorio de disponibilidad TI2-95: bloques vigentes en el contrato de TI2-81", async () => {
  const t = convexTest(schema, modules);
  const { proA, proB } = await seedTi95Professionals(t);
  const room = await seedTi83Space(t, {
    campus: "Norte",
    building: "C",
    floor: "2",
    room: "C-204",
  });
  const monday = await seedTi83Block(t, { professionalId: proA, weekday: 1, spaceId: room });
  const tuesday = await seedTi83Block(t, {
    professionalId: proA,
    weekday: 2,
    modality: "online",
    slotMinutes: 30,
  });
  const retired = await seedTi83Block(t, {
    professionalId: proA,
    weekday: 3,
    modality: "online",
    isActive: false,
  });
  await seedTi83Block(t, { professionalId: proB, weekday: 1, modality: "online" });
  const deleted = await seedTi83Block(t, { professionalId: proA, weekday: 4, modality: "online" });
  await t.run(async (ctx) => {
    await ctx.db.delete(deleted);
  });

  await t.run(async (ctx) => {
    const reader: AvailabilityReader = availabilityReader(ctx);
    const blocks = await reader.listActiveBlocks(proA);
    expect(blocks).toEqual({
      status: "ok",
      data: [
        {
          id: monday,
          professionalId: proA,
          weekday: 1,
          startMinute: 540,
          endMinute: 720,
          slotMinutes: 60,
          modality: "inPerson",
          spaceId: room,
          isActive: true,
          version: "v1",
        },
        {
          id: tuesday,
          professionalId: proA,
          weekday: 2,
          startMinute: 540,
          endMinute: 720,
          slotMinutes: 30,
          modality: "online",
          isActive: true,
          version: "v1",
        },
      ],
    });
    // El bloque en línea no arrastra una referencia a sala.
    expect(blocks.status === "ok" && "spaceId" in blocks.data[1]!).toBe(false);
    // El retirado no se lista, pero se lee por id para poder reactivarlo.
    expect(await reader.getBlock(retired)).toMatchObject({ id: retired, isActive: false });
    // Id borrado, de otra tabla o sin forma de id: igual que sin datos.
    expect(await reader.getBlock(deleted)).toBe(null);
    expect(await reader.getBlock(room)).toBe(null);
    expect(await reader.getBlock("no-es-un-id")).toBe(null);
    expect(await reader.listActiveBlocks(room)).toEqual({ status: "ok", data: [] });
  });
});

test("repositorio de disponibilidad TI2-95: excepciones por rango civil inclusivo", async () => {
  const t = convexTest(schema, modules);
  const { proA, proB } = await seedTi95Professionals(t);
  const room = await seedTi83Space(t, {
    campus: "Norte",
    building: "C",
    floor: "2",
    room: "C-204",
  });
  const block = await seedTi83Block(t, { professionalId: proA, weekday: 1, spaceId: room });
  const cancelled = await seedTi83Exception(t, {
    professionalId: proA,
    date: TI83_MONDAY,
    blockId: block,
  });
  const added = await seedTi83Exception(t, {
    professionalId: proA,
    date: TI83_TUESDAY,
    kind: "added",
    startMinute: 600,
    endMinute: 660,
    slotMinutes: 30,
    modality: "inPerson",
    spaceId: room,
  });
  // Fuera del rango (miércoles) y de otro profesional: no se leen.
  await seedTi83Exception(t, { professionalId: proA, date: TI83_TUESDAY + TI95_DAY_MS });
  await seedTi83Exception(t, { professionalId: proB, date: TI83_MONDAY });

  await t.run(async (ctx) => {
    const reader: AvailabilityReader = availabilityReader(ctx);
    const addedException = {
      id: added,
      professionalId: proA,
      date: "2026-10-13",
      kind: "added",
      reason: "Motivo ficticio",
      windows: [
        { startMinute: 600, endMinute: 660, slotMinutes: 30, modality: "inPerson", spaceId: room },
      ],
      version: "v1",
    };
    expect(
      await reader.listExceptions({ professionalId: proA, from: "2026-10-12", to: "2026-10-13" }),
    ).toEqual({
      status: "ok",
      data: [
        {
          id: cancelled,
          professionalId: proA,
          date: "2026-10-12",
          kind: "cancelled",
          blockId: block,
          reason: "Motivo ficticio",
          version: "v1",
        },
        addedException,
      ],
    });
    // Un solo día: el rango incluye sus dos extremos.
    expect(
      await reader.listExceptions({ professionalId: proA, from: "2026-10-13", to: "2026-10-13" }),
    ).toEqual({ status: "ok", data: [addedException] });
    expect(await reader.getException(added)).toEqual(addedException);
    expect(await reader.getException(block)).toBe(null);
    expect(
      await reader.listExceptions({ professionalId: room, from: "2026-10-12", to: "2026-10-13" }),
    ).toEqual({ status: "ok", data: [] });
  });
});

test("repositorio de disponibilidad TI2-95: rangos inválidos o mayores a 92 días responden conflict", async () => {
  const t = convexTest(schema, modules);
  const { proA } = await seedTi95Professionals(t);

  await t.run(async (ctx) => {
    const reader: AvailabilityReader = availabilityReader(ctx);
    const read = (from: string, to: string, professionalId: string = proA) =>
      reader.listExceptions({ professionalId, from, to });
    expect(await read("2026-10-13", "2026-10-12")).toEqual(TI95_CONFLICT);
    expect(await read("2026-02-30", "2026-03-01")).toEqual(TI95_CONFLICT);
    expect(await read("12-10-2026", "2026-10-13")).toEqual(TI95_CONFLICT);
    // 92 días exactos se leen; 93 no.
    expect(await read("2026-10-12", "2027-01-11")).toEqual({ status: "ok", data: [] });
    expect(await read("2026-10-12", "2027-01-12")).toEqual(TI95_CONFLICT);
    // Con un id inválido el rango se valida igual.
    expect(await read("2026-10-13", "2026-10-12", "no-es-un-id")).toEqual(TI95_CONFLICT);
  });
});

test("repositorio de disponibilidad TI2-95: los topes de lectura fallan en vez de cortar la lista", async () => {
  const t = convexTest(schema, modules);
  const { proA, proB } = await seedTi95Professionals(t);
  await t.run(async (ctx) => {
    for (let index = 0; index < MAX_ACTIVE_BLOCKS; index += 1) {
      await ctx.db.insert("availabilityBlocks", {
        professionalId: proA,
        weekday: index % 7,
        startMinute: 540,
        endMinute: 720,
        slotMinutes: 60,
        modality: "online",
        isActive: true,
      });
    }
    // Los retirados no se leen ni consumen el tope.
    for (let index = 0; index < 20; index += 1) {
      await ctx.db.insert("availabilityBlocks", {
        professionalId: proA,
        weekday: index % 7,
        startMinute: 540,
        endMinute: 720,
        slotMinutes: 60,
        modality: "online",
        isActive: false,
      });
    }
    for (let index = 0; index < MAX_EXCEPTIONS_IN_RANGE; index += 1) {
      await ctx.db.insert("availabilityExceptions", {
        professionalId: proB,
        date: TI83_MONDAY + (index % 92) * TI95_DAY_MS,
        kind: "cancelled",
      });
    }
  });
  const range = { professionalId: proB, from: "2026-10-12", to: "2027-01-11" };

  await t.run(async (ctx) => {
    const reader = availabilityReader(ctx);
    const blocks = await reader.listActiveBlocks(proA);
    expect(blocks.status === "ok" && blocks.data.length).toBe(MAX_ACTIVE_BLOCKS);
    const exceptions = await reader.listExceptions(range);
    expect(exceptions.status === "ok" && exceptions.data.length).toBe(MAX_EXCEPTIONS_IN_RANGE);
  });

  await seedTi83Block(t, { professionalId: proA, weekday: 6, modality: "online" });
  await seedTi83Exception(t, { professionalId: proB, date: TI83_TUESDAY });
  await t.run(async (ctx) => {
    const reader = availabilityReader(ctx);
    expect(await reader.listActiveBlocks(proA)).toEqual(TI95_CONFLICT);
    expect(await reader.listExceptions(range)).toEqual(TI95_CONFLICT);
  });
});

test("repositorio de disponibilidad TI2-95: una fila incompleta se entrega tal cual y la expansión la rechaza", async () => {
  const t = convexTest(schema, modules);
  const { proA } = await seedTi95Professionals(t);
  const broken = await seedTi83Exception(t, {
    professionalId: proA,
    date: TI83_MONDAY,
    kind: "added",
    startMinute: 600,
  });

  const exceptions = await t.run(async (ctx) => {
    const reader = availabilityReader(ctx);
    const exception = await reader.getException(broken);
    expect(exception).toMatchObject({ id: broken, kind: "added" });
    expect(exception?.windows).toBeUndefined();
    return await reader.listExceptions({
      professionalId: proA,
      from: "2026-10-12",
      to: "2026-10-12",
    });
  });
  // Si se descartara en silencio, con una cancelación se ofrecerían cupos
  // retirados. Las reglas de validez son de TI2-81 y no se repiten aquí.
  expect(exceptions.status === "ok" && exceptions.data.map((item) => item.id)).toEqual([broken]);
  expect(() =>
    expandAvailabilitySlots({
      professionalId: proA,
      blocks: [],
      exceptions: exceptions.status === "ok" ? exceptions.data : [],
      from: "2026-10-12",
      to: "2026-10-12",
      timeZone: "UTC",
    }),
  ).toThrow("el agregado de un día requiere al menos una ventana");
});

test("repositorio de disponibilidad TI2-95: lo leído alimenta la expansión de TI2-81", async () => {
  const t = convexTest(schema, modules);
  const { proA } = await seedTi95Professionals(t);
  const room = await seedTi83Space(t, {
    campus: "Norte",
    building: "C",
    floor: "2",
    room: "C-204",
  });
  const block = await seedTi83Block(t, { professionalId: proA, weekday: 1, spaceId: room });
  // La cancelación del lunes solo aplica si la fecha guardada vuelve como
  // "2026-10-12"; si la conversión corriera un día, aparecerían sus cupos.
  await seedTi83Exception(t, { professionalId: proA, date: TI83_MONDAY, blockId: block });
  await seedTi83Exception(t, {
    professionalId: proA,
    date: TI83_TUESDAY,
    kind: "added",
    startMinute: 600,
    endMinute: 660,
    slotMinutes: 30,
    modality: "online",
  });

  const slots = await t.run(async (ctx) => {
    const reader = availabilityReader(ctx);
    const blocks = await reader.listActiveBlocks(proA);
    const exceptions = await reader.listExceptions({
      professionalId: proA,
      from: "2026-10-12",
      to: "2026-10-13",
    });
    if (blocks.status !== "ok" || exceptions.status !== "ok") {
      throw new Error("Lectura de disponibilidad rechazada.");
    }
    return expandAvailabilitySlots({
      professionalId: proA,
      blocks: blocks.data,
      exceptions: exceptions.data,
      from: "2026-10-12",
      to: "2026-10-13",
      timeZone: "UTC",
    });
  });
  expect(slots.map((slot) => [slot.date, slot.startAt, slot.modality])).toEqual([
    ["2026-10-13", TI83_TUESDAY + 600 * 60_000, "online"],
    ["2026-10-13", TI83_TUESDAY + 630 * 60_000, "online"],
  ]);
});

async function countTi95Rows(
  t: ReturnType<typeof convexTest>,
  table: "availabilityBlocks" | "availabilityExceptions",
) {
  return await t.run(async (ctx) => (await ctx.db.query(table).collect()).length);
}

test("repositorio de disponibilidad TI2-95: guarda bloques que la expansión acepta y rechaza el resto sin escribir", async () => {
  const t = convexTest(schema, modules);
  const { proA, proB } = await seedTi95Professionals(t);
  const room = await seedTi83Space(t, {
    campus: "Norte",
    building: "C",
    floor: "2",
    room: "C-204",
  });
  const retiredRoom = await seedTi83Space(t, {
    campus: "Norte",
    building: "C",
    floor: "1",
    room: "C-101",
    isActive: false,
  });

  await t.run(async (ctx) => {
    const writer: AvailabilityWriter = availabilityWriter(ctx);
    const reader = availabilityReader(ctx);
    const valid = {
      professionalId: proA,
      weekday: 1,
      startMinute: 540,
      endMinute: 720,
      slotMinutes: 60,
      modality: "inPerson" as const,
      spaceId: room,
    };
    const inPerson = await writer.insertBlock(valid);
    const online = await writer.insertBlock({
      professionalId: proA,
      weekday: 2,
      startMinute: 600,
      endMinute: 660,
      slotMinutes: 30,
      modality: "online",
    });
    if (inPerson.status !== "ok" || online.status !== "ok") {
      throw new Error("Escritura válida rechazada.");
    }
    expect(await reader.getBlock(inPerson.data.blockId)).toEqual({
      id: inPerson.data.blockId,
      ...valid,
      isActive: true,
      version: "v1",
    });
    expect("spaceId" in (await reader.getBlock(online.data.blockId))!).toBe(false);

    const rejected = [
      { ...valid, spaceId: undefined },
      { ...valid, modality: "online" as const },
      { ...valid, spaceId: retiredRoom },
      { ...valid, spaceId: proB },
      { ...valid, weekday: 7 },
      { ...valid, startMinute: 720, endMinute: 540 },
      { ...valid, slotMinutes: 240 },
      { ...valid, professionalId: room },
    ];
    for (const block of rejected) {
      expect(await writer.insertBlock(block)).toEqual(TI95_CONFLICT);
    }
  });
  expect(await countTi95Rows(t, "availabilityBlocks")).toBe(2);
});

test("repositorio de disponibilidad TI2-95: editar, retirar y reactivar un bloque conserva a su dueño", async () => {
  const t = convexTest(schema, modules);
  const { proA, proB } = await seedTi95Professionals(t);
  const room = await seedTi83Space(t, {
    campus: "Norte",
    building: "C",
    floor: "2",
    room: "C-204",
  });
  const retiredRoom = await seedTi83Space(t, {
    campus: "Norte",
    building: "C",
    floor: "1",
    room: "C-101",
    isActive: false,
  });
  const inPerson = {
    professionalId: proA,
    weekday: 1,
    startMinute: 540,
    endMinute: 720,
    slotMinutes: 60,
    modality: "inPerson" as const,
    spaceId: room,
  };
  const ids = await t.run(async (ctx) => {
    const writer = availabilityWriter(ctx);
    const first = await writer.insertBlock(inPerson);
    const second = await writer.insertBlock({ ...inPerson, weekday: 3 });
    if (first.status !== "ok" || second.status !== "ok") {
      throw new Error("Escritura válida rechazada.");
    }
    return { first: first.data.blockId, second: second.data.blockId };
  });

  await t.run(async (ctx) => {
    const writer = availabilityWriter(ctx);
    const reader = availabilityReader(ctx);
    // Pasar a en línea quita la sala; el dueño guardado no cambia.
    expect(
      await writer.updateBlock(ids.first, {
        weekday: 2,
        startMinute: 600,
        endMinute: 720,
        slotMinutes: 30,
        modality: "online",
      }),
    ).toEqual({ status: "ok", data: null });
    const updated = await reader.getBlock(ids.first);
    expect(updated).toMatchObject({
      professionalId: proA,
      weekday: 2,
      startMinute: 600,
      endMinute: 720,
      slotMinutes: 30,
      modality: "online",
    });
    expect("spaceId" in updated!).toBe(false);
    // Una edición inválida no toca la fila: en línea con sala, sala retirada
    // o un id que no es de sala.
    for (const spaceId of [room, retiredRoom, proA]) {
      expect(
        await writer.updateBlock(ids.first, {
          weekday: 2,
          startMinute: 600,
          endMinute: 720,
          slotMinutes: 30,
          modality: spaceId === room ? "online" : "inPerson",
          spaceId,
        }),
      ).toEqual(TI95_CONFLICT);
    }
    expect(await reader.getBlock(ids.first)).toEqual(updated);
    expect(await writer.updateBlock(room, { ...inPerson, weekday: 2 })).toEqual(TI95_CONFLICT);
    // Un `professionalId` que llegue junto a la ventana no cambia al dueño.
    const withOtherOwner = { ...inPerson, weekday: 4, professionalId: proB };
    expect(await writer.updateBlock(ids.first, withOtherOwner)).toEqual({
      status: "ok",
      data: null,
    });
    expect(await reader.getBlock(ids.first)).toMatchObject({ professionalId: proA, weekday: 4 });

    expect(await writer.setBlockActive(ids.first, false)).toEqual({ status: "ok", data: null });
    expect(await reader.getBlock(ids.first)).toMatchObject({ isActive: false });
    expect(await writer.setBlockActive(ids.first, true)).toEqual({ status: "ok", data: null });
    expect(await reader.getBlock(ids.first)).toMatchObject({ isActive: true });
    expect(await writer.setBlockActive(room, false)).toEqual(TI95_CONFLICT);

    // Con la sala vigente el bloque presencial vuelve; con la sala retirada
    // del catálogo, no.
    expect(await writer.setBlockActive(ids.second, false)).toEqual({ status: "ok", data: null });
    expect(await writer.setBlockActive(ids.second, true)).toEqual({ status: "ok", data: null });
    expect(await reader.getBlock(ids.second)).toMatchObject({ isActive: true });
    expect(await writer.setBlockActive(ids.second, false)).toEqual({ status: "ok", data: null });
    await ctx.db.patch(room, { isActive: false });
    expect(await writer.setBlockActive(ids.second, true)).toEqual(TI95_CONFLICT);
    expect(await reader.getBlock(ids.second)).toMatchObject({ isActive: false });
  });
});

test("repositorio de disponibilidad TI2-95: guarda excepciones válidas y rechaza el resto sin escribir", async () => {
  const t = convexTest(schema, modules);
  const { proA, proB } = await seedTi95Professionals(t);
  const room = await seedTi83Space(t, {
    campus: "Norte",
    building: "C",
    floor: "2",
    room: "C-204",
  });
  const retiredRoom = await seedTi83Space(t, {
    campus: "Norte",
    building: "C",
    floor: "1",
    room: "C-101",
    isActive: false,
  });
  const window = {
    startMinute: 600,
    endMinute: 660,
    slotMinutes: 30,
    modality: "inPerson" as const,
    spaceId: room,
  };

  const ids = await t.run(async (ctx) => {
    const writer: AvailabilityWriter = availabilityWriter(ctx);
    const own = await writer.insertBlock({ professionalId: proA, weekday: 1, ...window });
    const foreign = await writer.insertBlock({
      professionalId: proB,
      weekday: 1,
      startMinute: 600,
      endMinute: 660,
      slotMinutes: 30,
      modality: "online",
    });
    const dayCancel = await writer.insertException({
      professionalId: proA,
      date: "2026-10-12",
      kind: "cancelled",
      reason: "Motivo ficticio",
    });
    if (own.status !== "ok" || foreign.status !== "ok" || dayCancel.status !== "ok") {
      throw new Error("Escritura válida rechazada.");
    }
    const blockCancel = await writer.insertException({
      professionalId: proA,
      date: "2026-10-19",
      kind: "cancelled",
      blockId: own.data.blockId,
    });
    const added = await writer.insertException({
      professionalId: proA,
      date: "2026-10-13",
      kind: "added",
      windows: [window],
    });
    expect(blockCancel.status).toBe("ok");
    expect(added.status).toBe("ok");

    const base = { professionalId: proA, date: "2026-10-14" };
    const rejected = [
      // Repite la cancelación del día completo ya guardada.
      { ...base, date: "2026-10-12", kind: "cancelled" as const },
      { ...base, kind: "cancelled" as const, blockId: foreign.data.blockId },
      { ...base, kind: "cancelled" as const, blockId: room },
      { ...base, kind: "cancelled" as const, windows: [window] },
      { ...base, kind: "added" as const },
      // Dos ventanas válidas: se rechaza por traer más de una, no por ellas.
      {
        ...base,
        kind: "added" as const,
        windows: [window, { ...window, startMinute: 700, endMinute: 760 }],
      },
      { ...base, kind: "added" as const, blockId: own.data.blockId, windows: [window] },
      { ...base, kind: "added" as const, windows: [{ ...window, spaceId: undefined }] },
      { ...base, kind: "added" as const, windows: [{ ...window, spaceId: retiredRoom }] },
      { ...base, date: "2026-02-30", kind: "cancelled" as const },
      { ...base, professionalId: room, kind: "cancelled" as const },
    ];
    for (const exception of rejected) {
      expect(await writer.insertException(exception)).toEqual(TI95_CONFLICT);
    }
    return { dayCancel: dayCancel.data.exceptionId, own: own.data.blockId };
  });
  expect(await countTi95Rows(t, "availabilityExceptions")).toBe(3);

  await t.run(async (ctx) => {
    const reader = availabilityReader(ctx);
    const blocks = await reader.listActiveBlocks(proA);
    const exceptions = await reader.listExceptions({
      professionalId: proA,
      from: "2026-10-12",
      to: "2026-10-19",
    });
    if (blocks.status !== "ok" || exceptions.status !== "ok") {
      throw new Error("Lectura de disponibilidad rechazada.");
    }
    expect(exceptions.data.map((item) => [item.date, item.kind])).toEqual([
      ["2026-10-12", "cancelled"],
      ["2026-10-13", "added"],
      ["2026-10-19", "cancelled"],
    ]);
    expect(exceptions.data[0]).toMatchObject({ reason: "Motivo ficticio" });
    // Lo escrito siempre se puede expandir.
    const slots = expandAvailabilitySlots({
      professionalId: proA,
      blocks: blocks.data,
      exceptions: exceptions.data,
      from: "2026-10-12",
      to: "2026-10-19",
      timeZone: "UTC",
    });
    expect(slots.map((slot) => slot.date)).toEqual(["2026-10-13", "2026-10-13"]);

    const writer = availabilityWriter(ctx);
    expect(await writer.removeException(ids.dayCancel)).toEqual({ status: "ok", data: null });
    expect(await writer.removeException(ids.dayCancel)).toEqual(TI95_CONFLICT);
    expect(await writer.removeException(ids.own)).toEqual(TI95_CONFLICT);
  });
  expect(await countTi95Rows(t, "availabilityExceptions")).toBe(2);
});

test("repositorio de disponibilidad TI2-95: las escrituras respetan los topes que después permiten leer", async () => {
  const t = convexTest(schema, modules);
  const { proA, proB } = await seedTi95Professionals(t);
  const online = {
    startMinute: 540,
    endMinute: 600,
    slotMinutes: 30,
    modality: "online" as const,
  };
  const retired = await t.run(async (ctx) => {
    for (let index = 0; index < MAX_ACTIVE_BLOCKS - 1; index += 1) {
      await ctx.db.insert("availabilityBlocks", {
        professionalId: proA,
        weekday: index % 7,
        ...online,
        isActive: true,
      });
    }
    // 299 excepciones en los 90 días anteriores a la fecha que se escribe.
    for (let index = 0; index < MAX_EXCEPTIONS_IN_RANGE - 1; index += 1) {
      await ctx.db.insert("availabilityExceptions", {
        professionalId: proB,
        date: TI83_MONDAY + (index % 90) * TI95_DAY_MS,
        kind: "cancelled",
      });
    }
    return await ctx.db.insert("availabilityBlocks", {
      professionalId: proA,
      weekday: 0,
      ...online,
      isActive: false,
    });
  });

  await t.run(async (ctx) => {
    const writer = availabilityWriter(ctx);
    const reader = availabilityReader(ctx);
    // Bloques: el que completa el tope entra; el siguiente y la reactivación no.
    expect((await writer.insertBlock({ professionalId: proA, weekday: 1, ...online })).status).toBe(
      "ok",
    );
    expect(await writer.insertBlock({ professionalId: proA, weekday: 2, ...online })).toEqual(
      TI95_CONFLICT,
    );
    expect(await writer.setBlockActive(retired, true)).toEqual(TI95_CONFLICT);
    const blocks = await reader.listActiveBlocks(proA);
    expect(blocks.status === "ok" && blocks.data.length).toBe(MAX_ACTIVE_BLOCKS);

    // Excepciones: la que completa el tope en 92 días entra y se sigue leyendo;
    // la siguiente, a un día de distancia, no.
    const day90 = { professionalId: proB, date: "2027-01-10", kind: "cancelled" as const };
    expect((await writer.insertException(day90)).status).toBe("ok");
    expect(await writer.insertException({ ...day90, date: "2027-01-11" })).toEqual(TI95_CONFLICT);
    const exceptions = await reader.listExceptions({
      professionalId: proB,
      from: "2026-10-12",
      to: "2027-01-11",
    });
    expect(exceptions.status === "ok" && exceptions.data.length).toBe(MAX_EXCEPTIONS_IN_RANGE);
  });
});

/**
 * Repositorio de espacios (TI2-95): lecturas técnicas que usa disponibilidad,
 * el puerto que las entrega con el contrato `Space` y creación de salas sin
 * repetir la ubicación. El catálogo publicado es de TI2-99.
 */

const TI95_C204 = { campus: "Norte", building: "C", floor: "2", room: "C-204" };

test("repositorio de espacios TI2-95: lecturas técnicas con el catálogo vacío y con una sala retirada", async () => {
  const t = convexTest(schema, modules);
  const { proA } = await seedTi95Professionals(t);

  await t.run(async (ctx) => {
    // Con el catálogo vacío ninguna lectura inventa una sala.
    expect(await getSpaceRow(ctx, proA)).toBe(null);
    expect(await getSpaceRow(ctx, "no-es-un-id")).toBe(null);
    expect(await findSpaceRowByLocation(ctx, TI95_C204)).toBe(null);
  });

  const retired = await seedTi83Space(t, { ...TI95_C204, isActive: false });
  const deleted = await seedTi83Space(t, { ...TI95_C204, room: "C-205" });
  await t.run(async (ctx) => {
    await ctx.db.delete(deleted);
  });

  await t.run(async (ctx) => {
    // La lectura técnica también ve la sala retirada: disponibilidad decide
    // con `isActive` que no sirve para un bloque.
    expect(await getSpaceRow(ctx, retired)).toMatchObject({ _id: retired, isActive: false });
    expect(await findSpaceRowByLocation(ctx, TI95_C204)).toMatchObject({ _id: retired });
    expect(await getSpaceRow(ctx, deleted)).toBe(null);
    expect(await findSpaceRowByLocation(ctx, { ...TI95_C204, room: "C-205" })).toBe(null);
  });
});

test("repositorio de espacios TI2-95: crea salas vigentes sin repetir la ubicación", async () => {
  const t = convexTest(schema, modules);
  const retired = await seedTi83Space(t, { ...TI95_C204, room: "C-101", isActive: false });

  await t.run(async (ctx) => {
    const created = await insertSpace(ctx, {
      ...TI95_C204,
      accessConditions: "Rampa ficticia",
      arrivalInstructions: "Instrucción de llegada ficticia",
    });
    if (created.status !== "ok") {
      throw new Error("Creación válida rechazada.");
    }
    // El vocabulario del contrato se guarda con el del esquema.
    expect(await getSpaceRow(ctx, created.data.spaceId)).toMatchObject({
      ...TI95_C204,
      accessConditions: "Rampa ficticia",
      accessInstructions: "Instrucción de llegada ficticia",
      isActive: true,
    });

    const sameRoom = {
      ...TI95_C204,
      accessConditions: "Otra condición ficticia",
      arrivalInstructions: "Otra instrucción ficticia",
    };
    // Misma ubicación con otras condiciones, o la de una sala retirada: es la
    // misma sala.
    expect(await insertSpace(ctx, sameRoom)).toEqual(TI95_CONFLICT);
    expect(await insertSpace(ctx, { ...sameRoom, room: "C-101" })).toEqual(TI95_CONFLICT);
    // El rechazo no sobrescribe las salas que ya estaban.
    expect(await getSpaceRow(ctx, created.data.spaceId)).toMatchObject({
      accessConditions: "Rampa ficticia",
      accessInstructions: "Instrucción de llegada ficticia",
    });
    expect(await getSpaceRow(ctx, retired)).toMatchObject({
      accessConditions: "Condición de acceso ficticia",
      accessInstructions: "Instrucción de llegada ficticia",
      isActive: false,
    });
    // Otro piso es otra sala.
    expect((await insertSpace(ctx, { ...sameRoom, floor: "3" })).status).toBe("ok");
  });
  expect(await t.run(async (ctx) => (await ctx.db.query("spaces").collect()).length)).toBe(3);
});

test("repositorio de espacios TI2-95: el puerto técnico entrega el contrato Space con su vigencia", async () => {
  const t = convexTest(schema, modules);
  const { proA } = await seedTi95Professionals(t);
  const active = await seedTi83Space(t, TI95_C204);
  const retired = await seedTi83Space(t, { ...TI95_C204, room: "C-205", isActive: false });
  const deleted = await seedTi83Space(t, { ...TI95_C204, room: "C-206" });
  await t.run(async (ctx) => {
    await ctx.db.delete(deleted);
  });
  const contract = {
    campus: "Norte",
    building: "C",
    floor: "2",
    accessConditions: "Condición de acceso ficticia",
    arrivalInstructions: "Instrucción de llegada ficticia",
    version: SPACE_CATALOG_CONTRACT_VERSION,
  };

  await t.run(async (ctx) => {
    const reader: SpaceReader = spaceReader(ctx);
    // Claves exactas: el contrato de TI2-87 más `isActive`, sin `_id`,
    // `_creationTime` ni el `accessInstructions` del esquema.
    expect(await reader.getSpace(active)).toStrictEqual({
      ...contract,
      id: active,
      room: "C-204",
      isActive: true,
    });
    expect(await reader.findSpaceByLocation(TI95_C204)).toStrictEqual({
      ...contract,
      id: active,
      room: "C-204",
      isActive: true,
    });
    // La lectura técnica también ve la sala retirada.
    const retiredSpace = { ...contract, id: retired, room: "C-205", isActive: false };
    expect(await reader.getSpace(retired)).toStrictEqual(retiredSpace);
    expect(await reader.findSpaceByLocation({ ...TI95_C204, room: "C-205" })).toStrictEqual(
      retiredSpace,
    );
    // Borrada, de otra tabla o sin forma de id responde como una inexistente.
    expect(await reader.getSpace(deleted)).toBe(null);
    expect(await reader.getSpace(proA)).toBe(null);
    expect(await reader.getSpace("no-es-un-id")).toBe(null);
    expect(await reader.findSpaceByLocation({ ...TI95_C204, room: "C-206" })).toBe(null);
  });
});

// ── TI2-111: necesidades y condiciones como líneas de texto ──────────────────
//
// Decisión provisional de TI2-111: cada línea guardada es una necesidad con
// su texto como identificador, y una sala cubre solo las líneas que repite.
// Estas pruebas fijan esa traducción y que nunca rebaja una necesidad.

test("TI2-111: cada línea del texto guardado es una necesidad, sin vacías ni repetidas", () => {
  expect(accessNeedsFromLines("  Sala físicamente accesible \n\nPersona de apoyo\r\n")).toEqual([
    { id: "Sala físicamente accesible", label: "Sala físicamente accesible" },
    { id: "Persona de apoyo", label: "Persona de apoyo" },
  ]);
  expect(accessNeedsFromLines("Persona de apoyo\nPersona de apoyo")).toHaveLength(1);
  expect(accessNeedsFromLines("   \n")).toEqual([]);
  // El texto libre de la solicitud también es una necesidad: no se descarta.
  expect(accessNeedsFromLines("Necesidad descrita con palabras propias")).toEqual([
    {
      id: "Necesidad descrita con palabras propias",
      label: "Necesidad descrita con palabras propias",
    },
  ]);
});

test("TI2-111: los adaptadores entregan necesidades y salas vigentes con la misma traducción", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti111-db-est-1",
    email: "ti111-db-est-1@alu.uct.cl",
    role: "student",
  });
  const accompanimentId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Sala físicamente accesible\nPersona de apoyo",
    });
  });
  const roomFields = {
    campus: "Campus ficticio",
    building: "B",
    floor: "1",
    accessInstructions: "Instrucción de llegada ficticia",
  };
  const coveringRoom = await t.run(async (ctx) => {
    return await ctx.db.insert("spaces", {
      ...roomFields,
      room: "Cubre todo",
      accessConditions: "Persona de apoyo\nSala físicamente accesible\nReducción de estímulos",
      isActive: true,
    });
  });
  const partialRoom = await t.run(async (ctx) => {
    return await ctx.db.insert("spaces", {
      ...roomFields,
      room: "Cubre una",
      accessConditions: "Sala físicamente accesible",
      isActive: true,
    });
  });
  const retiredRoom = await t.run(async (ctx) => {
    return await ctx.db.insert("spaces", {
      ...roomFields,
      room: "Retirada",
      accessConditions: "Sala físicamente accesible\nPersona de apoyo",
      isActive: false,
    });
  });

  const result = await t.run(async (ctx) => {
    const needsReader: AccompanimentNeedsReader = accompanimentNeedsReader(ctx);
    const spaces: CompatibilitySpaceSource = compatibilitySpaceSource(ctx);
    const entry = await needsReader.findAccompanimentNeeds(accompanimentId);
    if (entry === null) throw new Error("Se esperaban necesidades");
    const decide = async (spaceId: string) => {
      const space = await spaces.findCompatibilitySpace(spaceId);
      return space === null
        ? "sin sala"
        : assessCompatibility(entry.needs, { modality: "inPerson", space }).compatible;
    };
    return {
      entry,
      ajena: await needsReader.findAccompanimentNeeds(studentId),
      inexistente: await needsReader.findAccompanimentNeeds("no-existe"),
      cubreTodo: await decide(coveringRoom),
      cubreUna: await decide(partialRoom),
      retirada: await decide(retiredRoom),
      otraTabla: await decide(accompanimentId),
      enLinea: assessCompatibility(entry.needs, {
        modality: "online",
        onlineSupports: await spaces.listOnlineSupports(),
      }).compatible,
      enLineaSinNecesidades: assessCompatibility([], {
        modality: "online",
        onlineSupports: await spaces.listOnlineSupports(),
      }).compatible,
    };
  });

  expect(result.entry).toEqual({
    _id: accompanimentId,
    needs: [
      { id: "Sala físicamente accesible", label: "Sala físicamente accesible" },
      { id: "Persona de apoyo", label: "Persona de apoyo" },
    ],
  });
  expect(result).toMatchObject({
    ajena: null,
    inexistente: null,
    cubreTodo: true,
    cubreUna: false,
    retirada: "sin sala",
    otraTabla: "sin sala",
    enLinea: false,
    enLineaSinNecesidades: true,
  });
});
