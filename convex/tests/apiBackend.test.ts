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
