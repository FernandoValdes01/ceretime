/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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
  await t.mutation(internal.users.createTestUser, profile);

  await expect(
    t.mutation(internal.users.createTestUser, {
      ...profile,
      email: "otro@alu.uct.cl",
    }),
  ).rejects.toThrow("Ya existe un perfil");

  await expect(
    t.mutation(internal.users.createTestUser, {
      ...profile,
      tokenIdentifier: `${ISSUER}|ti17-duplicado-2`,
    }),
  ).rejects.toThrow("Ya existe un perfil con este correo");

  await expect(
    t.mutation(internal.users.createTestUser, {
      ...profile,
      email: "Duplicado@alu.uct.cl",
      tokenIdentifier: `${ISSUER}|ti17-duplicado-3`,
    }),
  ).rejects.toThrow("Ya existe un perfil con este correo");

  await expect(
    t.mutation(internal.users.createTestUser, {
      ...profile,
      email: "  duplicado@alu.uct.cl  ",
      tokenIdentifier: `${ISSUER}|ti17-duplicado-4`,
    }),
  ).rejects.toThrow("Ya existe un perfil con este correo");
});

test("la semilla normaliza el correo antes de guardarlo", async () => {
  const t = convexTest(schema, modules);
  const createdId = await t.mutation(internal.users.createTestUser, {
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
    t.mutation(internal.accounts.ensureBootstrapAdmin, {
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
  await asBootstrap.mutation(internal.assignments.assign, {
    accompanimentId: accompaniment,
    userId: proId,
    assignedRole: "professional",
  });
  const asPro = t.withIdentity(identityFor("ti17-miss-pro", "misspro@uct.cl"));
  // TI2-28: el recurso inexistente se deniega con el mismo error genérico,
  // sin revelar existencia, y no se crea ninguna fila.
  await expect(
    asPro.mutation(internal.assignments.assign, {
      accompanimentId: missingAccompaniment,
      userId: intern,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("No autorizado");
  await expect(
    asPro.mutation(internal.assignments.assign, {
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
  const adminId = await t.mutation(internal.accounts.ensureBootstrapAdmin, {
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
  await asAdmin.mutation(internal.accounts.enableIntern, { userId: internId });
  const enabled = await t.run(async (ctx) => {
    return await ctx.db.get(internId);
  });
  expect(enabled?.institutionalStatus).toBe("enabled");
  expect(enabled?.enabledBy).toEqual(adminId);
  expect(typeof enabled?.enabledAt).toBe("number");

  const requestId = await t.mutation(internal.requests.createTestRequest, {
    studentId,
    status: "accepted",
    accessNeeds: "Necesidad de acceso ficticia",
  });
  const request = await t.query(internal.requests.getRequestById, { id: requestId });
  expect(typeof request?.createdAt).toBe("number");

  const accompanimentId = await seedAccompaniment(t, studentId, requestId);

  // TI2-28: la concesión a Practicante exige profesional autorizado sobre el
  // acompañamiento; esta fila profesional suma una unidad al barrido.
  const asBootstrap = t.withIdentity(identityFor("ti17-traza-boot", "trazaboot@uct.cl"));
  await asBootstrap.mutation(internal.assignments.assign, {
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
  await asPro.mutation(internal.assignments.assign, input);
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

  await asPro.mutation(internal.assignments.revoke, input);
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

  const audit = await t.query(internal.migrations.auditAssignmentTraceability, {
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
  await asBootstrap.mutation(internal.assignments.assign, {
    accompanimentId: accA,
    userId: proId,
    assignedRole: "professional",
  });
  await asPro.mutation(internal.assignments.assign, {
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
  await asPro.mutation(internal.assignments.assign, {
    accompanimentId: guarded,
    userId: proId,
    assignedRole: "professional",
  });

  const first = await t.query(internal.migrations.auditAssignmentTraceability, {
    paginationOpts: { numItems: 2, cursor: null },
  });
  expect(first.scanned).toBe(2);
  expect(first.missingGrant).toBe(2);
  expect(first.activeMissingGrant).toBe(1);
  expect(first.missingRevoke).toBe(1);
  expect(first.sampleLegacyIds).toHaveLength(2);
  expect(first.isDone).toBe(false);

  const second = await t.query(internal.migrations.auditAssignmentTraceability, {
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

  await expect(t.mutation(internal.migrations.migrateLegacyAssignments, input)).rejects.toThrow(
    "No autorizado",
  );

  const asStudent = t.withIdentity(identityFor("ti17-mig-est", "migest@alu.uct.cl"));
  await expect(
    asStudent.mutation(internal.migrations.migrateLegacyAssignments, input),
  ).rejects.toThrow("No autorizado");

  const asPro = t.withIdentity(identityFor("ti17-mig-pro", "migpro@uct.cl"));
  await expect(asPro.mutation(internal.migrations.migrateLegacyAssignments, input)).rejects.toThrow(
    "No autorizado",
  );
});

test("la migración acepta la identidad mínima del CLI (subject, issuer y tokenIdentifier)", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.accounts.ensureBootstrapAdmin, {
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
  const migrated = await asCliAdmin.mutation(internal.migrations.migrateLegacyAssignments, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(migrated.scanned).toBe(0);
  expect(migrated.revoked).toBe(0);
  expect(migrated.isDone).toBe(true);
});

test("la migración revoca activas legacy sin inventar concesión", async () => {
  const t = convexTest(schema, modules);
  const adminId = await t.mutation(internal.accounts.ensureBootstrapAdmin, {
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
  await asPro.mutation(internal.assignments.assign, {
    accompanimentId: guarded,
    userId: proId,
    assignedRole: "professional",
  });

  const asAdmin = t.withIdentity(identityFor("ti17-mig-adm", "migadmin@uct.cl"));
  const migrated = await asAdmin.mutation(internal.migrations.migrateLegacyAssignments, {
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

  const audit = await t.query(internal.migrations.auditAssignmentTraceability, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(audit.activeMissingGrant).toBe(0);
  expect(audit.missingGrant).toBe(2);
  expect(audit.isDone).toBe(true);
});

test("la migración avanza por páginas hasta agotar las filas", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.accounts.ensureBootstrapAdmin, {
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
  const first = await asAdmin.mutation(internal.migrations.migrateLegacyAssignments, {
    paginationOpts: { numItems: 2, cursor: null },
  });
  expect(first.scanned).toBe(2);
  expect(first.revoked).toBe(2);
  expect(first.isDone).toBe(false);

  const second = await asAdmin.mutation(internal.migrations.migrateLegacyAssignments, {
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  expect(second.scanned).toBe(1);
  expect(second.revoked).toBe(1);
  expect(second.isDone).toBe(true);
});
