import { describe, expect, test } from "vitest";
import { createFictitiousCalendarPort, GENERIC_CALENDAR_TITLE, toGenericIcs } from "./calendar";

describe("Puerto externo ficticio de calendario (TI2-87)", () => {
  test("el título genérico no revela CERETI ni datos sensibles", () => {
    expect(GENERIC_CALENDAR_TITLE).toBe("Atención programada");
  });

  test("un evento válido devuelve comprobante ficticio con .ics genérico", async () => {
    const port = createFictitiousCalendarPort();
    const result = await port.createEvent({
      reservationId: "reserva-ficticia-1",
      title: GENERIC_CALENDAR_TITLE,
      startAt: 1000,
      endAt: 2000,
      version: "v1",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Se esperaba un evento válido");
    expect(result.data.eventId).toBe("fictitious-reserva-ficticia-1");
    expect(result.data.version).toBe("v1");
    expect(result.data.icsContent).toContain("Atención programada");
    expect(result.data.icsContent).not.toContain("CERETI");
    expect(
      toGenericIcs({
        reservationId: "reserva-ficticia-1",
        title: GENERIC_CALENDAR_TITLE,
        startAt: 1000,
        endAt: 2000,
        version: "v1",
      }),
    ).toContain("BEGIN:VEVENT");
  });

  test("el rango que no avanza se rechaza con código estable", async () => {
    const port = createFictitiousCalendarPort();
    const result = await port.createEvent({
      reservationId: "reserva-ficticia-2",
      title: GENERIC_CALENDAR_TITLE,
      startAt: 2000,
      endAt: 1000,
      version: "v1",
    });
    expect(result).toEqual({
      status: "error",
      error: {
        code: "reservation_invalid_time_range",
        message: "El rango de la reserva debe avanzar en el tiempo.",
      },
    });
  });
});
