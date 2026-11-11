import { describe, expect, test } from "vitest";
import { CALENDAR_EVENTS_SCOPE } from "../../../../../convex/domain/index.ts";
import { getCalendarLinkRequest, toCalendarCallbackStatus } from "./calendar-link.ts";

/**
 * Pruebas del consentimiento separado de Calendar (TI2-122).
 *
 * Comprueban que el flujo pida solo `calendar.events`, conserve la ruta de
 * retorno y use marcadores acotados; no validan el redirect OAuth, que vive en
 * el Site URL de Convex.
 */

describe("getCalendarLinkRequest", () => {
  test("pide solo el alcance de creación de eventos", () => {
    const request = getCalendarLinkRequest("/estudiante/acompanamientos/acc-1");
    expect(request.provider).toBe("google");
    expect(request.scopes).toEqual([CALENDAR_EVENTS_SCOPE]);
    expect(request.scopes).not.toContain("https://www.googleapis.com/auth/calendar.readonly");
  });

  test("vuelve a la misma ruta con un marcador de éxito o error", () => {
    const request = getCalendarLinkRequest("/estudiante/acompanamientos/acc-1");
    expect(request.callbackURL).toBe("/estudiante/acompanamientos/acc-1?calendar=connected");
    expect(request.errorCallbackURL).toBe("/estudiante/acompanamientos/acc-1?calendar=error");
  });

  test("respeta una ruta que ya trae query", () => {
    const request = getCalendarLinkRequest("/estudiante?tab=acompanamientos");
    expect(request.callbackURL).toBe("/estudiante?tab=acompanamientos&calendar=connected");
    expect(request.errorCallbackURL).toBe("/estudiante?tab=acompanamientos&calendar=error");
  });

  test("reemplaza un marcador anterior en vez de duplicarlo", () => {
    const request = getCalendarLinkRequest("/estudiante/acompanamientos/acc-1?calendar=error");
    expect(request.callbackURL).toBe("/estudiante/acompanamientos/acc-1?calendar=connected");
    expect(request.errorCallbackURL).toBe("/estudiante/acompanamientos/acc-1?calendar=error");
  });
});

describe("toCalendarCallbackStatus", () => {
  test("acepta solo los marcadores del contrato", () => {
    expect(toCalendarCallbackStatus("connected")).toBe("connected");
    expect(toCalendarCallbackStatus("error")).toBe("error");
    expect(toCalendarCallbackStatus(undefined)).toBeUndefined();
    expect(toCalendarCallbackStatus("otro")).toBeUndefined();
    expect(toCalendarCallbackStatus(1)).toBeUndefined();
  });
});
