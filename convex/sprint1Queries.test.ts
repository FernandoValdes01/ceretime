/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ACCESS_NEEDS_MAX_LENGTH } from "./domain/request/request";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

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

async function seedUser(
  t: ReturnType<typeof convexTest>,
  input: {
    subject: string;
    email: string;
    role: "student" | "professional" | "intern" | "admin";
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

async function seedRequest(
  t: ReturnType<typeof convexTest>,
  studentId: Id<"users">,
  accessNeeds = "Necesidad ficticia",
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("requests", {
      studentId,
      status: "received",
      accessNeeds,
      createdAt: 1,
    });
  });
}

test("perfil propio devuelve solo lo necesario para la interfaz", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, { subject: "ti10-est-1", email: "ti10-est-1@alu.uct.cl", role: "student" });

  const asStudent = t.withIdentity(identityFor("ti10-est-1", "ti10-est-1@alu.uct.cl"));
  const profile = await asStudent.query(api.presentation.session.getMyProfile, {});
  expect(profile).toEqual({
    fullName: "Ficticio",
    email: "ti10-est-1@alu.uct.cl",
    role: "student",
    institutionalStatus: "enabled",
    accountStatus: "active",
  });
  expect(profile).not.toHaveProperty("tokenIdentifier");
});

test("perfil propio sin identidad o sin perfil se deniega", async () => {
  const t = convexTest(schema, modules);

  await expect(t.query(api.presentation.session.getMyProfile, {})).rejects.toThrow("No autorizado");

  const unknown = t.withIdentity(identityFor("ti10-nadie-1", "nadie@alu.uct.cl"));
  await expect(unknown.query(api.presentation.session.getMyProfile, {})).rejects.toThrow(
    "No autorizado",
  );
});

test("perfil propio informa el estado aunque la cuenta esté inhabilitada", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, {
    subject: "ti10-est-2",
    email: "ti10-est-2@alu.uct.cl",
    role: "student",
    institutionalStatus: "disabled",
  });

  const asStudent = t.withIdentity(identityFor("ti10-est-2", "ti10-est-2@alu.uct.cl"));
  const profile = await asStudent.query(api.presentation.session.getMyProfile, {});
  expect(profile.institutionalStatus).toBe("disabled");
});

test("estudiante detalla su solicitud propia y no la ajena", async () => {
  const t = convexTest(schema, modules);
  const ownId = await seedUser(t, {
    subject: "ti10-est-3",
    email: "ti10-est-3@alu.uct.cl",
    role: "student",
  });
  const otherId = await seedUser(t, {
    subject: "ti10-est-4",
    email: "ti10-est-4@alu.uct.cl",
    role: "student",
  });
  const ownRequest = await seedRequest(t, ownId);
  const otherRequest = await seedRequest(t, otherId);

  const asOwn = t.withIdentity(identityFor("ti10-est-3", "ti10-est-3@alu.uct.cl"));
  const detail = await asOwn.query(api.presentation.requests.getRequest, {
    requestId: ownRequest,
  });
  expect(detail._id).toEqual(ownRequest);
  expect(detail.accessNeeds).toBe("Necesidad ficticia");

  await expect(
    asOwn.query(api.presentation.requests.getRequest, { requestId: otherRequest }),
  ).rejects.toThrow("No autorizado");
});

test("profesional detalla solo la solicitud tomada", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti10-est-5",
    email: "ti10-est-5@alu.uct.cl",
    role: "student",
  });
  await seedUser(t, { subject: "ti10-pro-1", email: "ti10-pro-1@uct.cl", role: "professional" });
  const takenId = await t.mutation(internal.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Tomada ficticia",
  });
  const openId = await t.mutation(internal.requests.createTestRequest, {
    studentId,
    status: "received",
    accessNeeds: "Abierta ficticia",
  });

  const asProfessional = t.withIdentity(identityFor("ti10-pro-1", "ti10-pro-1@uct.cl"));
  await asProfessional.mutation(api.presentation.requests.takeRequest, { requestId: takenId });

  const taken = await asProfessional.query(api.presentation.requests.getRequest, {
    requestId: takenId,
  });
  expect(taken._id).toEqual(takenId);
  expect(taken.accessNeeds).toBe("Tomada ficticia");

  await expect(
    asProfessional.query(api.presentation.requests.getRequest, { requestId: openId }),
  ).rejects.toThrow("No autorizado");
});

test("detalle deniega a practicante, administrador y anónimo sin filtrar", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti10-est-6",
    email: "ti10-est-6@alu.uct.cl",
    role: "student",
  });
  await seedUser(t, { subject: "ti10-int-1", email: "ti10-int-1@alu.uct.cl", role: "intern" });
  await seedUser(t, { subject: "ti10-adm-1", email: "ti10-adm-1@uct.cl", role: "admin" });
  const requestId = await seedRequest(t, studentId);

  const asIntern = t.withIdentity(identityFor("ti10-int-1", "ti10-int-1@alu.uct.cl"));
  const internMessage = await asIntern
    .query(api.presentation.requests.getRequest, { requestId })
    .then(
      () => {
        throw new Error("Se esperaba denegación");
      },
      (error: Error) => error.message,
    );
  expect(internMessage).toContain("No autorizado");
  expect(internMessage).not.toContain(String(requestId));

  const asAdmin = t.withIdentity(identityFor("ti10-adm-1", "ti10-adm-1@uct.cl"));
  await expect(asAdmin.query(api.presentation.requests.getRequest, { requestId })).rejects.toThrow(
    "No autorizado",
  );

  await expect(t.query(api.presentation.requests.getRequest, { requestId })).rejects.toThrow(
    "No autorizado",
  );
});

test("detalle inexistente responde igual sin revelar existencia", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti10-est-7",
    email: "ti10-est-7@alu.uct.cl",
    role: "student",
  });
  const missingId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("requests", {
      studentId,
      status: "received",
      accessNeeds: "Temporal ficticia",
      createdAt: 1,
    });
    await ctx.db.delete(id);
    return id;
  });

  const asStudent = t.withIdentity(identityFor("ti10-est-7", "ti10-est-7@alu.uct.cl"));
  const message = await asStudent
    .query(api.presentation.requests.getRequest, { requestId: missingId })
    .then(
      () => {
        throw new Error("Se esperaba denegación");
      },
      (error: Error) => error.message,
    );
  expect(message).toContain("No autorizado");
  expect(message).not.toContain(String(missingId));
});

test("detalle deniega cuenta inhabilitada aunque la solicitud sea propia", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti10-est-9",
    email: "ti10-est-9@alu.uct.cl",
    role: "student",
    institutionalStatus: "disabled",
  });
  const requestId = await seedRequest(t, studentId);

  const asStudent = t.withIdentity(identityFor("ti10-est-9", "ti10-est-9@alu.uct.cl"));
  const message = await asStudent.query(api.presentation.requests.getRequest, { requestId }).then(
    () => {
      throw new Error("Se esperaba denegación");
    },
    (error: Error) => error.message,
  );
  expect(message).toContain("No autorizado");
  expect(message).not.toContain(String(requestId));
});

test("detalle deniega cuenta inactiva aunque la solicitud sea propia", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, {
    subject: "ti10-est-10",
    email: "ti10-est-10@alu.uct.cl",
    role: "student",
    accountStatus: "inactive",
  });
  const requestId = await seedRequest(t, studentId);

  const asStudent = t.withIdentity(identityFor("ti10-est-10", "ti10-est-10@alu.uct.cl"));
  const message = await asStudent.query(api.presentation.requests.getRequest, { requestId }).then(
    () => {
      throw new Error("Se esperaba denegación");
    },
    (error: Error) => error.message,
  );
  expect(message).toContain("No autorizado");
  expect(message).not.toContain(String(requestId));
});

test("registro valida la necesidad de acceso sin crear nada inválido", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, { subject: "ti10-est-8", email: "ti10-est-8@alu.uct.cl", role: "student" });
  const asStudent = t.withIdentity(identityFor("ti10-est-8", "ti10-est-8@alu.uct.cl"));

  await expect(
    asStudent.mutation(api.presentation.requests.createRequest, { accessNeeds: "   " }),
  ).rejects.toThrow("necesidad");

  await expect(
    asStudent.mutation(api.presentation.requests.createRequest, {
      accessNeeds: "x".repeat(ACCESS_NEEDS_MAX_LENGTH + 1),
    }),
  ).rejects.toThrow("máximo");
});
