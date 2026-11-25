/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

/**
 * Envío Web Push opcional, mensajes genéricos, limpieza de suscripciones
 * vencidas y no duplicación (TI2-160), con `convex-test` y datos ficticios.
 */

const ISSUER = "https://accounts.google.com";
const NOW = Date.UTC(2027, 0, 4, 15, 0, 0);
const SENSITIVE = "Necesidad confidencial CERETI con Profesional";

const REQUEST_SUBMISSION = {
  needSummary: SENSITIVE,
  expectedOutcome: "Acordar ajustes de comunicación",
  accessNeeds: [{ id: "written-communication", label: "Comunicación escrita" }],
  otherAccessNeed: SENSITIVE,
  modalityPreference: "online" as const,
  generalAvailability: {
    preferredWeekdays: [1, 3],
    preferredTimeRange: { from: "09:00", to: "12:00" },
  },
  preferredAccessibleInformationChannel: "Correo",
};

function identityFor(subject: string) {
  return { subject, issuer: ISSUER, tokenIdentifier: `${ISSUER}|${subject}`, name: "Ficticio" };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generateVapidEnv() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwkPriv = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicKey = bytesToBase64Url(rawPub);
  vi.stubEnv("VAPID_PUBLIC_KEY", publicKey);
  vi.stubEnv("VAPID_PRIVATE_KEY", jwkPriv.d ?? "");
  vi.stubEnv("VAPID_SUBJECT", "mailto:prueba@alu.uct.cl");
  return publicKey;
}

async function generateBrowserSubscription(endpoint: string) {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint,
    p256dh: bytesToBase64Url(rawPub),
    auth: bytesToBase64Url(auth),
  };
}

async function seedStudent(
  t: TestConvex<typeof schema>,
  subject: string,
  email: string,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email,
      fullName: "Estudiante Ficticio",
      role: "student",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: `${ISSUER}|${subject}`,
    });
  });
}

async function pushDeliveries(
  t: TestConvex<typeof schema>,
): Promise<Doc<"notificationDeliveries">[]> {
  return await t.run(async (ctx) => {
    const all = await ctx.db.query("notificationDeliveries").take(50);
    return all.filter((row) => row.channel === "push");
  });
}

async function pushSubscriptions(
  t: TestConvex<typeof schema>,
): Promise<Doc<"pushSubscriptions">[]> {
  return await t.run(async (ctx) => await ctx.db.query("pushSubscriptions").take(50));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("TI2-160: sin activar push no se encola ni se envía nada y el resto funciona igual", async () => {
  const pushEndpointsCalled: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const target = String(url);
    if (target.includes("push.example.test")) pushEndpointsCalled.push(target);
    return new Response(null, { status: 200 });
  });

  const t = convexTest(schema, modules);
  await seedStudent(t, "ti160-sin-push", "sinpush@alu.uct.cl");
  const student = t.withIdentity(identityFor("ti160-sin-push"));

  const status = await student.query(api.presentation.notifications.getOwnPushStatus, {});
  expect(status).toEqual({ enabled: false, subscriptionCount: 0, vapidPublicKey: null });

  const created = await student.mutation(
    api.presentation.requests.createRequest,
    REQUEST_SUBMISSION,
  );
  expect(created._id).toBeTruthy();

  await t.finishAllScheduledFunctions(() => {
    vi.setSystemTime(NOW + 1_000);
  });

  expect(pushEndpointsCalled).toHaveLength(0);
  expect(await pushDeliveries(t)).toHaveLength(0);
});

test("TI2-160: activar push envía mensaje cifrado, registra resultado y un reintento no duplica", async () => {
  const publicKey = await generateVapidEnv();
  const pushCalls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const target = String(url);
    if (target.startsWith("https://push.example.test/")) {
      pushCalls.push(target);
      return new Response(null, { status: 201 });
    }
    return new Response(null, { status: 200 });
  });

  const t = convexTest(schema, modules);
  await seedStudent(t, "ti160-con-push", "conpush@alu.uct.cl");
  const student = t.withIdentity(identityFor("ti160-con-push"));

  const sub = await generateBrowserSubscription("https://push.example.test/sub/activo");
  const activated = await student.mutation(
    api.presentation.notifications.activatePushSubscription,
    sub,
  );
  expect(activated).toEqual({ created: true });

  const status = await student.query(api.presentation.notifications.getOwnPushStatus, {});
  expect(status).toEqual({
    enabled: true,
    subscriptionCount: 1,
    vapidPublicKey: publicKey,
  });

  await student.mutation(api.presentation.requests.createRequest, REQUEST_SUBMISSION);
  await t.finishAllScheduledFunctions(() => {
    vi.setSystemTime(NOW + 1_000);
  });

  expect(pushCalls).toEqual(["https://push.example.test/sub/activo"]);
  const rows = await pushDeliveries(t);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ channel: "push", status: "sent", attempts: 1 });
  expect(rows[0]?.sentAt).toBeGreaterThan(0);

  // Un reintento sobre la entrega ya enviada no duplica el envío.
  const retry = await t.action(internal.operations.notifications.dispatchPushDelivery, {
    deliveryId: rows[0]!._id,
  });
  expect(retry).toBe("skipped");
  expect(pushCalls).toHaveLength(1);
});

test("TI2-160: una suscripción vencida (410 Gone) se retira automáticamente y el cambio se conserva", async () => {
  await generateVapidEnv();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url).startsWith("https://push.example.test/")) {
      return new Response(null, { status: 410 });
    }
    return new Response(null, { status: 200 });
  });

  const t = convexTest(schema, modules);
  await seedStudent(t, "ti160-vencida", "vencida@alu.uct.cl");
  const student = t.withIdentity(identityFor("ti160-vencida"));

  const sub = await generateBrowserSubscription("https://push.example.test/sub/vencida");
  await student.mutation(api.presentation.notifications.activatePushSubscription, sub);
  expect(await pushSubscriptions(t)).toHaveLength(1);

  await student.mutation(api.presentation.requests.createRequest, REQUEST_SUBMISSION);
  await t.finishAllScheduledFunctions(() => {
    vi.setSystemTime(NOW + 1_000);
  });

  // La suscripción vencida fue eliminada y el resultado quedó registrado.
  expect(await pushSubscriptions(t)).toHaveLength(0);
  const rows = await pushDeliveries(t);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    channel: "push",
    status: "failed",
    attempts: 1,
    errorCode: "invalid_destination",
  });
});

test("TI2-160: desactivar push solo borra suscripciones propias y exige sesión activa", async () => {
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti160-u1", "u1@alu.uct.cl");
  await seedStudent(t, "ti160-u2", "u2@alu.uct.cl");
  const u1 = t.withIdentity(identityFor("ti160-u1"));
  const u2 = t.withIdentity(identityFor("ti160-u2"));

  const sub1 = await generateBrowserSubscription("https://push.example.test/sub/u1");
  await u1.mutation(api.presentation.notifications.activatePushSubscription, sub1);

  // Otra persona no puede desactivar la suscripción de u1.
  await expect(
    u2.mutation(api.presentation.notifications.deactivatePushSubscription, {
      endpoint: sub1.endpoint,
    }),
  ).resolves.toEqual({ deleted: false });

  // El dueño sí puede desactivarla.
  await expect(
    u1.mutation(api.presentation.notifications.deactivatePushSubscription, {
      endpoint: sub1.endpoint,
    }),
  ).resolves.toEqual({ deleted: true });
  expect(await pushSubscriptions(t)).toHaveLength(0);

  // Sin sesión, rechaza con unauthorized.
  await expect(t.query(api.presentation.notifications.getOwnPushStatus, {})).rejects.toThrow(
    ConvexError,
  );
});

test("TI2-160: un corte tras reservar la entrega push marca delivery_uncertain y el cron no vuelve a enviar", async () => {
  await generateVapidEnv();
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti160-corte", "corte-push@alu.uct.cl");
  const student = t.withIdentity(identityFor("ti160-corte"));

  const sub = await generateBrowserSubscription("https://push.example.test/sub/corte");
  await student.mutation(api.presentation.notifications.activatePushSubscription, sub);
  await student.mutation(api.presentation.requests.createRequest, REQUEST_SUBMISSION);

  const queued = await pushDeliveries(t);
  expect(queued).toHaveLength(1);
  const deliveryId = queued[0]!._id;

  const claim = await t.mutation(internal.operations.notifications.claimPushDelivery, {
    deliveryId,
    now: NOW,
  });
  expect(claim.status).toBe("claimed");

  const afterCrash = await pushDeliveries(t);
  expect(afterCrash[0]).toMatchObject({
    channel: "push",
    status: "failed",
    attempts: 1,
    errorCode: "delivery_uncertain",
  });
  expect(afterCrash[0]?.nextAttemptAt).toBeUndefined();

  vi.setSystemTime(NOW + 24 * 60 * 60_000);
  const due = await t.mutation(
    internal.operations.notifications.scheduleDueNotificationDeliveries,
    {},
  );
  expect(due.push).toBe(0);

  const retry = await t.action(internal.operations.notifications.dispatchPushDelivery, {
    deliveryId,
  });
  expect(retry).toBe("skipped");
});
