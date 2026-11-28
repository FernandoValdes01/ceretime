/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { guardPrivacyTreatment } from "../application/privacy/blocking";
import { privacyBlockReader } from "../infrastructure/privacy/repository";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const ISSUER = "https://accounts.google.com";
const NOW = Date.UTC(2026, 10, 2, 12); // 2026-11-02 12:00 UTC
const VERSION = "v1" as const;
const PAGE = { numItems: 10, cursor: null };
const DENIED = { code: "unauthorized", message: "No autorizado" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function identityFor(subject: string) {
  return {
    subject,
    issuer: ISSUER,
    tokenIdentifier: `${ISSUER}|${subject}`,
    email: `${subject}@uct.cl`,
    name: "Ficticio",
  };
}

async function publicError(promise: Promise<unknown>) {
  return await promise.then(
    () => {
      throw new Error("Se esperaba un error público");
    },
    (error: unknown) => (error instanceof ConvexError ? error.data : error),
  );
}

async function seedUser(
  t: ReturnType<typeof convexTest>,
  subject: string,
  role: "student" | "professional" | "intern" | "admin",
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `${subject}@uct.cl`,
      fullName: "Ficticio",
      role,
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${subject}`,
    });
  });
}

const privacyApi = api.presentation.privacy;

test("TI2-167 API: el Estudiante presenta y recibe acuse con vencimiento exclusivo", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti167-est", "student");
  const asStudent = t.withIdentity(identityFor("ti167-est"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "erasure",
    version: VERSION,
  });

  expect(receipt.kind).toBe("erasure");
  expect(receipt.status).toBe("received");
  expect(receipt.channel).toBe("student_app");
  expect(receipt.view).toBe("own");
  expect(receipt.receivedAt).toBe(NOW);
  // 30 días corridos: vencimiento exclusivo
  expect(receipt.dueAt).toBeGreaterThan(NOW);
  expect(receipt.initialDueAt).toBe(receipt.dueAt);
  expect(receipt.responseRule).toBe("calendar_30");
  expect(receipt.timeZone).toBe("America/Santiago");
});

test("TI2-167 API: solo el Estudiante presenta; otros roles y sin sesión son unauthorized", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti167-pro", "professional");
  await seedUser(t, "ti167-adm", "admin");

  const asPro = t.withIdentity(identityFor("ti167-pro"));
  const asAdm = t.withIdentity(identityFor("ti167-adm"));
  const asAnon = t;

  expect(
    await publicError(
      asPro.mutation(privacyApi.submitPrivacyRequest, { kind: "access", version: VERSION }),
    ),
  ).toEqual(DENIED);
  expect(
    await publicError(
      asAdm.mutation(privacyApi.submitPrivacyRequest, { kind: "access", version: VERSION }),
    ),
  ).toEqual(DENIED);
  expect(
    await publicError(
      asAnon.mutation(privacyApi.submitPrivacyRequest, { kind: "access", version: VERSION }),
    ),
  ).toEqual(DENIED);
});

test("TI2-168 API: bloqueo y oposición ya se pueden presentar desde la aplicación", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti167-est2", "student");
  const asStudent = t.withIdentity(identityFor("ti167-est2"));

  for (const kind of ["blocking", "objection"] as const) {
    const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
      kind,
      version: VERSION,
    });
    expect(receipt.kind).toBe(kind);
    expect(receipt.status).toBe("received");
    expect(receipt.responseRule).toBe(kind === "blocking" ? "business_2" : "calendar_30");
  }
});

test("TI2-167 API: solo el Administrador revisa, resuelve, prorroga y deja constancia", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti167-est-role", "student");
  await seedUser(t, "ti167-pro-role", "professional");
  await seedUser(t, "ti167-adm-role", "admin");

  const asStudent = t.withIdentity(identityFor("ti167-est-role"));
  const asProfessional = t.withIdentity(identityFor("ti167-pro-role"));
  const asAdmin = t.withIdentity(identityFor("ti167-adm-role"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "access",
    version: VERSION,
  });

  const intruders = [asStudent, asProfessional];

  for (const identity of intruders) {
    // Tomar la solicitud para revisión.
    expect(
      await publicError(
        identity.mutation(privacyApi.startPrivacyRequestReview, {
          requestId: receipt.id,
          version: VERSION,
        }),
      ),
    ).toEqual(DENIED);

    // Resolverla con una respuesta fundada.
    expect(
      await publicError(
        identity.mutation(privacyApi.resolvePrivacyRequest, {
          requestId: receipt.id,
          outcome: "granted",
          reasons: "Intento no autorizado.",
          version: VERSION,
        }),
      ),
    ).toEqual(DENIED);

    // Prorrogar el plazo.
    expect(
      await publicError(
        identity.mutation(privacyApi.extendPrivacyRequestDeadline, {
          requestId: receipt.id,
          days: 10,
          reason: "Intento no autorizado.",
          version: VERSION,
        }),
      ),
    ).toEqual(DENIED);

    // Registrar la constancia de envío.
    expect(
      await publicError(
        identity.mutation(privacyApi.recordPrivacyResponseDelivery, {
          requestId: receipt.id,
          channel: "student_app",
          reference: "FOLIO-INTENTO",
          version: VERSION,
        }),
      ),
    ).toEqual(DENIED);
  }

  // La solicitud queda intacta: recibida, sin prórroga, respuesta ni constancia.
  const after = await asAdmin.query(privacyApi.getPrivacyRequest, {
    requestId: receipt.id,
    version: VERSION,
  });
  expect(after.status).toBe("received");
  expect(after.dueAt).toBe(receipt.dueAt);
  expect(after.initialDueAt).toBe(receipt.initialDueAt);
  expect(after.extension).toBeUndefined();
  expect(after.response).toBeUndefined();
  expect(after.deliveryReceipt).toBeUndefined();
  expect(after.effect).toBeUndefined();

  // El Administrador sí puede tomar la solicitud después de los intentos.
  const inReview = await asAdmin.mutation(privacyApi.startPrivacyRequestReview, {
    requestId: receipt.id,
    version: VERSION,
  });
  expect(inReview.status).toBe("in_review");
});

test("TI2-167 API: el titular consulta solo lo propio y el Administrador revisa", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, "ti167-est3", "student");
  await seedUser(t, "ti167-adm2", "admin");

  const asStudent = t.withIdentity(identityFor("ti167-est3"));
  const asAdmin = t.withIdentity(identityFor("ti167-adm2"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "access",
    version: VERSION,
  });

  // El titular ve su propia solicitud
  const own = await asStudent.query(privacyApi.getPrivacyRequest, {
    requestId: receipt.id,
    version: VERSION,
  });
  expect(own.view).toBe("own");
  expect(own.id).toBe(receipt.id);

  // El Administrador ve la vista de revisión
  const review = await asAdmin.query(privacyApi.getPrivacyRequest, {
    requestId: receipt.id,
    version: VERSION,
  });
  expect(review.view).toBe("review");
  expect((review as { requesterId: Id<"users"> }).requesterId).toBe(studentId);

  // Otro estudiante no puede verla
  await seedUser(t, "ti167-est4", "student");
  const asOther = t.withIdentity(identityFor("ti167-est4"));
  expect(
    await publicError(
      asOther.query(privacyApi.getPrivacyRequest, { requestId: receipt.id, version: VERSION }),
    ),
  ).toEqual(DENIED);
});

test("TI2-167 API: una solicitud ajena o inexistente responde unauthorized sin revelar existencia", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti167-est5", "student");
  const asStudent = t.withIdentity(identityFor("ti167-est5"));

  // Crear y borrar una solicitud para obtener un ID válido inexistente
  const missingId = await t.run(async (ctx) => {
    const studentId = await ctx.db.insert("users", {
      email: "temp@uct.cl",
      fullName: "Temp",
      role: "student",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: "temp",
    });
    const id = await ctx.db.insert("privacyRequests", {
      kind: "access",
      status: "received",
      requesterId: studentId,
      requesterRole: "student",
      channel: "student_app",
      receivedAt: NOW,
      version: "v1",
      responseRule: "calendar_30",
      receivedDate: "2026-11-02",
      initialDueDate: "2026-12-02",
      initialDueAt: NOW + 30 * 24 * 60 * 60_000,
      dueAt: NOW + 30 * 24 * 60 * 60_000,
      deadlineTimeZone: "America/Santiago",
      deadlineHolidays: [],
      updatedAt: NOW,
    });
    await ctx.db.delete(id);
    return id;
  });

  expect(
    await publicError(
      asStudent.query(privacyApi.getPrivacyRequest, { requestId: missingId, version: VERSION }),
    ),
  ).toEqual(DENIED);
});

test("TI2-167 API: ciclo completo de revisión y resolución con effect authorized y preserved", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti167-est6", "student");
  await seedUser(t, "ti167-adm3", "admin");

  const asStudent = t.withIdentity(identityFor("ti167-est6"));
  const asAdmin = t.withIdentity(identityFor("ti167-adm3"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "portability",
    version: VERSION,
  });

  // Tomar para revisión
  const inReview = await asAdmin.mutation(privacyApi.startPrivacyRequestReview, {
    requestId: receipt.id,
    version: VERSION,
  });
  expect(inReview.status).toBe("in_review");

  // Resolver con concesión → effect: authorized
  const resolved = await asAdmin.mutation(privacyApi.resolvePrivacyRequest, {
    requestId: receipt.id,
    outcome: "granted",
    reasons: "Se concede la portabilidad solicitada.",
    version: VERSION,
  });
  expect(resolved.status).toBe("resolved");
  expect(resolved.effect).toBe("authorized");
  expect(resolved.response?.outcome).toBe("granted");

  // Constancia de envío de denegación (nueva solicitud)
  const receipt2 = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "access",
    version: VERSION,
  });
  await asAdmin.mutation(privacyApi.startPrivacyRequestReview, {
    requestId: receipt2.id,
    version: VERSION,
  });
  const denied = await asAdmin.mutation(privacyApi.resolvePrivacyRequest, {
    requestId: receipt2.id,
    outcome: "denied",
    reasons: "No procede conforme al procedimiento de prueba.",
    version: VERSION,
  });
  expect(denied.effect).toBe("preserved");

  const delivery = await asAdmin.mutation(privacyApi.recordPrivacyResponseDelivery, {
    requestId: receipt2.id,
    channel: "student_app",
    reference: "FOLIO-2026-0001",
    version: VERSION,
  });
  expect(delivery.deliveryReceipt?.channel).toBe("student_app");
  expect(delivery.deliveryReceipt?.reference).toBe("FOLIO-2026-0001");
  expect(delivery.deliveryReceipt?.agencyClaimDueDate).toBeTruthy();
  expect(delivery.deliveryReceipt?.agencyClaimDueAt).toBeGreaterThan(NOW);
});

test("TI2-167 API: prórroga única y segunda rechazada sin escribir", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti167-est7", "student");
  await seedUser(t, "ti167-adm4", "admin");

  const asStudent = t.withIdentity(identityFor("ti167-est7"));
  const asAdmin = t.withIdentity(identityFor("ti167-adm4"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "rectification",
    version: VERSION,
  });

  await asAdmin.mutation(privacyApi.startPrivacyRequestReview, {
    requestId: receipt.id,
    version: VERSION,
  });

  // Primera prórroga: se aplica
  const extended = await asAdmin.mutation(privacyApi.extendPrivacyRequestDeadline, {
    requestId: receipt.id,
    days: 15,
    reason: "Necesita más tiempo para verificar.",
    version: VERSION,
  });
  expect(extended.extension?.days).toBe(15);
  expect(extended.dueAt).toBeGreaterThan(receipt.dueAt);

  // Segunda prórroga: rechazada con conflict
  const error = await publicError(
    asAdmin.mutation(privacyApi.extendPrivacyRequestDeadline, {
      requestId: receipt.id,
      days: 10,
      reason: "Otra prórroga.",
      version: VERSION,
    }),
  );
  expect(error).toMatchObject({ code: "conflict" });

  // dueAt no cambió
  const after = await asAdmin.query(privacyApi.getPrivacyRequest, {
    requestId: receipt.id,
    version: VERSION,
  });
  expect(after.dueAt).toBe(extended.dueAt);
});

test("TI2-167 API: la prórroga con plazo vencido se rechaza con conflict", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti167-est8", "student");
  await seedUser(t, "ti167-adm5", "admin");

  const asStudent = t.withIdentity(identityFor("ti167-est8"));
  const asAdmin = t.withIdentity(identityFor("ti167-adm5"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "erasure",
    version: VERSION,
  });

  await asAdmin.mutation(privacyApi.startPrivacyRequestReview, {
    requestId: receipt.id,
    version: VERSION,
  });

  // Avanzar el reloj justo a dueAt (vencimiento exclusivo)
  vi.setSystemTime(receipt.dueAt);

  const error = await publicError(
    asAdmin.mutation(privacyApi.extendPrivacyRequestDeadline, {
      requestId: receipt.id,
      days: 10,
      reason: "Prórroga tardía.",
      version: VERSION,
    }),
  );
  expect(error).toMatchObject({ code: "conflict" });

  // dueAt no cambió
  const after = await asAdmin.query(privacyApi.getPrivacyRequest, {
    requestId: receipt.id,
    version: VERSION,
  });
  expect(after.dueAt).toBe(receipt.dueAt);
});

test("TI2-167 API: la prórroga justo antes del vencimiento se aplica", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti167-est9", "student");
  await seedUser(t, "ti167-adm6", "admin");

  const asStudent = t.withIdentity(identityFor("ti167-est9"));
  const asAdmin = t.withIdentity(identityFor("ti167-adm6"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "access",
    version: VERSION,
  });

  await asAdmin.mutation(privacyApi.startPrivacyRequestReview, {
    requestId: receipt.id,
    version: VERSION,
  });

  // Avanzar el reloj a 1ms antes de dueAt
  vi.setSystemTime(receipt.dueAt - 1);

  const extended = await asAdmin.mutation(privacyApi.extendPrivacyRequestDeadline, {
    requestId: receipt.id,
    days: 5,
    reason: "Prórroga a tiempo.",
    version: VERSION,
  });
  expect(extended.extension?.days).toBe(5);
  expect(extended.dueAt).toBeGreaterThan(receipt.dueAt);
});

test("TI2-167 API: la constancia duplicada responde already_recorded", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti167-est10", "student");
  await seedUser(t, "ti167-adm7", "admin");

  const asStudent = t.withIdentity(identityFor("ti167-est10"));
  const asAdmin = t.withIdentity(identityFor("ti167-adm7"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "access",
    version: VERSION,
  });

  await asAdmin.mutation(privacyApi.startPrivacyRequestReview, {
    requestId: receipt.id,
    version: VERSION,
  });
  await asAdmin.mutation(privacyApi.resolvePrivacyRequest, {
    requestId: receipt.id,
    outcome: "denied",
    reasons: "No procede.",
    version: VERSION,
  });

  await asAdmin.mutation(privacyApi.recordPrivacyResponseDelivery, {
    requestId: receipt.id,
    channel: "student_app",
    reference: "FOLIO-1",
    version: VERSION,
  });

  const error = await publicError(
    asAdmin.mutation(privacyApi.recordPrivacyResponseDelivery, {
      requestId: receipt.id,
      channel: "student_app",
      reference: "FOLIO-2",
      version: VERSION,
    }),
  );
  expect(error).toMatchObject({ code: "conflict" });
});

test("TI2-167 API: la constancia sobre solicitud no resuelta responde conflict", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti167-est11", "student");
  await seedUser(t, "ti167-adm8", "admin");

  const asStudent = t.withIdentity(identityFor("ti167-est11"));
  const asAdmin = t.withIdentity(identityFor("ti167-adm8"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "access",
    version: VERSION,
  });

  const error = await publicError(
    asAdmin.mutation(privacyApi.recordPrivacyResponseDelivery, {
      requestId: receipt.id,
      channel: "student_app",
      reference: "FOLIO-1",
      version: VERSION,
    }),
  );
  expect(error).toMatchObject({ code: "conflict" });
});

test("TI2-167 API: páginas propias y cola del Administrador", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti167-est12", "student");
  await seedUser(t, "ti167-adm9", "admin");

  const asStudent = t.withIdentity(identityFor("ti167-est12"));
  const asAdmin = t.withIdentity(identityFor("ti167-adm9"));

  await asStudent.mutation(privacyApi.submitPrivacyRequest, { kind: "access", version: VERSION });

  const ownPage = await asStudent.query(privacyApi.listOwnPrivacyRequests, {
    paginationOpts: PAGE,
    version: VERSION,
  });
  expect(ownPage.page).toHaveLength(1);
  expect(ownPage.page[0].view).toBe("own");

  const queue = await asAdmin.query(privacyApi.listPrivacyRequests, {
    paginationOpts: PAGE,
    version: VERSION,
  });
  expect(queue.page).toHaveLength(1);
  expect(queue.page[0].view).toBe("review");

  // Otro rol no puede listar
  await seedUser(t, "ti167-pro2", "professional");
  const asPro = t.withIdentity(identityFor("ti167-pro2"));
  expect(
    await publicError(
      asPro.query(privacyApi.listOwnPrivacyRequests, { paginationOpts: PAGE, version: VERSION }),
    ),
  ).toEqual(DENIED);
  expect(
    await publicError(
      asPro.query(privacyApi.listPrivacyRequests, { paginationOpts: PAGE, version: VERSION }),
    ),
  ).toEqual(DENIED);
});

test("TI2-167 API: referencia vacía en constancia responde privacy_request_fields_invalid", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti167-est13", "student");
  await seedUser(t, "ti167-adm10", "admin");

  const asStudent = t.withIdentity(identityFor("ti167-est13"));
  const asAdmin = t.withIdentity(identityFor("ti167-adm10"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "access",
    version: VERSION,
  });

  await asAdmin.mutation(privacyApi.startPrivacyRequestReview, {
    requestId: receipt.id,
    version: VERSION,
  });
  await asAdmin.mutation(privacyApi.resolvePrivacyRequest, {
    requestId: receipt.id,
    outcome: "denied",
    reasons: "No procede.",
    version: VERSION,
  });

  const error = await publicError(
    asAdmin.mutation(privacyApi.recordPrivacyResponseDelivery, {
      requestId: receipt.id,
      channel: "student_app",
      reference: "   ",
      version: VERSION,
    }),
  );
  expect(error).toMatchObject({ code: "privacy_request_fields_invalid" });
});

test("TI2-167 API: días de prórroga fuera de 1-30 responde privacy_request_fields_invalid", async () => {
  const t = convexTest(schema, modules);
  await seedUser(t, "ti167-est14", "student");
  await seedUser(t, "ti167-adm11", "admin");

  const asStudent = t.withIdentity(identityFor("ti167-est14"));
  const asAdmin = t.withIdentity(identityFor("ti167-adm11"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "access",
    version: VERSION,
  });

  await asAdmin.mutation(privacyApi.startPrivacyRequestReview, {
    requestId: receipt.id,
    version: VERSION,
  });

  const error = await publicError(
    asAdmin.mutation(privacyApi.extendPrivacyRequestDeadline, {
      requestId: receipt.id,
      days: 0,
      reason: "Prórroga inválida.",
      version: VERSION,
    }),
  );
  expect(error).toMatchObject({ code: "privacy_request_fields_invalid" });
});

test("TI2-168 API: el plazo de 2 días hábiles salta el feriado del 8 de diciembre", async () => {
  // Lunes 7 de diciembre en America/Santiago. El martes 8 es feriado, así
  // que los dos días hábiles caen el miércoles 9 y el jueves 10.
  vi.setSystemTime(Date.UTC(2026, 11, 7, 12));
  const t = convexTest(schema, modules);
  await seedUser(t, "ti168-est-deadline", "student");
  const asStudent = t.withIdentity(identityFor("ti168-est-deadline"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "blocking",
    version: VERSION,
  });

  expect(receipt.responseRule).toBe("business_2");
  expect(receipt.receivedDate).toBe("2026-12-07");
  expect(receipt.initialDueDate).toBe("2026-12-10");
  expect(receipt.initialDueAt).toBeGreaterThan(receipt.receivedAt);
});

test("TI2-168 API: la oposición concedida surte efecto y se comunica al titular", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, "ti168-est-objection-ok", "student");
  await seedUser(t, "ti168-adm-objection-ok", "admin");
  const asStudent = t.withIdentity(identityFor("ti168-est-objection-ok"));
  const asAdmin = t.withIdentity(identityFor("ti168-adm-objection-ok"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "objection",
    version: VERSION,
  });
  await asAdmin.mutation(privacyApi.startPrivacyRequestReview, {
    requestId: receipt.id,
    version: VERSION,
  });
  const resolved = await asAdmin.mutation(privacyApi.resolvePrivacyRequest, {
    requestId: receipt.id,
    outcome: "granted",
    reasons: "Se acoge la oposición y se suspende el tratamiento impugnado.",
    version: VERSION,
  });

  expect(resolved.status).toBe("resolved");
  expect(resolved.effect).toBe("authorized");
  expect(resolved.response?.outcome).toBe("granted");
  const stored = await t.run(async (ctx) => await ctx.db.get(receipt.id));
  expect(stored).toMatchObject({ kind: "objection", status: "resolved" });
  expect(stored?.response?.reasons).toBe(
    "Se acoge la oposición y se suspende el tratamiento impugnado.",
  );

  const events = await t.run(async (ctx) => await ctx.db.query("notificationEvents").collect());
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    kind: "privacy_request_granted",
    privacyRequestId: receipt.id,
    recipientId: studentId,
  });
  expect(events[0]).not.toHaveProperty("requestId");
});

test("TI2-168 API: la oposición denegada conserva los datos y también se comunica", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, "ti168-est-objection-no", "student");
  await seedUser(t, "ti168-adm-objection-no", "admin");
  const asStudent = t.withIdentity(identityFor("ti168-est-objection-no"));
  const asAdmin = t.withIdentity(identityFor("ti168-adm-objection-no"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "objection",
    version: VERSION,
  });
  await asAdmin.mutation(privacyApi.startPrivacyRequestReview, {
    requestId: receipt.id,
    version: VERSION,
  });
  const resolved = await asAdmin.mutation(privacyApi.resolvePrivacyRequest, {
    requestId: receipt.id,
    outcome: "denied",
    reasons: "La oposición se rechaza por motivos fundados.",
    version: VERSION,
  });

  expect(resolved.status).toBe("resolved");
  expect(resolved.effect).toBe("preserved");
  expect(resolved.response?.outcome).toBe("denied");
  const stored = await t.run(async (ctx) => await ctx.db.get(receipt.id));
  expect(stored).toMatchObject({ kind: "objection", status: "resolved" });
  expect(stored?.response?.reasons).toBe("La oposición se rechaza por motivos fundados.");

  const events = await t.run(async (ctx) => await ctx.db.query("notificationEvents").collect());
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    kind: "privacy_request_denied",
    privacyRequestId: receipt.id,
    recipientId: studentId,
  });
});

test("TI2-168 API: la rectificación resuelta comunica la respuesta al titular", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, "ti168-est-rectification", "student");
  await seedUser(t, "ti168-adm-rectification", "admin");
  const asStudent = t.withIdentity(identityFor("ti168-est-rectification"));
  const asAdmin = t.withIdentity(identityFor("ti168-adm-rectification"));

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "rectification",
    version: VERSION,
  });
  await asAdmin.mutation(privacyApi.startPrivacyRequestReview, {
    requestId: receipt.id,
    version: VERSION,
  });
  const resolved = await asAdmin.mutation(privacyApi.resolvePrivacyRequest, {
    requestId: receipt.id,
    outcome: "granted",
    reasons: "Se rectifican los datos señalados por el titular.",
    version: VERSION,
  });

  expect(resolved.status).toBe("resolved");
  expect(resolved.response?.outcome).toBe("granted");
  const stored = await t.run(async (ctx) => await ctx.db.get(receipt.id));
  expect(stored).toMatchObject({ kind: "rectification", status: "resolved" });

  const events = await t.run(async (ctx) => await ctx.db.query("notificationEvents").collect());
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    kind: "privacy_request_granted",
    privacyRequestId: receipt.id,
    recipientId: studentId,
  });
});

test("TI2-168 API: conceder un bloqueo materializa la fila que suspende las cuatro vías", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedUser(t, "ti168-est-materialize", "student");
  const adminId = await seedUser(t, "ti168-adm-materialize", "admin");
  const asStudent = t.withIdentity(identityFor("ti168-est-materialize"));
  const asAdmin = t.withIdentity(identityFor("ti168-adm-materialize"));
  const endsAt = NOW + 2 * 24 * 60 * 60 * 1000;

  const receipt = await asStudent.mutation(privacyApi.submitPrivacyRequest, {
    kind: "blocking",
    version: VERSION,
  });
  await asAdmin.mutation(privacyApi.startPrivacyRequestReview, {
    requestId: receipt.id,
    version: VERSION,
  });
  const resolved = await asAdmin.mutation(privacyApi.resolvePrivacyRequest, {
    requestId: receipt.id,
    outcome: "granted",
    reasons: "Bloqueo temporal concedido mientras se revisa la oposición.",
    temporaryBlockUntil: endsAt,
    version: VERSION,
  });

  expect(resolved.status).toBe("resolved");
  expect(resolved.response?.temporaryBlockUntil).toBe(endsAt);

  const blocks = await t.run(async (ctx) => await ctx.db.query("privacyBlocks").collect());
  expect(blocks).toHaveLength(1);
  expect(blocks[0]).toMatchObject({
    subjectId: studentId,
    requestId: receipt.id,
    scope: "all_personal_data",
    startsAt: NOW,
    endsAt,
    createdBy: adminId,
  });

  // El guardia, con el lector real de Infraestructura, ve el bloqueo materializado.
  const decision = await t.run(async (ctx) => {
    const reader = privacyBlockReader(ctx);
    return await guardPrivacyTreatment(
      {
        blocks: {
          listActiveBlocksForSubject: (subjectId: string, now: number) =>
            reader.listActiveBlocksForSubject(subjectId, now),
        },
        now: () => NOW,
      },
      { subjectId: studentId, category: "appointments", treatment: "query" },
    );
  });
  expect(decision).toMatchObject({ status: "blocked", blockId: blocks[0]._id });

  // El bloqueo suspende el tratamiento sin borrar ni modificar la solicitud.
  const stored = await t.run(async (ctx) => await ctx.db.get(receipt.id));
  expect(stored).toMatchObject({
    kind: "blocking",
    status: "resolved",
    receivedAt: NOW,
    initialDueDate: "2026-11-04",
  });
  expect(await t.run(async (ctx) => await ctx.db.query("privacyBlocks").collect())).toHaveLength(1);
});
