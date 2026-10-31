/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { deniedPublicError } from "../application/authorization/authorize";
import {
  conflictError,
  errResult,
  isErrorResult,
  isOkResult,
  noAvailabilityError,
  okResult,
  unauthorizedError,
} from "../domain/errors/api_error";
import { ACCESS_NEEDS_MAX_LENGTH } from "../domain/requests/request";
import { MAX_APPOINTMENTS_IN_RANGE } from "../infrastructure/appointments/repository";
import {
  denyUnauthorized,
  throwPublicApiError,
  toSecureConvexError,
} from "../presentation/session";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

// `createTestRequest` es una semilla guardada: solo opera con el interruptor
// activado, como en `database.test.ts` (aislado por archivo).
vi.stubEnv("TEST_SEEDS_ENABLED", "true");

/**
 * Superficie API del Backend en Sprint 1 (TI2-26).
 *
 * Las mutations públicas son adaptadores delgados: validan la forma de
 * entrada, resuelven la identidad en el servidor y delegan las reglas en
 * Aplicación/Dominio. La habilitación y la concesión siguen en vías internas
 * guardadas y el Sprint 1 no usa `action`. Cada prueba usa identidad simulada
 * (`withIdentity` con `tokenIdentifier` explícito) y datos ficticios.
 */

const ISSUER = "https://accounts.google.com";

/** Identidad simulada con `tokenIdentifier` explícito. */
function identityFor(subject: string, email: string) {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email,
    name: "Ficticio",
  };
}

/** Usuario ficticio persistido con identidad vinculada. */
async function seedUser(
  t: ReturnType<typeof convexTest>,
  input: {
    subject: string;
    email: string;
    role: "student" | "professional" | "intern" | "admin";
    institutionalStatus?: "enabled" | "disabled" | "pending";
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: input.email,
      fullName: "Ficticio",
      role: input.role,
      institutionalStatus: input.institutionalStatus ?? "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${input.subject}`,
    });
  });
}

/**
 * Confirma que no persiste ninguna solicitud con una lectura acotada: basta
 * la primera fila para saber que el rechazo no guardó nada, sin barrer la
 * tabla.
 */
async function expectNoRequests(t: ReturnType<typeof convexTest>) {
  const found = await t.run(async (ctx) => {
    return await ctx.db.query("requests").first();
  });
  expect(found).toBeNull();
}

test("Registro válido guarda la necesidad recortada en estado recibido", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, { subject: "ti26-est-1", email: "ti26-est-1@alu.uct.cl", role: "student" });

  const asStudent = t.withIdentity(identityFor("ti26-est-1", "ti26-est-1@alu.uct.cl"));
  const created = await asStudent.mutation(api.presentation.requests.createRequest, {
    accessNeeds: "  Necesidad de acceso ficticia  ",
  });
  expect(created.status).toBe("received");
  expect(created.accessNeeds).toBe("Necesidad de acceso ficticia");
});

test("Necesidad vacía se rechaza como error operativo sin persistir", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, { subject: "ti26-est-2", email: "ti26-est-2@alu.uct.cl", role: "student" });

  const asStudent = t.withIdentity(identityFor("ti26-est-2", "ti26-est-2@alu.uct.cl"));
  const message = await asStudent
    .mutation(api.presentation.requests.createRequest, { accessNeeds: "   " })
    .then(
      () => {
        throw new Error("Se esperaba rechazo operativo");
      },
      (error: Error) => error.message,
    );
  expect(message).toContain("necesidad");
  expect(message).not.toContain("No autorizado");
  await expectNoRequests(t);
});

test("Necesidad en el tope se acepta y sobre el tope se rechaza sin persistir", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, { subject: "ti26-est-3", email: "ti26-est-3@alu.uct.cl", role: "student" });

  // Justo en el límite del contrato: se registra íntegro.
  const asStudent = t.withIdentity(identityFor("ti26-est-3", "ti26-est-3@alu.uct.cl"));
  const created = await asStudent.mutation(api.presentation.requests.createRequest, {
    accessNeeds: "x".repeat(ACCESS_NEEDS_MAX_LENGTH),
  });
  expect(created.status).toBe("received");
  expect(created.accessNeeds).toHaveLength(ACCESS_NEEDS_MAX_LENGTH);

  // Un carácter sobre el límite: se rechaza como error operativo.
  await expect(
    asStudent.mutation(api.presentation.requests.createRequest, {
      accessNeeds: "x".repeat(ACCESS_NEEDS_MAX_LENGTH + 1),
    }),
  ).rejects.toThrow("máximo");

  // El rechazo no persiste nada nuevo: sigue existiendo solo la aceptada,
  // comprobado con una lectura acotada en vez de barrer la tabla.
  const stored = await t.query(internal.operations.requests.getRequestById, { id: created._id });
  expect(stored?.status).toBe("received");
  const rows = await t.run(async (ctx) => {
    return await ctx.db.query("requests").take(2);
  });
  expect(rows.map((row) => row._id)).toEqual([created._id]);
});

test("Toma y operación ajena se deniegan con error genérico sin modificar nada", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti26-est-4",
    email: "ti26-est-4@alu.uct.cl",
    role: "student",
  });
  await seedUser(t, { subject: "ti26-pro-1", email: "ti26-pro-1@uct.cl", role: "professional" });
  const requestId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Necesidad de acceso ficticia",
  });

  // Anónimo y Estudiante no toman solicitudes.
  await expect(t.mutation(api.presentation.requests.takeRequest, { requestId })).rejects.toThrow(
    "No autorizado",
  );
  const asStudent = t.withIdentity(identityFor("ti26-est-4", "ti26-est-4@alu.uct.cl"));
  await expect(
    asStudent.mutation(api.presentation.requests.takeRequest, { requestId }),
  ).rejects.toThrow("No autorizado");

  // Profesional vigente sin toma no opera la solicitud ni la modifica.
  const asStranger = t.withIdentity(identityFor("ti26-pro-1", "ti26-pro-1@uct.cl"));
  await expect(
    asStranger.mutation(api.presentation.requests.requestAdditionalInformation, {
      requestId,
      reason: "Falta el horario disponible",
    }),
  ).rejects.toThrow("No autorizado");
  const untouched = await t.query(internal.operations.requests.getRequestById, { id: requestId });
  expect(untouched?.status).toBe("received");
});

test("Habilitación guardada: el administrador habilita y el resto se deniega", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, { subject: "ti26-adm-1", email: "ti26-adm-1@uct.cl", role: "admin" });
  const internId = await seedUser(t, {
    subject: "ti26-int-1",
    email: "ti26-int-1@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });
  const otherId = await seedUser(t, {
    subject: "ti26-int-2",
    email: "ti26-int-2@alu.uct.cl",
    role: "intern",
    institutionalStatus: "pending",
  });
  await seedUser(t, { subject: "ti26-est-5", email: "ti26-est-5@alu.uct.cl", role: "student" });

  // Vía interna con Administrador vigente: habilita sin cambiar el rol.
  const asAdmin = t.withIdentity(identityFor("ti26-adm-1", "ti26-adm-1@uct.cl"));
  const enabledId = await asAdmin.mutation(internal.operations.accounts.enableIntern, {
    userId: internId,
  });
  expect(enabledId).toEqual(internId);

  // Un Estudiante no habilita cuentas por la vía guardada.
  const asStudent = t.withIdentity(identityFor("ti26-est-5", "ti26-est-5@alu.uct.cl"));
  await expect(
    asStudent.mutation(internal.operations.accounts.enableIntern, { userId: otherId }),
  ).rejects.toThrow("No autorizado");
});

test("Concesión guardada: el profesional autorizado concede y el practicante no se auto-asigna", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti26-est-6",
    email: "ti26-est-6@alu.uct.cl",
    role: "student",
  });
  const proId = await seedUser(t, {
    subject: "ti26-pro-2",
    email: "ti26-pro-2@uct.cl",
    role: "professional",
  });
  await seedUser(t, { subject: "ti26-pro-3", email: "ti26-pro-3@uct.cl", role: "professional" });
  const internId = await seedUser(t, {
    subject: "ti26-int-3",
    email: "ti26-int-3@alu.uct.cl",
    role: "intern",
  });
  const accompanimentId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad de acceso ficticia",
    });
  });

  // Arranque entre profesionales y concesión al Practicante habilitado.
  const asBootstrap = t.withIdentity(identityFor("ti26-pro-3", "ti26-pro-3@uct.cl"));
  await asBootstrap.mutation(internal.operations.assignments.assign, {
    accompanimentId,
    userId: proId,
    assignedRole: "professional",
  });
  const asPro = t.withIdentity(identityFor("ti26-pro-2", "ti26-pro-2@uct.cl"));
  await asPro.mutation(internal.operations.assignments.assign, {
    accompanimentId,
    userId: internId,
    assignedRole: "intern",
  });
  const row = await t.run(async (ctx) => {
    return await ctx.db
      .query("accompanimentAssignments")
      .withIndex("by_accompaniment_and_user_and_status_and_assigned_role", (q) =>
        q
          .eq("accompanimentId", accompanimentId as Id<"accompaniments">)
          .eq("userId", internId)
          .eq("status", "active")
          .eq("assignedRole", "intern"),
      )
      .unique();
  });
  expect(row?.grantedBy).toEqual(proId);

  // El Practicante no se auto-asigna accesos por la vía guardada.
  const asIntern = t.withIdentity(identityFor("ti26-int-3", "ti26-int-3@alu.uct.cl"));
  await expect(
    asIntern.mutation(internal.operations.assignments.assign, {
      accompanimentId,
      userId: internId,
      assignedRole: "intern",
    }),
  ).rejects.toThrow("No autorizado");
});

test("Contrato TI2-88: códigos separan conflicto y ausencia de cupo sin filtrar existencia", async () => {
  const denied = unauthorizedError();
  const conflict = conflictError();
  const sinCupo = noAvailabilityError();

  expect(denied).toEqual({ code: "unauthorized", message: "No autorizado" });
  expect(conflict.code).toBe("conflict");
  expect(sinCupo.code).toBe("no_availability");
  expect(new Set([denied.code, conflict.code, sinCupo.code]).size).toBe(3);
  expect(sinCupo.message).toContain("canal oficial");
  expect(sinCupo.message).not.toMatch(/reserv/i);

  const ok = okResult({ id: "ficticio-1" });
  expect(ok).toEqual({ status: "ok", data: { id: "ficticio-1" } });
  expect(Object.keys(ok).sort()).toEqual(["data", "status"]);
  expect(isOkResult(ok)).toBe(true);

  const error = errResult(conflict);
  expect(isErrorResult(error)).toBe(true);
  if (!isErrorResult(error)) throw new Error("Se esperaba error");
  expect(Object.keys(error).sort()).toEqual(["error", "status"]);
  expect(Object.keys(error.error).sort()).toEqual(["code", "message"]);
  expect(error.error.code).not.toBe(error.error.message);
});

test("Contrato TI2-88: traducción segura reutilizada sin detalles sensibles", async () => {
  expect(deniedPublicError()).toEqual({ code: "unauthorized", message: "No autorizado" });
  expect(Object.keys(deniedPublicError()).sort()).toEqual(["code", "message"]);
  await expect(async () => denyUnauthorized()).rejects.toThrow("No autorizado");

  const conflict = conflictError();
  const convex = toSecureConvexError(conflict);
  expect(convex).toBeInstanceOf(ConvexError);
  expect(convex.data).toEqual({ code: "conflict", message: conflict.message });
  expect(Object.keys(convex.data as Record<string, unknown>).sort()).toEqual(["code", "message"]);

  const sinCupo = toSecureConvexError(noAvailabilityError());
  expect((sinCupo.data as { code: string }).code).toBe("no_availability");
  expect((sinCupo.data as { code: string }).code).not.toBe((convex.data as { code: string }).code);

  await expect(async () => throwPublicApiError(conflict)).rejects.toThrow(conflict.message);
  const sanitized = toSecureConvexError({
    code: "unauthorized",
    message: "No autorizado",
    stack: "pila ficticia",
    studentId: "tercero ficticio",
  } as unknown as { code: string; message: string });
  expect(Object.keys(sanitized.data as Record<string, unknown>).sort()).toEqual([
    "code",
    "message",
  ]);
  expect(JSON.stringify(sanitized.data)).not.toContain("pila");
  expect(JSON.stringify(sanitized.data)).not.toContain("tercero");
});

test("Contrato TI2-88: identificador ajeno e inexistente responden igual sin filtrar", async () => {
  const t = convexTest(schema, modules);
  const ownerId = await seedUser(t, {
    subject: "ti88-est-1",
    email: "ti88-est-1@alu.uct.cl",
    role: "student",
  });
  await seedUser(t, { subject: "ti88-est-2", email: "ti88-est-2@alu.uct.cl", role: "student" });
  const requestId = await t.mutation(internal.operations.requests.createTestRequest, {
    studentId: ownerId,
    status: "received",
    accessNeeds: "Necesidad de acceso ficticia",
  });
  const missingRequestId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("requests", {
      studentId: ownerId,
      status: "received",
      accessNeeds: "Temporal ficticia",
      createdAt: 1,
    });
    await ctx.db.delete(id);
    return id;
  });

  const asStranger = t.withIdentity(identityFor("ti88-est-2", "ti88-est-2@alu.uct.cl"));
  const asOwner = t.withIdentity(identityFor("ti88-est-1", "ti88-est-1@alu.uct.cl"));
  const readMessage = async (promise: Promise<unknown>) =>
    await promise.then(
      () => {
        throw new Error("Se esperaba denegación");
      },
      (error: Error) => error.message,
    );

  const foreignMessage = await readMessage(
    asStranger.query(api.presentation.requests.getRequest, { requestId }),
  );
  const missingMessage = await readMessage(
    asOwner.query(api.presentation.requests.getRequest, { requestId: missingRequestId }),
  );
  for (const message of [foreignMessage, missingMessage]) {
    expect(message).toContain("No autorizado");
    expect(message).not.toContain(String(requestId));
    expect(message).not.toContain(String(missingRequestId));
    expect(message).not.toContain("Necesidad de acceso ficticia");
    expect(message).not.toContain("stack");
  }
  expect(foreignMessage).toBe(missingMessage);

  const accompanimentId = await t.run(async (ctx) => {
    return await ctx.db.insert("accompaniments", {
      studentId: ownerId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad de acceso ficticia",
    });
  });
  const missingAccompanimentId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("accompaniments", {
      studentId: ownerId,
      status: "active",
      objective: "Temporal ficticio",
      accessNeeds: "Temporal ficticio",
    });
    await ctx.db.delete(id);
    return id;
  });

  const foreignAccompaniment = await readMessage(
    asStranger.query(api.presentation.accompaniments.getAccompaniment, { accompanimentId }),
  );
  const missingAccompaniment = await readMessage(
    asOwner.query(api.presentation.accompaniments.getAccompaniment, {
      accompanimentId: missingAccompanimentId,
    }),
  );
  for (const message of [foreignAccompaniment, missingAccompaniment]) {
    expect(message).toContain("No autorizado");
    expect(message).not.toContain(String(accompanimentId));
    expect(message).not.toContain(String(missingAccompanimentId));
    expect(message).not.toContain("Objetivo ficticio");
    expect(message).not.toContain("Necesidad de acceso ficticia");
  }
  expect(foreignAccompaniment).toBe(missingAccompaniment);
});

// ── TI2-111: bloques y excepciones por api.presentation.availability ─────────
//
// La API compone los casos de uso de TI2-97 con los adaptadores de TI2-86 y
// TI2-95. Estas pruebas cubren el borde: la forma de la respuesta, quién
// puede escribir, que un recurso ajeno responda igual que uno inexistente y
// que un rechazo no escriba. Las reglas de cada ventana ya las prueban
// TI2-81 y TI2-95; acá basta un rechazo por clase.

const ti111Block = {
  weekday: 1,
  startMinute: 540,
  endMinute: 600,
  slotMinutes: 30,
  modality: "online" as const,
  version: "v1" as const,
};

/** Datos del error público lanzado, o falla si la llamada no se rechazó. */
async function ti111PublicError(promise: Promise<unknown>) {
  return await promise.then(
    () => {
      throw new Error("Se esperaba un error público");
    },
    (error: unknown) => (error instanceof ConvexError ? error.data : error),
  );
}

/** Filas de disponibilidad con lectura acotada, para afirmar que nada cambió. */
async function ti111Rows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ({
    blocks: await ctx.db.query("availabilityBlocks").take(20),
    exceptions: await ctx.db.query("availabilityExceptions").take(20),
  }));
}

async function ti111SeedSpace(t: ReturnType<typeof convexTest>, isActive: boolean) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("spaces", {
      campus: "Campus ficticio",
      building: "Edificio ficticio",
      floor: "1",
      room: isActive ? "Sala vigente" : "Sala retirada",
      accessConditions: "Condiciones ficticias",
      accessInstructions: "Instrucciones ficticias",
      isActive,
    });
  });
}

test("TI2-111: el profesional publica, edita, retira y reactiva su bloque", async () => {
  const t = convexTest(schema, modules);
  const proId = await seedUser(t, {
    subject: "ti111-pro-1",
    email: "ti111-pro-1@uct.cl",
    role: "professional",
  });
  const spaceId = await ti111SeedSpace(t, true);
  const asPro = t.withIdentity(identityFor("ti111-pro-1", "ti111-pro-1@uct.cl"));

  const created = await asPro.mutation(api.presentation.availability.publishBlock, {
    ...ti111Block,
    modality: "inPerson",
    spaceId,
  });
  expect(Object.keys(created)).toEqual(["blockId"]);
  const blockId = created.blockId as Id<"availabilityBlocks">;
  const readBlock = async () => await t.run(async (ctx) => await ctx.db.get(blockId));
  expect(await readBlock()).toMatchObject({
    professionalId: proId,
    weekday: 1,
    startMinute: 540,
    endMinute: 600,
    modality: "inPerson",
    spaceId,
    isActive: true,
  });

  expect(
    await asPro.mutation(api.presentation.availability.updateBlock, {
      blockId,
      ...ti111Block,
      startMinute: 480,
    }),
  ).toBeNull();
  const updated = await readBlock();
  expect(updated).toMatchObject({ professionalId: proId, startMinute: 480, modality: "online" });
  expect(updated).not.toHaveProperty("spaceId");

  for (const isActive of [false, true]) {
    expect(
      await asPro.mutation(api.presentation.availability.setBlockActive, {
        blockId,
        isActive,
        version: "v1",
      }),
    ).toBeNull();
    expect((await readBlock())?.isActive).toBe(isActive);
  }
});

test("TI2-111: el profesional publica y retira sus excepciones", async () => {
  const t = convexTest(schema, modules);
  const proId = await seedUser(t, {
    subject: "ti111-pro-2",
    email: "ti111-pro-2@uct.cl",
    role: "professional",
  });
  const asPro = t.withIdentity(identityFor("ti111-pro-2", "ti111-pro-2@uct.cl"));
  const { blockId } = await asPro.mutation(api.presentation.availability.publishBlock, ti111Block);

  const dayOff = await asPro.mutation(api.presentation.availability.publishException, {
    date: "2026-11-02",
    kind: "cancelled",
    reason: "Motivo ficticio",
    version: "v1",
  });
  expect(Object.keys(dayOff)).toEqual(["exceptionId"]);
  const blockOff = await asPro.mutation(api.presentation.availability.publishException, {
    date: "2026-11-09",
    kind: "cancelled",
    blockId,
    version: "v1",
  });
  const extra = await asPro.mutation(api.presentation.availability.publishException, {
    date: "2026-11-10",
    kind: "added",
    windows: [{ startMinute: 600, endMinute: 660, slotMinutes: 30, modality: "online" }],
    version: "v1",
  });

  const { exceptions } = await ti111Rows(t);
  expect(exceptions.map((row) => row._id)).toEqual([
    dayOff.exceptionId,
    blockOff.exceptionId,
    extra.exceptionId,
  ]);
  expect(exceptions[0]).toMatchObject({
    professionalId: proId,
    date: Date.UTC(2026, 10, 2),
    kind: "cancelled",
    reason: "Motivo ficticio",
  });
  expect(exceptions[1]).toMatchObject({ kind: "cancelled", blockId });
  expect(exceptions[2]).toMatchObject({ kind: "added", startMinute: 600, endMinute: 660 });

  expect(
    await asPro.mutation(api.presentation.availability.removeException, {
      exceptionId: dayOff.exceptionId,
      version: "v1",
    }),
  ).toBeNull();
  expect((await ti111Rows(t)).exceptions.map((row) => row._id)).toEqual([
    blockOff.exceptionId,
    extra.exceptionId,
  ]);
});

test("TI2-111: solo un Profesional vigente escribe; el resto recibe la misma denegación sin escribir", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, { subject: "ti111-est-1", email: "ti111-est-1@alu.uct.cl", role: "student" });
  await seedUser(t, { subject: "ti111-int-1", email: "ti111-int-1@alu.uct.cl", role: "intern" });
  await seedUser(t, { subject: "ti111-adm-1", email: "ti111-adm-1@uct.cl", role: "admin" });
  await seedUser(t, {
    subject: "ti111-pro-3",
    email: "ti111-pro-3@uct.cl",
    role: "professional",
    institutionalStatus: "disabled",
  });

  const callers = [
    t,
    t.withIdentity(identityFor("ti111-sin-perfil", "ti111-sin-perfil@uct.cl")),
    t.withIdentity(identityFor("ti111-est-1", "ti111-est-1@alu.uct.cl")),
    t.withIdentity(identityFor("ti111-int-1", "ti111-int-1@alu.uct.cl")),
    t.withIdentity(identityFor("ti111-adm-1", "ti111-adm-1@uct.cl")),
    t.withIdentity(identityFor("ti111-pro-3", "ti111-pro-3@uct.cl")),
  ];
  for (const caller of callers) {
    const calls = [
      caller.mutation(api.presentation.availability.publishBlock, ti111Block),
      caller.mutation(api.presentation.availability.publishException, {
        date: "2026-11-02",
        kind: "cancelled",
        version: "v1",
      }),
    ];
    for (const call of calls) {
      expect(await ti111PublicError(call)).toStrictEqual({
        code: "unauthorized",
        message: "No autorizado",
      });
    }
  }
  expect(await ti111Rows(t)).toEqual({ blocks: [], exceptions: [] });
});

test("TI2-111: un bloque o una excepción ajena responde igual que una inexistente, sin cambiarla", async () => {
  const t = convexTest(schema, modules);
  const ownerId = await seedUser(t, {
    subject: "ti111-pro-4",
    email: "ti111-pro-4@uct.cl",
    role: "professional",
  });
  await seedUser(t, { subject: "ti111-pro-5", email: "ti111-pro-5@uct.cl", role: "professional" });
  const asOwner = t.withIdentity(identityFor("ti111-pro-4", "ti111-pro-4@uct.cl"));
  const asStranger = t.withIdentity(identityFor("ti111-pro-5", "ti111-pro-5@uct.cl"));

  const { blockId } = await asOwner.mutation(
    api.presentation.availability.publishBlock,
    ti111Block,
  );
  const { exceptionId } = await asOwner.mutation(api.presentation.availability.publishException, {
    date: "2026-11-02",
    kind: "cancelled",
    version: "v1",
  });
  const deleted = await asOwner.mutation(api.presentation.availability.publishBlock, {
    ...ti111Block,
    weekday: 2,
  });
  await t.run(async (ctx) => {
    await ctx.db.delete(deleted.blockId as Id<"availabilityBlocks">);
  });
  const before = await ti111Rows(t);

  // Ajeno, borrado, sin forma y de otra tabla: la misma respuesta.
  const denied = { code: "unauthorized", message: "No autorizado" };
  for (const target of [blockId, deleted.blockId, "no-existe", ownerId]) {
    expect(
      await ti111PublicError(
        asStranger.mutation(api.presentation.availability.updateBlock, {
          blockId: target,
          ...ti111Block,
          startMinute: 480,
        }),
      ),
    ).toStrictEqual(denied);
    expect(
      await ti111PublicError(
        asStranger.mutation(api.presentation.availability.setBlockActive, {
          blockId: target,
          isActive: false,
          version: "v1",
        }),
      ),
    ).toStrictEqual(denied);
  }
  for (const target of [exceptionId, "no-existe", ownerId]) {
    expect(
      await ti111PublicError(
        asStranger.mutation(api.presentation.availability.removeException, {
          exceptionId: target,
          version: "v1",
        }),
      ),
    ).toStrictEqual(denied);
  }
  expect(await ti111Rows(t)).toEqual(before);
});

test("TI2-111: una escritura que el repositorio rechaza responde conflict sin escribir", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, { subject: "ti111-pro-6", email: "ti111-pro-6@uct.cl", role: "professional" });
  await seedUser(t, { subject: "ti111-pro-7", email: "ti111-pro-7@uct.cl", role: "professional" });
  const activeSpaceId = await ti111SeedSpace(t, true);
  const retiredSpaceId = await ti111SeedSpace(t, false);
  const asPro = t.withIdentity(identityFor("ti111-pro-6", "ti111-pro-6@uct.cl"));
  const asOther = t.withIdentity(identityFor("ti111-pro-7", "ti111-pro-7@uct.cl"));
  const { blockId: foreignBlockId } = await asOther.mutation(
    api.presentation.availability.publishBlock,
    ti111Block,
  );
  const before = await ti111Rows(t);

  const window = { startMinute: 600, endMinute: 660, slotMinutes: 30, modality: "online" as const };
  const calls = [
    asPro.mutation(api.presentation.availability.publishBlock, { ...ti111Block, endMinute: 500 }),
    asPro.mutation(api.presentation.availability.publishBlock, {
      ...ti111Block,
      modality: "inPerson",
    }),
    asPro.mutation(api.presentation.availability.publishBlock, {
      ...ti111Block,
      spaceId: activeSpaceId,
    }),
    asPro.mutation(api.presentation.availability.publishBlock, {
      ...ti111Block,
      modality: "inPerson",
      spaceId: retiredSpaceId,
    }),
    asPro.mutation(api.presentation.availability.publishException, {
      date: "2026-11-02",
      kind: "cancelled",
      blockId: foreignBlockId,
      version: "v1",
    }),
    asPro.mutation(api.presentation.availability.publishException, {
      date: "2026-11-02",
      kind: "added",
      windows: [window, { ...window, startMinute: 700, endMinute: 760 }],
      version: "v1",
    }),
  ];
  for (const call of calls) {
    expect(await ti111PublicError(call)).toStrictEqual({
      code: "conflict",
      message: conflictError().message,
    });
  }
  expect(await ti111Rows(t)).toEqual(before);
});

test("TI2-111: el cliente no fija el dueño ni otra versión del contrato", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, { subject: "ti111-pro-8", email: "ti111-pro-8@uct.cl", role: "professional" });
  const otherId = await seedUser(t, {
    subject: "ti111-pro-9",
    email: "ti111-pro-9@uct.cl",
    role: "professional",
  });
  const asPro = t.withIdentity(identityFor("ti111-pro-8", "ti111-pro-8@uct.cl"));

  // Argumentos fuera del contrato: el validador del borde los rechaza antes
  // de llegar al caso de uso.
  const withOwner = { ...ti111Block, professionalId: otherId };
  await expect(
    asPro.mutation(api.presentation.availability.publishBlock, withOwner),
  ).rejects.toThrow("Unexpected field `professionalId`");
  const otherVersion = { ...ti111Block, version: "v2" } as unknown as typeof ti111Block;
  await expect(
    asPro.mutation(api.presentation.availability.publishBlock, otherVersion),
  ).rejects.toThrow("Expected `v1`, got `v2`");
  expect(await ti111Rows(t)).toEqual({ blocks: [], exceptions: [] });
});

test("TI2-111: cada mutation de disponibilidad exige la versión v1 del contrato", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti111-pro-10",
    email: "ti111-pro-10@uct.cl",
    role: "professional",
  });
  const asPro = t.withIdentity(identityFor("ti111-pro-10", "ti111-pro-10@uct.cl"));
  const { blockId } = await asPro.mutation(api.presentation.availability.publishBlock, ti111Block);
  const { exceptionId } = await asPro.mutation(api.presentation.availability.publishException, {
    date: "2026-11-02",
    kind: "cancelled",
    version: "v1",
  });
  const before = await ti111Rows(t);

  // Cada llamada sería válida con `version: "v1"`; solo cambia la versión.
  const calls = {
    publishBlock: (version?: string) =>
      asPro.mutation(api.presentation.availability.publishBlock, {
        ...ti111Block,
        version,
      } as never),
    updateBlock: (version?: string) =>
      asPro.mutation(api.presentation.availability.updateBlock, {
        ...ti111Block,
        blockId,
        startMinute: 480,
        version,
      } as never),
    setBlockActive: (version?: string) =>
      asPro.mutation(api.presentation.availability.setBlockActive, {
        blockId,
        isActive: false,
        version,
      } as never),
    publishException: (version?: string) =>
      asPro.mutation(api.presentation.availability.publishException, {
        date: "2026-11-09",
        kind: "cancelled",
        version,
      } as never),
    removeException: (version?: string) =>
      asPro.mutation(api.presentation.availability.removeException, {
        exceptionId,
        version,
      } as never),
  };
  for (const call of Object.values(calls)) {
    await expect(call("v2")).rejects.toThrow("Expected `v1`, got `v2`");
    await expect(call(undefined)).rejects.toThrow("Missing required field `version`");
  }
  expect(await ti111Rows(t)).toEqual(before);
});

test("TI2-111: el profesional lee solo sus bloques vigentes y sus excepciones del rango", async () => {
  const t = convexTest(schema, modules);
  const proA = await seedUser(t, {
    subject: "ti111-own-a",
    email: "ti111-own-a@uct.cl",
    role: "professional",
  });
  const proB = await seedUser(t, {
    subject: "ti111-own-b",
    email: "ti111-own-b@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti111-own-est",
    email: "ti111-own-est@alu.uct.cl",
    role: "student",
  });
  await seedUser(t, {
    subject: "ti111-own-int",
    email: "ti111-own-int@alu.uct.cl",
    role: "intern",
  });
  await seedUser(t, { subject: "ti111-own-adm", email: "ti111-own-adm@uct.cl", role: "admin" });
  await seedUser(t, {
    subject: "ti111-own-off",
    email: "ti111-own-off@uct.cl",
    role: "professional",
    institutionalStatus: "disabled",
  });
  const asA = t.withIdentity(identityFor("ti111-own-a", "ti111-own-a@uct.cl"));
  const asB = t.withIdentity(identityFor("ti111-own-b", "ti111-own-b@uct.cl"));

  // A: un bloque vigente, uno retirado y tres excepciones, una fuera del rango.
  const { blockId: activeBlock } = await asA.mutation(
    api.presentation.availability.publishBlock,
    ti111Block,
  );
  const { blockId: retiredBlock } = await asA.mutation(api.presentation.availability.publishBlock, {
    ...ti111Block,
    weekday: 3,
  });
  await asA.mutation(api.presentation.availability.setBlockActive, {
    blockId: retiredBlock,
    isActive: false,
    version: "v1",
  });
  const { exceptionId: dayOff } = await asA.mutation(
    api.presentation.availability.publishException,
    {
      date: "2026-11-02",
      kind: "cancelled",
      reason: "Motivo ficticio",
      version: "v1",
    },
  );
  const window = { startMinute: 600, endMinute: 660, slotMinutes: 30, modality: "online" as const };
  const { exceptionId: extra } = await asA.mutation(
    api.presentation.availability.publishException,
    {
      date: "2026-11-04",
      kind: "added",
      windows: [window],
      version: "v1",
    },
  );
  await asA.mutation(api.presentation.availability.publishException, {
    date: "2027-03-01",
    kind: "cancelled",
    version: "v1",
  });
  // B: lo suyo, que A nunca debe ver.
  const { blockId: blockOfB } = await asB.mutation(api.presentation.availability.publishBlock, {
    ...ti111Block,
    weekday: 2,
  });
  const { exceptionId: dayOffOfB } = await asB.mutation(
    api.presentation.availability.publishException,
    { date: "2026-11-03", kind: "cancelled", version: "v1" },
  );

  const noviembre = { from: "2026-11-01", to: "2026-11-30", version: "v1" as const };
  const { version: _blockVersion, ...blockFields } = ti111Block;
  expect(
    await asA.query(api.presentation.availability.listOwnAvailability, noviembre),
  ).toStrictEqual({
    blocks: [{ id: activeBlock, professionalId: proA, ...blockFields, version: "v1" }],
    exceptions: [
      {
        id: dayOff,
        professionalId: proA,
        date: "2026-11-02",
        kind: "cancelled",
        reason: "Motivo ficticio",
        version: "v1",
      },
      {
        id: extra,
        professionalId: proA,
        date: "2026-11-04",
        kind: "added",
        windows: [window],
        version: "v1",
      },
    ],
    version: "v1",
  });
  expect(
    await asB.query(api.presentation.availability.listOwnAvailability, noviembre),
  ).toStrictEqual({
    blocks: [{ id: blockOfB, professionalId: proB, ...blockFields, weekday: 2, version: "v1" }],
    exceptions: [
      { id: dayOffOfB, professionalId: proB, date: "2026-11-03", kind: "cancelled", version: "v1" },
    ],
    version: "v1",
  });

  const denied = { code: "unauthorized", message: "No autorizado" };
  for (const caller of [
    t,
    t.withIdentity(identityFor("ti111-own-est", "ti111-own-est@alu.uct.cl")),
    t.withIdentity(identityFor("ti111-own-int", "ti111-own-int@alu.uct.cl")),
    t.withIdentity(identityFor("ti111-own-adm", "ti111-own-adm@uct.cl")),
    t.withIdentity(identityFor("ti111-own-off", "ti111-own-off@uct.cl")),
  ]) {
    expect(
      await ti111PublicError(
        caller.query(api.presentation.availability.listOwnAvailability, noviembre),
      ),
    ).toStrictEqual(denied);
  }

  // Rango invertido o de más de 92 días: conflicto, nunca una lista cortada.
  const conflict = { code: "conflict", message: conflictError().message };
  for (const range of [
    { from: "2026-11-30", to: "2026-11-01" },
    { from: "2026-11-01", to: "2027-02-15" },
  ]) {
    expect(
      await ti111PublicError(
        asA.query(api.presentation.availability.listOwnAvailability, { ...range, version: "v1" }),
      ),
    ).toStrictEqual(conflict);
  }
  // Ni otro profesional ni otra versión del contrato.
  await expect(
    asA.query(api.presentation.availability.listOwnAvailability, {
      ...noviembre,
      professionalId: proB,
    } as never),
  ).rejects.toThrow("Unexpected field `professionalId`");
  await expect(
    asA.query(api.presentation.availability.listOwnAvailability, {
      ...noviembre,
      version: "v2",
    } as never),
  ).rejects.toThrow("Expected `v1`, got `v2`");
  const { version: _rangeVersion, ...withoutVersion } = noviembre;
  await expect(
    asA.query(api.presentation.availability.listOwnAvailability, withoutVersion as never),
  ).rejects.toThrow("Missing required field `version`");
});

// ── TI2-111: búsqueda y reserva por la API ───────────────────────────────────
//
// Agenda ficticia del lunes 2026-11-02 en la zona de la agenda
// (`America/Santiago`): un bloque presencial de 09:00 a 11:00 en una sala que
// cubre la necesidad del Estudiante, un bloque en línea de 12:00 a 13:00 y una
// atención de otro Estudiante que ya ocupa las 09:00. Solo queda libre y
// compatible el cupo de las 10:00.

const TI111_DAY = "2026-11-02";
/** Instante de una hora de Santiago ese lunes (UTC−3 por el horario de verano). */
const ti111At = (hour: number) => Date.UTC(2026, 10, 2, hour + 3);

async function ti111SeedAgenda(t: ReturnType<typeof convexTest>) {
  const studentId = await seedUser(t, {
    subject: "ti111-ag-est-1",
    email: "ti111-ag-est-1@alu.uct.cl",
    role: "student",
  });
  const otherStudentId = await seedUser(t, {
    subject: "ti111-ag-est-2",
    email: "ti111-ag-est-2@alu.uct.cl",
    role: "student",
  });
  const professionalId = await seedUser(t, {
    subject: "ti111-ag-pro-1",
    email: "ti111-ag-pro-1@uct.cl",
    role: "professional",
  });
  await seedUser(t, {
    subject: "ti111-ag-pro-2",
    email: "ti111-ag-pro-2@uct.cl",
    role: "professional",
  });
  return await t.run(async (ctx) => {
    const accompanimentId = await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Sala físicamente accesible",
    });
    const otherAccompanimentId = await ctx.db.insert("accompaniments", {
      studentId: otherStudentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Persona de apoyo\nIntérprete de lengua de señas",
    });
    for (const id of [accompanimentId, otherAccompanimentId]) {
      await ctx.db.insert("accompanimentAssignments", {
        accompanimentId: id,
        userId: professionalId,
        assignedRole: "professional",
        status: "active",
      });
    }
    const spaceId = await ctx.db.insert("spaces", {
      campus: "Campus ficticio",
      building: "A",
      floor: "1",
      room: "Sala accesible",
      accessConditions: "Sala físicamente accesible\nReducción de estímulos",
      accessInstructions: "Instrucciones ficticias",
      isActive: true,
    });
    await ctx.db.insert("availabilityBlocks", {
      professionalId,
      weekday: 1,
      startMinute: 540,
      endMinute: 660,
      slotMinutes: 60,
      modality: "inPerson",
      spaceId,
      isActive: true,
    });
    await ctx.db.insert("availabilityBlocks", {
      professionalId,
      weekday: 1,
      startMinute: 720,
      endMinute: 780,
      slotMinutes: 60,
      modality: "online",
      isActive: true,
    });
    await ctx.db.insert("appointments", {
      accompanimentId: otherAccompanimentId,
      studentId: otherStudentId,
      professionalId,
      modality: "online",
      status: "scheduled",
      startsAt: ti111At(9),
      endsAt: ti111At(10),
      createdAt: 1,
    });
    return {
      studentId,
      otherStudentId,
      professionalId,
      accompanimentId,
      otherAccompanimentId,
      spaceId,
    };
  });
}

function ti111Search(accompanimentId: string, professionalId: string) {
  return {
    accompanimentId,
    professionalId,
    from: TI111_DAY,
    to: TI111_DAY,
    limit: 10,
    version: "v1" as const,
  };
}

async function ti111Appointments(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => await ctx.db.query("appointments").take(20));
}

test("TI2-111: la búsqueda entrega solo cupos libres y compatibles a quien puede ver la agenda", async () => {
  const t = convexTest(schema, modules);
  const agenda = await ti111SeedAgenda(t);
  const search = ti111Search(agenda.accompanimentId, agenda.professionalId);
  const expected = {
    items: [
      {
        id: `${agenda.professionalId}:${TI111_DAY}:${ti111At(10)}`,
        professionalId: agenda.professionalId,
        date: TI111_DAY,
        startAt: ti111At(10),
        endAt: ti111At(11),
        modality: "inPerson",
        spaceId: agenda.spaceId,
        version: "v1",
      },
    ],
    hasMore: false,
    nextCursor: null,
    version: "v1",
  };

  const asStudent = t.withIdentity(identityFor("ti111-ag-est-1", "ti111-ag-est-1@alu.uct.cl"));
  const asAssigned = t.withIdentity(identityFor("ti111-ag-pro-1", "ti111-ag-pro-1@uct.cl"));
  expect(await asStudent.query(api.presentation.availability.searchSlots, search)).toStrictEqual(
    expected,
  );
  expect(await asAssigned.query(api.presentation.availability.searchSlots, search)).toStrictEqual(
    expected,
  );

  const denied = { code: "unauthorized", message: "No autorizado" };
  for (const caller of [
    t,
    t.withIdentity(identityFor("ti111-ag-est-2", "ti111-ag-est-2@alu.uct.cl")),
    t.withIdentity(identityFor("ti111-ag-pro-2", "ti111-ag-pro-2@uct.cl")),
  ]) {
    expect(
      await ti111PublicError(caller.query(api.presentation.availability.searchSlots, search)),
    ).toStrictEqual(denied);
  }

  // Sus necesidades no las cubre ninguna sala ni la plataforma en línea.
  const asOther = t.withIdentity(identityFor("ti111-ag-est-2", "ti111-ag-est-2@alu.uct.cl"));
  expect(
    await ti111PublicError(
      asOther.query(
        api.presentation.availability.searchSlots,
        ti111Search(agenda.otherAccompanimentId, agenda.professionalId),
      ),
    ),
  ).toStrictEqual({ code: "no_availability", message: noAvailabilityError().message });

  const otherVersion = { ...search, version: "v2" } as unknown as typeof search;
  await expect(
    asStudent.query(api.presentation.availability.searchSlots, otherVersion),
  ).rejects.toThrow("Expected `v1`, got `v2`");
  const { version: _searchVersion, ...withoutVersion } = search;
  await expect(
    asStudent.query(api.presentation.availability.searchSlots, withoutVersion as never),
  ).rejects.toThrow("Missing required field `version`");
});

test("TI2-111: la búsqueda no expone cupos de un profesional no asignado, revocado o sin cuenta vigente", async () => {
  const t = convexTest(schema, modules);
  const agenda = await ti111SeedAgenda(t);
  // Cuatro profesionales con el mismo bloque presencial de 15:00 a 16:00 en la
  // sala accesible: solo el asignado y vigente lo puede ofrecer.
  const professionals = await t.run(async (ctx) => {
    const seed = async (
      subject: string,
      accountStatus: "active" | "inactive",
      assignment: "active" | "revoked" | null,
    ) => {
      const id = await ctx.db.insert("users", {
        email: `${subject}@uct.cl`,
        fullName: "Ficticio",
        role: "professional",
        institutionalStatus: "enabled",
        accountStatus,
        tokenIdentifier: `${ISSUER}|${subject}`,
      });
      if (assignment !== null) {
        await ctx.db.insert("accompanimentAssignments", {
          accompanimentId: agenda.accompanimentId,
          userId: id,
          assignedRole: "professional",
          status: assignment,
        });
      }
      await ctx.db.insert("availabilityBlocks", {
        professionalId: id,
        weekday: 1,
        startMinute: 900,
        endMinute: 960,
        slotMinutes: 60,
        modality: "inPerson",
        spaceId: agenda.spaceId,
        isActive: true,
      });
      return id;
    };
    return {
      assigned: await seed("ti111-ag-pro-3", "active", "active"),
      unassigned: await seed("ti111-ag-pro-4", "active", null),
      revoked: await seed("ti111-ag-pro-5", "active", "revoked"),
      inactive: await seed("ti111-ag-pro-6", "inactive", "active"),
    };
  });
  const asStudent = t.withIdentity(identityFor("ti111-ag-est-1", "ti111-ag-est-1@alu.uct.cl"));
  const search = (professionalId: string) =>
    asStudent.query(
      api.presentation.availability.searchSlots,
      ti111Search(agenda.accompanimentId, professionalId),
    );

  // Control: con asignación activa y cuenta vigente el cupo sí se ofrece.
  expect((await search(professionals.assigned)).items).toStrictEqual([
    {
      id: `${professionals.assigned}:${TI111_DAY}:${ti111At(15)}`,
      professionalId: professionals.assigned,
      date: TI111_DAY,
      startAt: ti111At(15),
      endAt: ti111At(16),
      modality: "inPerson",
      spaceId: agenda.spaceId,
      version: "v1",
    },
  ]);
  const noAvailability = { code: "no_availability", message: noAvailabilityError().message };
  for (const professionalId of [
    professionals.unassigned,
    professionals.revoked,
    professionals.inactive,
  ]) {
    expect(await ti111PublicError(search(professionalId))).toStrictEqual(noAvailability);
  }
});

test("TI2-111: la búsqueda no ofrece un cupo que choca con el estudiante o la sala, y la reserva tampoco lo acepta", async () => {
  // El único cupo libre y compatible de la agenda es el de las 10:00 en la
  // sala accesible. Cada escenario lo ocupa por otro recurso que no es el
  // profesional buscado: una atención del mismo estudiante con otro
  // profesional, o una atención de otro estudiante en la misma sala.
  const scenarios = ["estudiante", "sala"] as const;
  const results: Record<string, unknown> = {};
  for (const scenario of scenarios) {
    const t = convexTest(schema, modules);
    const agenda = await ti111SeedAgenda(t);
    await t.run(async (ctx) => {
      const otherProfessional = await ctx.db.insert("users", {
        email: `ti111-ag-otro-${scenario}@uct.cl`,
        fullName: "Ficticio",
        role: "professional",
        institutionalStatus: "enabled",
        accountStatus: "active",
        tokenIdentifier: `${ISSUER}|ti111-ag-otro-${scenario}`,
      });
      const taken =
        scenario === "estudiante"
          ? {
              accompanimentId: agenda.accompanimentId,
              studentId: agenda.studentId,
              modality: "online" as const,
            }
          : {
              accompanimentId: agenda.otherAccompanimentId,
              studentId: agenda.otherStudentId,
              modality: "inPerson" as const,
              spaceId: agenda.spaceId,
            };
      await ctx.db.insert("appointments", {
        ...taken,
        professionalId: otherProfessional,
        status: "scheduled",
        startsAt: ti111At(10),
        endsAt: ti111At(11),
        createdAt: 1,
      });
    });
    const asStudent = t.withIdentity(identityFor("ti111-ag-est-1", "ti111-ag-est-1@alu.uct.cl"));
    const before = await ti111Appointments(t);
    results[scenario] = {
      consulta: await ti111PublicError(
        asStudent.query(
          api.presentation.availability.searchSlots,
          ti111Search(agenda.accompanimentId, agenda.professionalId),
        ),
      ),
      reserva: await ti111PublicError(
        asStudent.mutation(api.presentation.appointments.bookAppointment, {
          accompanimentId: agenda.accompanimentId,
          professionalId: agenda.professionalId,
          modality: "inPerson",
          spaceId: agenda.spaceId,
          startAt: ti111At(10),
          endAt: ti111At(11),
          version: "v1",
        }),
      ),
      sinEscribir: (await ti111Appointments(t)).length === before.length,
    };
  }
  const expected = {
    consulta: { code: "no_availability", message: noAvailabilityError().message },
    reserva: { code: "conflict", message: conflictError().message },
    sinEscribir: true,
  };
  expect(results).toEqual({ estudiante: expected, sala: expected });
});

test("TI2-111: la zona horaria la fija el servidor y otra zona no corre la reserva fuera del horario", async () => {
  const t = convexTest(schema, modules);
  const agenda = await ti111SeedAgenda(t);
  const asStudent = t.withIdentity(identityFor("ti111-ag-est-1", "ti111-ag-est-1@alu.uct.cl"));
  const search = ti111Search(agenda.accompanimentId, agenda.professionalId);
  const slot = {
    accompanimentId: agenda.accompanimentId as string,
    professionalId: agenda.professionalId as string,
    modality: "inPerson" as const,
    spaceId: agenda.spaceId as string,
    startAt: ti111At(10),
    endAt: ti111At(11),
    version: "v1" as const,
  };
  const before = await ti111Appointments(t);

  // El cliente no puede enviar otra zona.
  await expect(
    asStudent.query(api.presentation.availability.searchSlots, {
      ...search,
      timeZone: "UTC",
    } as never),
  ).rejects.toThrow("Unexpected field `timeZone`");
  await expect(
    asStudent.mutation(api.presentation.appointments.bookAppointment, {
      ...slot,
      timeZone: "UTC",
    } as never),
  ).rejects.toThrow("Unexpected field `timeZone`");

  // El bloque de 09:00 a 11:00 leído en UTC daría un cupo a las 10:00 UTC,
  // las 07:00 de Santiago, fuera del horario publicado: no se reserva.
  expect(
    await ti111PublicError(
      asStudent.mutation(api.presentation.appointments.bookAppointment, {
        ...slot,
        startAt: Date.UTC(2026, 10, 2, 10),
        endAt: Date.UTC(2026, 10, 2, 11),
      }),
    ),
  ).toStrictEqual({ code: "no_availability", message: noAvailabilityError().message });
  expect(await ti111Appointments(t)).toEqual(before);

  // Las 10:00 de Santiago sí se reservan, con el instante de esa zona.
  const booked = await asStudent.mutation(api.presentation.appointments.bookAppointment, slot);
  const row = await t.run(
    async (ctx) => await ctx.db.get(booked.appointmentId as Id<"appointments">),
  );
  expect(row).toMatchObject({
    startsAt: Date.UTC(2026, 10, 2, 13),
    endsAt: Date.UTC(2026, 10, 2, 14),
  });
});

test("TI2-111: el Estudiante reserva el cupo libre y compatible, y nada más", async () => {
  const t = convexTest(schema, modules);
  const agenda = await ti111SeedAgenda(t);
  const asStudent = t.withIdentity(identityFor("ti111-ag-est-1", "ti111-ag-est-1@alu.uct.cl"));
  const slot = {
    accompanimentId: agenda.accompanimentId as string,
    professionalId: agenda.professionalId as string,
    modality: "inPerson" as const,
    spaceId: agenda.spaceId as string,
    startAt: ti111At(10),
    endAt: ti111At(11),
    version: "v1" as const,
  };
  const before = await ti111Appointments(t);

  // Quien no es el Estudiante dueño no reserva, aunque sea el profesional.
  const denied = { code: "unauthorized", message: "No autorizado" };
  for (const caller of [
    t,
    t.withIdentity(identityFor("ti111-ag-est-2", "ti111-ag-est-2@alu.uct.cl")),
    t.withIdentity(identityFor("ti111-ag-pro-1", "ti111-ag-pro-1@uct.cl")),
  ]) {
    expect(
      await ti111PublicError(caller.mutation(api.presentation.appointments.bookAppointment, slot)),
    ).toStrictEqual(denied);
  }
  // Un horario que no existe y uno en línea que no cubre su necesidad.
  const noAvailability = { code: "no_availability", message: noAvailabilityError().message };
  const { spaceId: _spaceId, ...withoutSpace } = slot;
  for (const other of [
    { ...slot, startAt: ti111At(11), endAt: ti111At(12) },
    { ...withoutSpace, modality: "online" as const, startAt: ti111At(12), endAt: ti111At(13) },
  ]) {
    expect(
      await ti111PublicError(
        asStudent.mutation(api.presentation.appointments.bookAppointment, other),
      ),
    ).toStrictEqual(noAvailability);
  }
  // El cupo de las 09:00 ya lo ocupa otra atención.
  const conflict = { code: "conflict", message: conflictError().message };
  expect(
    await ti111PublicError(
      asStudent.mutation(api.presentation.appointments.bookAppointment, {
        ...slot,
        startAt: ti111At(9),
        endAt: ti111At(10),
      }),
    ),
  ).toStrictEqual(conflict);
  expect(await ti111Appointments(t)).toEqual(before);

  const booked = await asStudent.mutation(api.presentation.appointments.bookAppointment, slot);
  expect(Object.keys(booked)).toEqual(["appointmentId"]);
  const row = await t.run(
    async (ctx) => await ctx.db.get(booked.appointmentId as Id<"appointments">),
  );
  expect(row).toMatchObject({
    accompanimentId: agenda.accompanimentId,
    studentId: agenda.studentId,
    professionalId: agenda.professionalId,
    modality: "inPerson",
    spaceId: agenda.spaceId,
    status: "scheduled",
    startsAt: ti111At(10),
    endsAt: ti111At(11),
  });

  // Repetir la reserva choca consigo misma, y la búsqueda ya no ofrece el cupo.
  const afterBooking = await ti111Appointments(t);
  expect(
    await ti111PublicError(asStudent.mutation(api.presentation.appointments.bookAppointment, slot)),
  ).toStrictEqual(conflict);
  expect(await ti111Appointments(t)).toEqual(afterBooking);
  expect(
    await ti111PublicError(
      asStudent.query(
        api.presentation.availability.searchSlots,
        ti111Search(agenda.accompanimentId, agenda.professionalId),
      ),
    ),
  ).toStrictEqual(noAvailability);

  const otherVersion = { ...slot, version: "v2" } as unknown as typeof slot;
  await expect(
    asStudent.mutation(api.presentation.appointments.bookAppointment, otherVersion),
  ).rejects.toThrow("Expected `v1`, got `v2`");
  const { version: _slotVersion, ...slotWithoutVersion } = slot;
  await expect(
    asStudent.mutation(api.presentation.appointments.bookAppointment, slotWithoutVersion as never),
  ).rejects.toThrow("Missing required field `version`");
  expect(await ti111Appointments(t)).toEqual(afterBooking);
});

// TI2-112: agenda y detalle de las atenciones. Los roles, la paginación y el
// tope por regla están en `queries.test.ts`; acá se prueba la API con el
// adaptador real: claves exactas, lecturas por índice y errores públicos.

const TI112_WEEK = { from: "2026-07-06", to: "2026-07-12", limit: 10, version: "v1" as const };

/** Instante de un día de julio de 2026 a la hora dada en Santiago (UTC-4). */
const ti112At = (day: number, hour: number) => Date.UTC(2026, 6, day, hour + 4);

const TI112_FULL_KEYS = [
  "accompanimentId",
  "endAt",
  "id",
  "modality",
  "professionalId",
  "startAt",
  "status",
  "version",
  "view",
];

function ti112Keys(value: object) {
  return Object.keys(value).sort();
}

function ti112Caller(t: ReturnType<typeof convexTest>, name: string) {
  return t.withIdentity(identityFor(`ti112-${name}`, `ti112-${name}@uct.cl`));
}

/**
 * Dos acompañamientos con cinco atenciones. El profesional 1 atiende el
 * acompañamiento del estudiante 1 y perdió la asignación en el del estudiante
 * 2, donde conserva una atención a su nombre.
 */
async function ti112SeedAgenda(t: ReturnType<typeof convexTest>) {
  const seed = (name: string, role: "student" | "professional" | "admin") =>
    seedUser(t, { subject: `ti112-${name}`, email: `ti112-${name}@uct.cl`, role });
  const studentId = await seed("est-1", "student");
  const otherStudentId = await seed("est-2", "student");
  const professionalId = await seed("pro-1", "professional");
  const otherProfessionalId = await seed("pro-2", "professional");
  await seed("adm-1", "admin");
  return await t.run(async (ctx) => {
    const accompanimentId = await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad ficticia",
    });
    const otherAccompanimentId = await ctx.db.insert("accompaniments", {
      studentId: otherStudentId,
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Necesidad ficticia",
    });
    const assign = (id: Id<"accompaniments">, userId: Id<"users">, status: "active" | "revoked") =>
      ctx.db.insert("accompanimentAssignments", {
        accompanimentId: id,
        userId,
        assignedRole: "professional",
        status,
      });
    await assign(accompanimentId, professionalId, "active");
    const otherProfessionalAssignment = await assign(
      accompanimentId,
      otherProfessionalId,
      "active",
    );
    await assign(otherAccompanimentId, professionalId, "revoked");
    await assign(otherAccompanimentId, otherProfessionalId, "active");
    const spaceId = await ctx.db.insert("spaces", {
      campus: "Campus ficticio",
      building: "A",
      floor: "1",
      room: "Sala ficticia",
      accessConditions: "Sala físicamente accesible",
      accessInstructions: "Instrucciones ficticias",
      isActive: true,
    });
    const insertAppointment = (fields: {
      readonly accompanimentId: Id<"accompaniments">;
      readonly studentId: Id<"users">;
      readonly professionalId: Id<"users">;
      readonly day: number;
    }) =>
      ctx.db.insert("appointments", {
        accompanimentId: fields.accompanimentId,
        studentId: fields.studentId,
        professionalId: fields.professionalId,
        modality: "online",
        status: "scheduled",
        startsAt: ti112At(fields.day, 10),
        endsAt: ti112At(fields.day, 11),
        createdAt: 1,
      });
    const plain = await insertAppointment({
      accompanimentId,
      studentId,
      professionalId,
      day: 6,
    });
    const cancelled = await ctx.db.insert("appointments", {
      accompanimentId,
      studentId,
      professionalId,
      spaceId,
      modality: "inPerson",
      status: "cancelled_by_cereti",
      startsAt: ti112At(7, 10),
      endsAt: ti112At(7, 11),
      originalStartsAt: ti112At(6, 15),
      cancelReason: "Motivo ficticio",
      createdAt: 1,
    });
    const withOtherProfessional = await insertAppointment({
      accompanimentId,
      studentId,
      professionalId: otherProfessionalId,
      day: 8,
    });
    const revoked = await insertAppointment({
      accompanimentId: otherAccompanimentId,
      studentId: otherStudentId,
      professionalId,
      day: 6,
    });
    const foreign = await insertAppointment({
      accompanimentId: otherAccompanimentId,
      studentId: otherStudentId,
      professionalId: otherProfessionalId,
      day: 7,
    });
    return {
      studentId,
      professionalId,
      otherProfessionalId,
      accompanimentId,
      otherAccompanimentId,
      otherProfessionalAssignment,
      spaceId,
      appointments: { plain, cancelled, withOtherProfessional, revoked, foreign },
    };
  });
}

test("TI2-112: la agenda y el detalle entregan las claves exactas de Estudiante y Profesional", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId, appointments } = await ti112SeedAgenda(t);
  const withOptionals = [...TI112_FULL_KEYS, "cancelReason", "originalStartAt", "spaceId"].sort();

  for (const name of ["est-1", "pro-1"]) {
    const caller = ti112Caller(t, name);
    const own = await caller.query(api.presentation.appointments.listAppointments, TI112_WEEK);
    const scoped = await caller.query(api.presentation.appointments.listAppointments, {
      ...TI112_WEEK,
      accompanimentId,
    });
    for (const page of [own, scoped]) {
      const [plain, cancelled] = page.items;
      expect(plain?.id).toBe(appointments.plain);
      expect(ti112Keys(plain ?? {})).toEqual(TI112_FULL_KEYS);
      expect(cancelled?.id).toBe(appointments.cancelled);
      expect(ti112Keys(cancelled ?? {})).toEqual(withOptionals);
    }
    const plainDetail = await caller.query(api.presentation.appointments.getAppointment, {
      appointmentId: appointments.plain,
      version: "v1",
    });
    expect(ti112Keys(plainDetail)).toEqual(TI112_FULL_KEYS);
    const cancelledDetail = await caller.query(api.presentation.appointments.getAppointment, {
      appointmentId: appointments.cancelled,
      version: "v1",
    });
    expect(ti112Keys(cancelledDetail)).toEqual(withOptionals);
    expect(cancelledDetail).toMatchObject({
      status: "cancelled_by_cereti",
      cancelReason: "Motivo ficticio",
      originalStartAt: ti112At(6, 15),
      view: "full",
    });
  }
});

test("TI2-112: la agenda propia no trae atenciones ajenas y la revocación la corta en la llamada siguiente", async () => {
  const t = convexTest(schema, modules);
  const { appointments, otherProfessionalAssignment } = await ti112SeedAgenda(t);
  const ownIds = async (name: string) =>
    (
      await ti112Caller(t, name).query(api.presentation.appointments.listAppointments, TI112_WEEK)
    ).items.map((item) => item.id);

  expect(await ownIds("est-1")).toEqual([
    appointments.plain,
    appointments.cancelled,
    appointments.withOtherProfessional,
  ]);
  expect(await ownIds("est-2")).toEqual([appointments.revoked, appointments.foreign]);
  // La atención del acompañamiento con la asignación revocada queda fuera.
  expect(await ownIds("pro-1")).toEqual([appointments.plain, appointments.cancelled]);
  expect(await ownIds("pro-2")).toEqual([appointments.foreign, appointments.withOtherProfessional]);

  await t.run(async (ctx) => {
    await ctx.db.patch(otherProfessionalAssignment, { status: "revoked" });
  });
  expect(await ownIds("pro-2")).toEqual([appointments.foreign]);
});

test("TI2-112: el Profesional asignado ve en el acompañamiento las atenciones de otro profesional", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId, appointments } = await ti112SeedAgenda(t);
  const page = await ti112Caller(t, "pro-1").query(api.presentation.appointments.listAppointments, {
    ...TI112_WEEK,
    accompanimentId,
  });
  expect(page.items.map((item) => item.id)).toEqual([
    appointments.plain,
    appointments.cancelled,
    appointments.withOtherProfessional,
  ]);
});

test("TI2-112: un id ajeno, borrado, de otra tabla o sin forma responde el mismo error sin revelar el id", async () => {
  const t = convexTest(schema, modules);
  const { appointments, studentId } = await ti112SeedAgenda(t);
  const deleted = await t.run(async (ctx) => {
    const id = await ctx.db.insert("appointments", {
      accompanimentId: (await ctx.db.get(appointments.plain))!.accompanimentId,
      studentId,
      professionalId: (await ctx.db.get(appointments.plain))!.professionalId,
      modality: "online",
      status: "scheduled",
      startsAt: ti112At(9, 10),
      endsAt: ti112At(9, 11),
      createdAt: 1,
    });
    await ctx.db.delete(id);
    return id;
  });

  const asStudent = ti112Caller(t, "est-1");
  for (const appointmentId of [appointments.foreign, deleted, studentId, "sin-forma"]) {
    const data = await ti111PublicError(
      asStudent.query(api.presentation.appointments.getAppointment, {
        appointmentId,
        version: "v1",
      }),
    );
    expect(data).toStrictEqual(unauthorizedError());
    expect(JSON.stringify(data)).not.toContain(appointmentId);
  }
});

test("TI2-112: un acompañamiento ajeno, de otra tabla o sin forma se deniega en la lista", async () => {
  const t = convexTest(schema, modules);
  const { otherAccompanimentId, studentId } = await ti112SeedAgenda(t);
  const asStudent = ti112Caller(t, "est-1");
  const asRevoked = ti112Caller(t, "pro-1");
  const denied = [
    asStudent.query(api.presentation.appointments.listAppointments, {
      ...TI112_WEEK,
      accompanimentId: otherAccompanimentId,
    }),
    asStudent.query(api.presentation.appointments.listAppointments, {
      ...TI112_WEEK,
      accompanimentId: studentId,
    }),
    asStudent.query(api.presentation.appointments.listAppointments, {
      ...TI112_WEEK,
      accompanimentId: "sin-forma",
    }),
    asRevoked.query(api.presentation.appointments.listAppointments, {
      ...TI112_WEEK,
      accompanimentId: otherAccompanimentId,
    }),
  ];
  for (const call of denied) {
    expect(await ti111PublicError(call)).toStrictEqual(unauthorizedError());
  }
});

test("TI2-112: tres páginas de una atención recorren la agenda sin repetir y en orden de inicio", async () => {
  const t = convexTest(schema, modules);
  const { appointments } = await ti112SeedAgenda(t);
  const asStudent = ti112Caller(t, "est-1");
  const next = (cursor?: string) =>
    asStudent.query(api.presentation.appointments.listAppointments, {
      ...TI112_WEEK,
      limit: 1,
      ...(cursor === undefined ? {} : { cursor }),
    });

  const first = await next();
  expect(first).toMatchObject({ hasMore: true, nextCursor: appointments.plain, version: "v1" });
  const second = await next(first.nextCursor ?? undefined);
  expect(second).toMatchObject({ hasMore: true, nextCursor: appointments.cancelled });
  const third = await next(second.nextCursor ?? undefined);
  expect(third).toMatchObject({ hasMore: false, nextCursor: null });
  expect([...first.items, ...second.items, ...third.items].map((item) => item.id)).toEqual([
    appointments.plain,
    appointments.cancelled,
    appointments.withOtherProfessional,
  ]);
});

test("TI2-112: un cursor de otra persona o una entrada inválida responden conflict", async () => {
  const t = convexTest(schema, modules);
  const { appointments } = await ti112SeedAgenda(t);
  const asStudent = ti112Caller(t, "est-1");
  const list = (overrides: Partial<typeof TI112_WEEK> & { cursor?: string }) =>
    asStudent.query(api.presentation.appointments.listAppointments, {
      ...TI112_WEEK,
      ...overrides,
    });
  const calls = [
    list({ cursor: appointments.foreign }),
    list({ limit: 0 }),
    list({ limit: 51 }),
    list({ limit: 1.5 }),
    list({ to: "2026-07-05" }),
    list({ to: "2026-12-31" }),
    list({ from: "2026-02-30" }),
  ];
  for (const call of calls) {
    expect(await ti111PublicError(call)).toStrictEqual(conflictError());
  }
});

test("TI2-112: una agenda sin atenciones en el rango es una página vacía", async () => {
  const t = convexTest(schema, modules);
  await ti112SeedAgenda(t);
  expect(
    await ti112Caller(t, "est-1").query(api.presentation.appointments.listAppointments, {
      ...TI112_WEEK,
      from: "2026-08-03",
      to: "2026-08-09",
    }),
  ).toStrictEqual({ items: [], hasMore: false, nextCursor: null, version: "v1" });
});

test("TI2-112: el rango incluye su inicio y excluye su fin en los tres alcances", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId, professionalId, studentId } = await ti112SeedAgenda(t);
  const atNextMonday = await t.run(async (ctx) =>
    ctx.db.insert("appointments", {
      accompanimentId,
      studentId,
      professionalId,
      modality: "online",
      status: "scheduled",
      startsAt: ti112At(13, 0),
      endsAt: ti112At(13, 1),
      createdAt: 1,
    }),
  );
  const calls = [
    { caller: "est-1", scope: {} },
    { caller: "pro-1", scope: {} },
    { caller: "est-1", scope: { accompanimentId } },
  ];
  for (const { caller, scope } of calls) {
    const list = (from: string, to: string) =>
      ti112Caller(t, caller).query(api.presentation.appointments.listAppointments, {
        ...TI112_WEEK,
        ...scope,
        from,
        to,
      });
    const week = await list(TI112_WEEK.from, TI112_WEEK.to);
    expect(week.items.map((item) => item.id)).not.toContain(atNextMonday);
    const nextDay = await list("2026-07-13", "2026-07-13");
    expect(nextDay.items.map((item) => item.id)).toEqual([atNextMonday]);
  }
});

test("TI2-112: el validador rechaza zona horaria, profesional, estudiante y otra versión", async () => {
  const t = convexTest(schema, modules);
  const { appointments, professionalId, studentId } = await ti112SeedAgenda(t);
  const asStudent = ti112Caller(t, "est-1");
  const { listAppointments, getAppointment } = api.presentation.appointments;
  await expect(
    asStudent.query(listAppointments, { ...TI112_WEEK, timeZone: "UTC" } as never),
  ).rejects.toThrow("Unexpected field `timeZone`");
  await expect(
    asStudent.query(listAppointments, { ...TI112_WEEK, professionalId } as never),
  ).rejects.toThrow("Unexpected field `professionalId`");
  await expect(
    asStudent.query(listAppointments, { ...TI112_WEEK, studentId } as never),
  ).rejects.toThrow("Unexpected field `studentId`");
  await expect(
    asStudent.query(listAppointments, { ...TI112_WEEK, version: "v2" } as never),
  ).rejects.toThrow("Expected `v1`, got `v2`");
  await expect(
    asStudent.query(getAppointment, {
      appointmentId: appointments.plain,
      version: "v2",
    } as never),
  ).rejects.toThrow("Expected `v1`, got `v2`");
  await expect(
    asStudent.query(getAppointment, {
      appointmentId: appointments.plain,
      version: "v1",
      studentId,
    } as never),
  ).rejects.toThrow("Unexpected field `studentId`");
});

test("TI2-112: una fila sobre el tope responde conflict sin lista cortada en los tres alcances", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId, professionalId, studentId } = await ti112SeedAgenda(t);
  const insertMany = (count: number) =>
    t.run(async (ctx) => {
      for (let index = 0; index < count; index += 1) {
        await ctx.db.insert("appointments", {
          accompanimentId,
          studentId,
          professionalId,
          modality: "online",
          status: "scheduled",
          startsAt: ti112At(10, 8) + index * 60_000,
          endsAt: ti112At(10, 8) + (index + 1) * 60_000,
          createdAt: 1,
        });
      }
    });
  const listAll = ({ caller, scope }: { readonly caller: string; readonly scope: object }) =>
    ti112Caller(t, caller).query(api.presentation.appointments.listAppointments, {
      ...TI112_WEEK,
      ...scope,
      limit: 50,
    });
  const calls = [
    { caller: "est-1", scope: {} },
    { caller: "pro-1", scope: {} },
    { caller: "est-1", scope: { accompanimentId } },
  ];

  // Cada alcance parte con tres atenciones de la semilla en la semana.
  await insertMany(MAX_APPOINTMENTS_IN_RANGE - 3);
  for (const call of calls) {
    expect(await listAll(call)).toMatchObject({ hasMore: true });
  }

  await insertMany(1);
  for (const call of calls) {
    expect(await ti111PublicError(listAll(call))).toStrictEqual(conflictError());
  }
});

test("TI2-112: el Administrador y una llamada sin sesión no leen agenda, acompañamiento ni detalle", async () => {
  const t = convexTest(schema, modules);
  const { accompanimentId, appointments } = await ti112SeedAgenda(t);
  const asAdmin = ti112Caller(t, "adm-1");
  const { getAppointment, listAppointments } = api.presentation.appointments;
  const scoped = { ...TI112_WEEK, accompanimentId };
  const detail = { appointmentId: appointments.plain, version: "v1" as const };
  const calls = [
    asAdmin.query(listAppointments, TI112_WEEK),
    asAdmin.query(listAppointments, scoped),
    asAdmin.query(getAppointment, detail),
    t.query(listAppointments, TI112_WEEK),
    t.query(listAppointments, scoped),
    t.query(getAppointment, detail),
  ];
  for (const call of calls) {
    expect(await ti111PublicError(call)).toStrictEqual(unauthorizedError());
  }
});
