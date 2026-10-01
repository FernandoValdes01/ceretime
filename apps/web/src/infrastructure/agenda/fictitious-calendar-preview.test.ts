import { describe, expect, test } from "vitest";
import {
  createFictitiousCalendarPreview,
  FICTITIOUS_CALENDAR_ERROR,
  GENERIC_CALENDAR_TITLE,
} from "./fictitious-calendar-preview";

describe("Vista previa ficticia de calendario en Web (TI2-87)", () => {
  test("el evento ficticio usa título genérico y .ics sin datos sensibles", async () => {
    const preview = createFictitiousCalendarPreview();
    const event = await preview.previewCalendarEvent("reserva-ficticia-1");
    expect(event.eventId).toBe("fictitious-reserva-ficticia-1");
    expect(event.title).toBe(GENERIC_CALENDAR_TITLE);
    expect(event.version).toBe("v1");
    expect(event.icsContent).toContain("Atención programada");
    expect(event.icsContent).not.toContain("CERETI");
  });

  test("el error temporal es genérico y sin motivo interno", async () => {
    const preview = createFictitiousCalendarPreview({ mode: "error" });
    await expect(preview.previewCalendarEvent("reserva-ficticia-1")).rejects.toThrow(
      FICTITIOUS_CALENDAR_ERROR,
    );
    expect(FICTITIOUS_CALENDAR_ERROR).not.toContain("CERETI");
  });
});
