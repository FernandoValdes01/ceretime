import { describe, expect, expectTypeOf, test } from "vitest";
import {
  CALENDAR_LINK_ROLE_VALUES,
  CALENDAR_SYNC_ERROR_CODE_VALUES,
  CALENDAR_SYNC_STATUS_VALUES,
  calendarSyncStateOf,
  canManageCalendarLink,
  initialCalendarSyncState,
  isCalendarSyncErrorCode,
  isCalendarSyncStatus,
  type CalendarConnectionMetadata,
  type CalendarLinkRole,
  type CalendarSyncState,
} from "./calendar_link";
import {
  CALENDAR_LINK_ROLE_VALUES as BARREL_LINK_ROLES,
  CALENDAR_SYNC_STATUS_VALUES as BARREL_SYNC_STATUS,
  calendarSyncStateOf as barrelSyncStateOf,
  canManageCalendarLink as barrelCanManageCalendarLink,
  initialCalendarSyncState as barrelInitialSyncState,
  isCalendarSyncStatus as barrelIsSyncStatus,
  type CalendarConnectionMetadata as BarrelConnectionMetadata,
  type CalendarLinkRole as BarrelCalendarLinkRole,
  type CalendarSyncState as BarrelSyncState,
} from "../index";

/**
 * Pruebas del contrato puro del vínculo con Calendar (TI2-145).
 *
 * No tocan Convex ni Google: fijan los metadatos locales que la persistencia
 * guarda y comprueban que una atención anterior a la ampliación se lea como
 * sin estado, en vez de inventar un pendiente que nadie pidió. El estado
 * «conectado» no se prueba acá porque tiene una sola fuente fuera de este
 * contrato: los alcances OAuth de Better Auth.
 */

describe("Vínculo con Calendar y estado de sincronización (TI2-145)", () => {
  test("los estados salen del barrel sin duplicar la fuente", () => {
    expect(BARREL_SYNC_STATUS).toBe(CALENDAR_SYNC_STATUS_VALUES);
    expect(barrelSyncStateOf).toBe(calendarSyncStateOf);
    expect(barrelInitialSyncState).toBe(initialCalendarSyncState);
    expect(barrelIsSyncStatus).toBe(isCalendarSyncStatus);
    expect(BARREL_LINK_ROLES).toBe(CALENDAR_LINK_ROLE_VALUES);
    expect(barrelCanManageCalendarLink).toBe(canManageCalendarLink);
    expectTypeOf<BarrelSyncState>().toEqualTypeOf<CalendarSyncState>();
    expectTypeOf<BarrelConnectionMetadata>().toEqualTypeOf<CalendarConnectionMetadata>();
    expectTypeOf<BarrelCalendarLinkRole>().toEqualTypeOf<CalendarLinkRole>();
  });

  test("solo Estudiante y Profesional vinculan y desconectan (RF-27)", () => {
    expect([...CALENDAR_LINK_ROLE_VALUES]).toEqual(["student", "professional"]);
    expect(canManageCalendarLink("student")).toBe(true);
    expect(canManageCalendarLink("professional")).toBe(true);
    expect(canManageCalendarLink("intern")).toBe(false);
    expect(canManageCalendarLink("admin")).toBe(false);
    expect(canManageCalendarLink("")).toBe(false);
  });

  test("los metadatos del vínculo no incluyen estado ni credenciales", () => {
    expectTypeOf<keyof CalendarConnectionMetadata>().toEqualTypeOf<"linkedAt" | "revokedAt">();
    expect({ linkedAt: 1000 } satisfies CalendarConnectionMetadata).toEqual({ linkedAt: 1000 });
  });

  test("la sincronización distingue pendiente, sincronizado, error y sin vínculo", () => {
    expect([...CALENDAR_SYNC_STATUS_VALUES]).toEqual(["pending", "synced", "error", "not_linked"]);
    expect(isCalendarSyncStatus("pending")).toBe(true);
    expect(isCalendarSyncStatus("synced")).toBe(true);
    expect(isCalendarSyncStatus("error")).toBe(true);
    expect(isCalendarSyncStatus("not_linked")).toBe(true);
    expect(isCalendarSyncStatus("connected")).toBe(false);
    expect([...CALENDAR_SYNC_ERROR_CODE_VALUES]).toEqual(["not_connected", "unavailable"]);
    expect(isCalendarSyncErrorCode("not_connected")).toBe(true);
    expect(isCalendarSyncErrorCode("unavailable")).toBe(true);
    expect(isCalendarSyncErrorCode("quota_exceeded")).toBe(false);
  });

  test("una atención nueva empieza pendiente y sin intentos", () => {
    expect(initialCalendarSyncState()).toEqual({ status: "pending", attempts: 0 });
  });

  test("una fila anterior a TI2-145 no se lee como pendiente", () => {
    expect(calendarSyncStateOf({})).toBeNull();
    expect(
      calendarSyncStateOf({
        calendarSyncStatus: "error",
        calendarSyncAttempts: 2,
        calendarSyncLastAttemptAt: 4000,
        calendarSyncErrorCode: "not_connected",
      }),
    ).toEqual({
      status: "error",
      attempts: 2,
      lastAttemptAt: 4000,
      errorCode: "not_connected",
    });
    expect(calendarSyncStateOf({ calendarSyncStatus: "synced" })).toEqual({
      status: "synced",
      attempts: 0,
    });
  });
});
