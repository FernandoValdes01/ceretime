import { describe, expect, test } from "vitest";
import {
  buildCalendarEvent,
  CALENDAR_EVENT_TITLE,
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_FILE_NAME,
  deriveCalendarEventKey,
  escapeIcsText,
  foldIcsLine,
  serializeCalendarEventIcs,
  toCalendarFile,
} from "./calendar_event";

/**
 * Pruebas del contrato puro del evento de calendario (TI2-122).
 *
 * No tocan Convex, Google ni el reloj: comprueban identidad determinista,
 * fechas UTC, duración, zona de la agenda, escape y plegado interoperable, y
 * que el evento no revele CERETI, el profesional, la modalidad, necesidades ni
 * notas. El título y el archivo son genéricos por diseño.
 */

const START_AT = Date.UTC(2026, 2, 10, 16, 0, 0);
const END_AT = Date.UTC(2026, 2, 10, 17, 0, 0);
const CREATED_AT = Date.UTC(2026, 2, 1, 12, 0, 0);

function event(overrides: Partial<Parameters<typeof buildCalendarEvent>[0]> = {}) {
  return buildCalendarEvent({
    appointmentId: "appointment-123",
    startAt: START_AT,
    endAt: END_AT,
    timeZone: "America/Santiago",
    generatedAt: CREATED_AT,
    ...overrides,
  });
}

function unfold(content: string): string {
  return content.replace(/\r\n[ \t]/g, "");
}

function physicalLines(content: string): string[] {
  return content.split("\r\n").filter((line) => line.length > 0);
}

function octets(value: string): number {
  return new TextEncoder().encode(value).length;
}

describe("deriveCalendarEventKey", () => {
  test("es determinista para la misma atención", () => {
    expect(deriveCalendarEventKey("appointment-123")).toBe(
      deriveCalendarEventKey("appointment-123"),
    );
  });

  test("cambia entre atenciones distintas", () => {
    expect(deriveCalendarEventKey("appointment-123")).not.toBe(
      deriveCalendarEventKey("appointment-124"),
    );
  });

  test("usa solo caracteres permitidos por Google Calendar", () => {
    expect(deriveCalendarEventKey("appointment-123")).toMatch(/^[a-v0-9]{26}$/);
  });

  test("rechaza un identificador vacío", () => {
    expect(() => deriveCalendarEventKey("")).toThrow("La atención requiere un identificador.");
  });
});

describe("buildCalendarEvent", () => {
  test("construye un evento genérico con UID estable", () => {
    const first = event();
    const second = event({ generatedAt: CREATED_AT + 60_000 });

    expect(first.uid).toBe(second.uid);
    expect(first.googleEventId).toBe(second.googleEventId);
    expect(first.uid.endsWith("@calendar.local")).toBe(true);
    expect(first.title).toBe(CALENDAR_EVENT_TITLE);
    expect(first.title).not.toMatch(/cereti|profesional|modalidad|necesidad|nota/i);
    expect(first.startAt).toBe(START_AT);
    expect(first.endAt).toBe(END_AT);
    expect(first.endAt - first.startAt).toBe(60 * 60_000);
    expect(first.timeZone).toBe("America/Santiago");
    expect(first.version).toBe("v1");
  });

  test("acepta atenciones de distinta duración", () => {
    const thirtyMinutes = event({ endAt: START_AT + 30 * 60_000 });
    expect(thirtyMinutes.endAt - thirtyMinutes.startAt).toBe(30 * 60_000);
  });

  test("rechaza instantes inválidos y un fin anterior al inicio", () => {
    expect(() => event({ startAt: Number.NaN })).toThrow(
      "El inicio de la atención debe ser un instante válido.",
    );
    expect(() => event({ endAt: Number.POSITIVE_INFINITY })).toThrow(
      "El fin de la atención debe ser un instante válido.",
    );
    expect(() => event({ endAt: START_AT })).toThrow(
      "El fin de la atención debe ser posterior a su inicio.",
    );
    expect(() => event({ endAt: START_AT - 1 })).toThrow(
      "El fin de la atención debe ser posterior a su inicio.",
    );
    expect(() => event({ appointmentId: "" })).toThrow("La atención requiere un identificador.");
    expect(() => event({ timeZone: "" })).toThrow("La atención requiere una zona horaria.");
  });
});

describe("serializeCalendarEventIcs", () => {
  test("produce un VCALENDAR v2.0 con fechas UTC y zona de agenda", () => {
    const content = serializeCalendarEventIcs(event());

    expect(content.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(content.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(content).toContain("VERSION:2.0");
    expect(content).toContain("X-WR-TIMEZONE:America/Santiago");
    expect(content).toContain("DTSTART:20260310T160000Z");
    expect(content).toContain("DTEND:20260310T170000Z");
    expect(content).toContain("DTSTAMP:20260301T120000Z");
    expect(content).toContain("SUMMARY:Atención programada");
    expect(content).toContain("STATUS:CONFIRMED");
    expect(content).not.toContain("VTIMEZONE");
  });

  test("conserva el UID entre descargas del mismo evento", () => {
    const first = serializeCalendarEventIcs(event());
    const second = serializeCalendarEventIcs(event({ generatedAt: CREATED_AT + 1 }));
    expect(unfold(first)).toContain(`UID:${event().uid}`);
    expect(unfold(second)).toContain(`UID:${event().uid}`);
  });

  test("no incluye datos sensibles ni enlaces privados", () => {
    const content = unfold(serializeCalendarEventIcs(event())).toLowerCase();
    for (const forbidden of [
      "cereti",
      "profesional",
      "estudiante",
      "necesidad",
      "nota",
      "description",
      "location",
      "url",
      "http",
      "meet.google",
    ]) {
      expect(content).not.toContain(forbidden);
    }
  });

  test("usa CRLF y no deja líneas físicas sobre 75 octetos", () => {
    const content = serializeCalendarEventIcs(event());
    expect(content).toContain("\r\n");
    for (const line of physicalLines(content)) {
      expect(octets(line)).toBeLessThanOrEqual(75);
    }
  });

  test("escapa y pliega textos largos sin partir caracteres UTF-8", () => {
    const longTitle = `Atención, ${"ñ".repeat(80)}; nota\\final`;
    const escaped = escapeIcsText(longTitle);
    expect(escaped).toContain("\\,");
    expect(escaped).toContain("\\;");
    expect(escaped).toContain("\\\\");
    expect(escaped).not.toContain("\n");

    const folded = foldIcsLine(`SUMMARY:${escaped}`);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(octets(line)).toBeLessThanOrEqual(75);
    }
    expect(unfold(folded)).toBe(`SUMMARY:${escaped}`);
  });
});

describe("toCalendarFile", () => {
  test("entrega un nombre genérico y el mismo contenido generado", () => {
    const draft = event();
    const file = toCalendarFile(draft);
    expect(file.fileName).toBe(CALENDAR_FILE_NAME);
    expect(file.fileName).toBe("atencion-programada.ics");
    expect(file.content).toBe(serializeCalendarEventIcs(draft));
  });
});

describe("CALENDAR_EVENTS_SCOPE", () => {
  test("limita el consentimiento a crear eventos", () => {
    expect(CALENDAR_EVENTS_SCOPE).toBe("https://www.googleapis.com/auth/calendar.events");
    expect(CALENDAR_EVENTS_SCOPE).not.toContain("calendar.readonly");
  });
});
