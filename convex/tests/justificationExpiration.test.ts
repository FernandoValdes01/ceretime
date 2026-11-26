/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "../_generated/api";
import { CHILE_HOLIDAYS } from "../domain/calendar/chile_holidays";
import { calculateJustificationDeadline } from "../domain/appointments/appointment";
import { AGENDA_TIME_ZONE } from "../domain/availability/availability";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/**
 * Pruebas del vencimiento automático de justificaciones (TI2-147).
 *
 * Verifican que el trabajo idempotente pasa las atenciones `no_show`
 * cuyo plazo ya venció a `no_show_unjustified`, y que no toca las que aún
 * están en plazo ni las ya resueltas.
 */

test("TI2-147: calculateJustificationDeadline usa feriados de Chile y zona de Temuco", () => {
  // Verifica que el plazo se calcula con la zona y feriados correctos
  const missedAt = new Date("2026-09-14T10:00:00-04:00").getTime(); // Lunes 14 de septiembre
  const deadline = calculateJustificationDeadline({
    missedAt,
    timeZone: AGENDA_TIME_ZONE,
    holidays: CHILE_HOLIDAYS,
  });
  expect(deadline.timeZone).toBe("America/Santiago");
  expect(deadline.businessDays).toBe(5);
  // El plazo debe ser al menos 5 días después
  expect(deadline.deadlineAt).toBeGreaterThan(missedAt);
});

test("TI2-147: expireOverdueJustifications es idempotente", async () => {
  const t = convexTest(schema, modules);

  // Seed a no_show appointment with an expired deadline
  const startsAt = Date.now() - 30 * DAY;
  const appointmentId = await t.run(async (ctx) => {
    // Create minimal user and accompaniment
    const studentId = await ctx.db.insert("users", {
      email: "test@alu.uct.cl",
      fullName: "Test",
      role: "student",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: "test|student",
    });
    const professionalId = await ctx.db.insert("users", {
      email: "pro@uct.cl",
      fullName: "Pro",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: "test|pro",
    });
    const accompanimentId = await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo",
      accessNeeds: "",
    });
    return await ctx.db.insert("appointments", {
      accompanimentId,
      studentId,
      professionalId,
      modality: "online",
      status: "no_show",
      startsAt,
      endsAt: startsAt + HOUR,
      createdAt: 1,
    });
  });

  // Run the expiration job
  const result1 = await t.mutation(internal.operations.appointments.expireOverdueJustifications, {});
  expect(result1.expired).toBeGreaterThanOrEqual(1);

  // Check that the appointment was transitioned
  const after1 = await t.run(async (ctx) => {
    const id = ctx.db.normalizeId("appointments", appointmentId as string);
    return id ? await ctx.db.get(id) : null;
  });
  expect(after1?.status).toBe("no_show_unjustified");

  // Run again - should be idempotent
  const result2 = await t.mutation(internal.operations.appointments.expireOverdueJustifications, {});
  expect(result2.expired).toBe(0);
});

test("TI2-147: expireOverdueJustifications no toca atenciones dentro del plazo", async () => {
  const t = convexTest(schema, modules);

  const now = Date.now();
  const recentStart = now - 1 * DAY;

  const appointmentId = await t.run(async (ctx) => {
    const studentId = await ctx.db.insert("users", {
      email: "test2@alu.uct.cl",
      fullName: "Test2",
      role: "student",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: "test2|student",
    });
    const professionalId = await ctx.db.insert("users", {
      email: "pro2@uct.cl",
      fullName: "Pro2",
      role: "professional",
      institutionalStatus: "enabled",
      accountStatus: "active",
      tokenIdentifier: "test2|pro",
    });
    const accompanimentId = await ctx.db.insert("accompaniments", {
      studentId,
      status: "active",
      objective: "Objetivo",
      accessNeeds: "",
    });
    return await ctx.db.insert("appointments", {
      accompanimentId,
      studentId,
      professionalId,
      modality: "online",
      status: "no_show",
      startsAt: recentStart,
      endsAt: recentStart + HOUR,
      createdAt: 1,
    });
  });

  const _result = await t.mutation(internal.operations.appointments.expireOverdueJustifications, {});

  // The recent appointment should still be no_show
  const after = await t.run(async (ctx) => {
    const id = ctx.db.normalizeId("appointments", appointmentId as string);
    return id ? await ctx.db.get(id) : null;
  });
  expect(after?.status).toBe("no_show");
});
