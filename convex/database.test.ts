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
      .withIndex("by_token_identifier", (q) =>
        q.eq("tokenIdentifier", `${ISSUER}|ti17-int-1`),
      )
      .unique();
  });
  expect(byToken?._id).toEqual(internId);

  const pending = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_institutional_status", (q) => q.eq("institutionalStatus", "pending"))
      .collect();
  });
  expect(pending.map((user) => user._id)).toEqual([internId]);

  const admins = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .collect();
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
      .collect();
  });
  expect(ownA.map((request) => request._id).sort()).toEqual([aReceived, aReview].sort());

  const received = await t.run(async (ctx) => {
    return await ctx.db
      .query("requests")
      .withIndex("by_status", (q) => q.eq("status", "received"))
      .collect();
  });
  expect(received.map((request) => request._id).sort()).toEqual([aReceived, bReceived].sort());

  const ownReceived = await t.run(async (ctx) => {
    return await ctx.db
      .query("requests")
      .withIndex("by_student_and_status", (q) =>
        q.eq("studentId", studentA).eq("status", "received"),
      )
      .collect();
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
      .collect();
  });
  expect(found.map((accompaniment) => accompaniment._id)).toEqual([linked]);

  const stored = await t.run(async (ctx) => {
    return await ctx.db.get(unlinked);
  });
  expect(stored?.requestId).toBeUndefined();
});

test("integridad de asignaciones: el acompañamiento y el usuario deben existir", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti17-miss-pro",
    email: "misspro@uct.cl",
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

  const asPro = t.withIdentity(identityFor("ti17-miss-pro", "misspro@uct.cl"));
  await expect(
    asPro.mutation(internal.assignments.assign, {
      accompanimentId: missingAccompaniment,
      userId: intern,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("deben existir");
  await expect(
    asPro.mutation(internal.assignments.assign, {
      accompanimentId: accompaniment,
      userId: missingUser,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("deben existir");
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

  const audit = await t.query(internal.migrations.auditAssignmentTraceability, {});
  expect(audit.scanned).toBe(1);
  expect(audit.missingGrant).toBe(0);
  expect(audit.missingRevoke).toBe(0);
  expect(audit.hasMore).toBe(false);
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
  const list = await asIntern.query(
    api.presentation.accompaniments.listAssignedAccompaniments,
    { limit: 10 },
  );
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

  const asPro = t.withIdentity(identityFor("ti17-audit-pro", "auditpro@uct.cl"));
  await asPro.mutation(internal.assignments.assign, {
    accompanimentId: guarded,
    userId: proId,
    assignedRole: "professional",
  });

  const audit = await t.query(internal.migrations.auditAssignmentTraceability, {});
  expect(audit.scanned).toBe(3);
  expect(audit.missingGrant).toBe(2);
  expect(audit.missingRevoke).toBe(1);
  expect(audit.sampleLegacyIds).toHaveLength(2);
  expect(audit.hasMore).toBe(false);

  const paged = await t.query(internal.migrations.auditAssignmentTraceability, { limit: 2 });
  expect(paged.scanned).toBe(2);
  expect(paged.hasMore).toBe(true);
});
