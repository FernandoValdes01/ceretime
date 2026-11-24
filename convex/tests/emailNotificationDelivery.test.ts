/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { SENDER_SETUP_RETRY_DELAY_MS } from "../domain/notifications/delivery";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

/**
 * Envío de avisos por correo institucional, reintentos y aislamiento de fallos
 * del proveedor (TI2-159), con `convex-test` y datos ficticios.
 */

const ISSUER = "https://accounts.google.com";
const NOW = Date.UTC(2027, 0, 4, 15, 0, 0);
const SENSITIVE_TEXT = "Diagnóstico confidencial CERETI con Profesional Especialista";

function identityFor(subject: string) {
  return { subject, issuer: ISSUER, tokenIdentifier: `${ISSUER}|${subject}`, name: "Ficticio" };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function decodeRawMime(raw: string): string {
  const padded = raw
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(raw.length + ((4 - (raw.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const REQUEST_SUBMISSION = {
  needSummary: SENSITIVE_TEXT,
  expectedOutcome: "Acordar ajustes de comunicación con docentes",
  accessNeeds: [{ id: "written-communication", label: "Comunicación escrita" }],
  otherAccessNeed: SENSITIVE_TEXT,
  modalityPreference: "online" as const,
  generalAvailability: {
    preferredWeekdays: [1, 3],
    preferredTimeRange: { from: "09:00", to: "12:00" },
  },
  preferredAccessibleInformationChannel: "Correo con letra grande",
};

function stubGmailEnv(extra?: Record<string, string>) {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id-prueba");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret-prueba");
  vi.stubEnv("GMAIL_SENDER_ADDRESS", "remitente@alu.uct.cl");
  vi.stubEnv("GMAIL_SENDER_REFRESH_TOKEN", "refresh-token-prueba");
  vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", extra?.EMAIL_ALLOWED_RECIPIENTS ?? "");
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

async function deliveries(t: TestConvex<typeof schema>): Promise<Doc<"notificationDeliveries">[]> {
  return await t.run(async (ctx) => await ctx.db.query("notificationDeliveries").take(50));
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

test("TI2-159: registrar una solicitud encola y despacha un correo genérico sin datos sensibles", async () => {
  stubGmailEnv();
  const sentRawPayloads: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "access-ok" });
    }
    if (target.includes("gmail.googleapis.com")) {
      const parsed = JSON.parse(String(init?.body ?? "{}")) as { raw?: string };
      if (parsed.raw) sentRawPayloads.push(decodeRawMime(parsed.raw));
      return jsonResponse({ id: "gmail-1" });
    }
    throw new Error(`URL inesperada: ${target}`);
  });

  const t = convexTest(schema, modules);
  await seedStudent(t, "ti159-est-ok", "destino-prueba@alu.uct.cl");
  const student = t.withIdentity(identityFor("ti159-est-ok"));

  const created = await student.mutation(
    api.presentation.requests.createRequest,
    REQUEST_SUBMISSION,
  );
  expect(created._id).toBeTruthy();

  await t.finishAllScheduledFunctions(() => {
    vi.setSystemTime(NOW + 1_000);
  });

  expect(sentRawPayloads).toHaveLength(1);
  const mime = sentRawPayloads[0] ?? "";
  expect(mime).toContain("To: destino-prueba@alu.uct.cl\r\n");
  expect(mime).toContain("From: remitente@alu.uct.cl\r\n");
  expect(mime.toLowerCase()).not.toContain("cereti");
  expect(mime).not.toContain(SENSITIVE_TEXT);

  const rows = await deliveries(t);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    channel: "email",
    status: "sent",
    attempts: 1,
  });
  expect(rows[0]?.errorCode).toBeUndefined();
  expect(rows[0]?.nextAttemptAt).toBeUndefined();
  expect(rows[0]?.sentAt).toBeGreaterThan(0);

  // Un segundo despacho sobre la misma entrega no vuelve a enviar.
  const second = await t.action(internal.operations.notifications.dispatchEmailDelivery, {
    deliveryId: rows[0]!._id,
  });
  expect(second).toBe("skipped");
  expect(sentRawPayloads).toHaveLength(1);
});

test("TI2-159: una falla del proveedor no deshace el cambio que originó el aviso y permite reintentar sin duplicar", async () => {
  stubGmailEnv();
  let shouldFail = true;
  let sendCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com/token")) {
      return shouldFail
        ? jsonResponse({ error: "invalid_grant" }, 400)
        : jsonResponse({ access_token: "access-renovado" });
    }
    if (target.includes("gmail.googleapis.com")) {
      sendCalls += 1;
      return jsonResponse({ id: "gmail-reintento" });
    }
    throw new Error(`URL inesperada: ${target}`);
  });

  const t = convexTest(schema, modules);
  await seedStudent(t, "ti159-est-retry", "reintento@alu.uct.cl");
  const student = t.withIdentity(identityFor("ti159-est-retry"));

  const created = await student.mutation(
    api.presentation.requests.createRequest,
    REQUEST_SUBMISSION,
  );
  expect(created._id).toBeTruthy();

  // Primer intento: falla por token vencido (not_authorized).
  await t.finishAllScheduledFunctions(() => {
    vi.setSystemTime(NOW + 1_000);
  });

  // La solicitud persistió intacta pese a la falla del proveedor.
  const requests = await t.run(async (ctx) => await ctx.db.query("requests").take(10));
  expect(requests).toHaveLength(1);

  const afterFailure = await deliveries(t);
  expect(afterFailure).toHaveLength(1);
  expect(afterFailure[0]).toMatchObject({
    channel: "email",
    status: "failed",
    attempts: 1,
    errorCode: "not_authorized",
  });
  expect(afterFailure[0]?.nextAttemptAt).toBe(
    (afterFailure[0]?.lastAttemptAt ?? 0) + SENDER_SETUP_RETRY_DELAY_MS,
  );
  expect(sendCalls).toBe(0);

  // Antes de vencer la espera, el barrido no vuelve a programar la entrega.
  const beforeDue = await t.mutation(
    internal.operations.notifications.scheduleDueEmailDeliveries,
    {},
  );
  expect(beforeDue).toBe(0);

  // Se vuelve a autorizar la cuenta remitente y avanza el reloj hasta el reintento.
  shouldFail = false;
  vi.setSystemTime(NOW + SENDER_SETUP_RETRY_DELAY_MS + 5_000);
  const dueCount = await t.mutation(
    internal.operations.notifications.scheduleDueEmailDeliveries,
    {},
  );
  expect(dueCount).toBe(1);

  await t.finishAllScheduledFunctions(() => {
    vi.setSystemTime(NOW + SENDER_SETUP_RETRY_DELAY_MS + 6_000);
  });

  expect(sendCalls).toBe(1);
  const afterRetry = await deliveries(t);
  const events = await t.run(async (ctx) => await ctx.db.query("notificationEvents").take(10));
  expect(events).toHaveLength(1);
  expect(afterRetry).toHaveLength(1);
  expect(afterRetry[0]).toMatchObject({
    channel: "email",
    status: "sent",
    attempts: 2,
  });
  expect(afterRetry[0]?.errorCode).toBeUndefined();
  expect(afterRetry[0]?.nextAttemptAt).toBeUndefined();
});

test("TI2-159: la reserva impide que dos despachos concurrentes envíen la misma entrega dos veces", async () => {
  const t = convexTest(schema, modules);
  const studentId = await seedStudent(t, "ti159-est-claim", "claim@alu.uct.cl");
  const student = t.withIdentity(identityFor("ti159-est-claim"));
  const created = await student.mutation(
    api.presentation.requests.createRequest,
    REQUEST_SUBMISSION,
  );
  const rows = await deliveries(t);
  expect(rows).toHaveLength(1);
  const deliveryId = rows[0]!._id;

  const first = await t.mutation(internal.operations.notifications.claimEmailDelivery, {
    deliveryId,
    now: NOW,
  });
  const second = await t.mutation(internal.operations.notifications.claimEmailDelivery, {
    deliveryId,
    now: NOW + 1_000,
  });

  expect(first).toMatchObject({
    status: "claimed",
    requestId: created._id,
    recipientId: studentId,
  });
  expect(second).toEqual({ status: "skipped" });
});

test("TI2-159: una respuesta perdida tras invocar a Gmail marca delivery_uncertain y no reenvía un segundo correo", async () => {
  stubGmailEnv();
  let sendCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "access-ok" });
    }
    if (target.includes("gmail.googleapis.com")) {
      sendCalls += 1;
      throw new Error("respuesta perdida tras aceptar el correo");
    }
    throw new Error(`URL inesperada: ${target}`);
  });

  const t = convexTest(schema, modules);
  await seedStudent(t, "ti159-est-incierto", "incierto@alu.uct.cl");
  const student = t.withIdentity(identityFor("ti159-est-incierto"));

  await student.mutation(api.presentation.requests.createRequest, REQUEST_SUBMISSION);
  await t.finishAllScheduledFunctions(() => {
    vi.setSystemTime(NOW + 1_000);
  });

  expect(sendCalls).toBe(1);
  const rows = await deliveries(t);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    channel: "email",
    status: "failed",
    attempts: 1,
    errorCode: "delivery_uncertain",
  });
  expect(rows[0]?.nextAttemptAt).toBeUndefined();

  // Al avanzar el reloj, el barrido no vuelve a programar ni producir un segundo envío.
  vi.setSystemTime(NOW + 60 * 60_000);
  const dueCount = await t.mutation(
    internal.operations.notifications.scheduleDueEmailDeliveries,
    {},
  );
  expect(dueCount).toBe(0);
  expect(sendCalls).toBe(1);
});

test("TI2-159: cargar el dataset ficticio con remitente configurado conserva avisos internos sin enviar correos", async () => {
  stubGmailEnv();
  vi.stubEnv("TEST_SEEDS_ENABLED", "true");
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ id: "no-debe" }));

  const t = convexTest(schema, modules);
  await t.mutation(internal.operations.fictitiousData.load, {});
  await t.finishAllScheduledFunctions(() => {
    vi.setSystemTime(NOW + 1_000);
  });

  const events = await t.run(async (ctx) => await ctx.db.query("notificationEvents").take(50));
  expect(events.length).toBeGreaterThan(0);
  expect(await deliveries(t)).toHaveLength(0);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("TI2-159: seis intentos sin credenciales no agotan el presupuesto cuando Gmail devuelve 503", async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
  vi.stubEnv("GMAIL_SENDER_ADDRESS", "");
  vi.stubEnv("GMAIL_SENDER_REFRESH_TOKEN", "");
  vi.stubEnv("EMAIL_ALLOWED_RECIPIENTS", "");

  let currentTime = NOW;
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti159-est-budget", "budget@alu.uct.cl");
  const student = t.withIdentity(identityFor("ti159-est-budget"));

  await student.mutation(api.presentation.requests.createRequest, REQUEST_SUBMISSION);
  await t.finishAllScheduledFunctions(() => {
    currentTime += 1_000;
    vi.setSystemTime(currentTime);
  });

  // 5 reintentos adicionales sin credenciales (total: 6 intentos `not_configured`).
  for (let i = 0; i < 5; i += 1) {
    currentTime += SENDER_SETUP_RETRY_DELAY_MS + 1_000;
    vi.setSystemTime(currentTime);
    const due = await t.mutation(internal.operations.notifications.scheduleDueEmailDeliveries, {});
    expect(due).toBe(1);
    await t.finishAllScheduledFunctions(() => {
      currentTime += 1_000;
      vi.setSystemTime(currentTime);
    });
  }

  const afterUnconfigured = await deliveries(t);
  expect(afterUnconfigured[0]).toMatchObject({
    status: "failed",
    attempts: 6,
    providerFailureAttempts: 0,
    errorCode: "not_configured",
  });

  // Se configura el remitente y la primera llamada real a Gmail responde 503.
  stubGmailEnv();
  let return503 = true;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "access-ok" });
    }
    if (target.includes("gmail.googleapis.com")) {
      return return503 ? jsonResponse({}, 503) : jsonResponse({ id: "gmail-recuperado" });
    }
    throw new Error(`URL inesperada: ${target}`);
  });

  currentTime += SENDER_SETUP_RETRY_DELAY_MS + 1_000;
  vi.setSystemTime(currentTime);
  expect(await t.mutation(internal.operations.notifications.scheduleDueEmailDeliveries, {})).toBe(
    1,
  );
  await t.finishAllScheduledFunctions(() => {
    currentTime += 1_000;
    vi.setSystemTime(currentTime);
  });

  const after503 = await deliveries(t);
  expect(after503[0]).toMatchObject({
    status: "failed",
    attempts: 7,
    providerFailureAttempts: 1,
    errorCode: "provider_unavailable",
  });
  expect(after503[0]?.nextAttemptAt).toBe((after503[0]?.lastAttemptAt ?? 0) + 60_000);

  // Al recuperarse Gmail, el siguiente reintento envía correctamente.
  return503 = false;
  currentTime += 61_000;
  vi.setSystemTime(currentTime);
  expect(await t.mutation(internal.operations.notifications.scheduleDueEmailDeliveries, {})).toBe(
    1,
  );
  await t.finishAllScheduledFunctions(() => {
    currentTime += 1_000;
    vi.setSystemTime(currentTime);
  });

  const afterRecovery = await deliveries(t);
  expect(afterRecovery[0]).toMatchObject({
    status: "sent",
    attempts: 8,
  });
  expect(afterRecovery[0]?.errorCode).toBeUndefined();
  expect(afterRecovery[0]?.nextAttemptAt).toBeUndefined();
});

test("TI2-159: un corte entre la confirmación de Gmail y el registro de sent no habilita un segundo envío automático", async () => {
  stubGmailEnv();
  const t = convexTest(schema, modules);
  await seedStudent(t, "ti159-est-corte", "corte@alu.uct.cl");
  const student = t.withIdentity(identityFor("ti159-est-corte"));

  // Crea la solicitud y toma la fila de entrega antes de correr la acción.
  await student.mutation(api.presentation.requests.createRequest, REQUEST_SUBMISSION);
  const queued = await deliveries(t);
  expect(queued).toHaveLength(1);
  const deliveryId = queued[0]!._id;

  // Simula el inicio del despacho: la acción reserva la entrega, Gmail confirma
  // el envío (200 OK) y la acción se interrumpe antes de llamar a recordEmailDeliveryAttempt.
  const claim = await t.mutation(internal.operations.notifications.claimEmailDelivery, {
    deliveryId,
    now: NOW,
  });
  expect(claim.status).toBe("claimed");

  let gmailSendCount = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "access-ok" });
    }
    if (target.includes("gmail.googleapis.com")) {
      gmailSendCount += 1;
      return jsonResponse({ id: "gmail-confirmado-antes-del-corte" });
    }
    throw new Error(`URL inesperada: ${target}`);
  });

  // La entrega ya quedó fuera del barrido automático y marcada como delivery_uncertain.
  const afterCrash = await deliveries(t);
  expect(afterCrash[0]).toMatchObject({
    status: "failed",
    attempts: 1,
    errorCode: "delivery_uncertain",
  });
  expect(afterCrash[0]?.nextAttemptAt).toBeUndefined();

  // Ni el vencimiento de la reserva ni el cron posterior vuelven a despachar a Gmail.
  vi.setSystemTime(NOW + 24 * 60 * 60_000);
  const due = await t.mutation(internal.operations.notifications.scheduleDueEmailDeliveries, {});
  expect(due).toBe(0);

  const secondDispatch = await t.action(internal.operations.notifications.dispatchEmailDelivery, {
    deliveryId,
  });
  expect(secondDispatch).toBe("skipped");
  expect(gmailSendCount).toBe(0);
});
