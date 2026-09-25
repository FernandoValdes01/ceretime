import { describe, expect, expectTypeOf, test } from "vitest";
import { SPRINT_1_REQUEST_STATES, REQUEST_STATE_LABELS } from "./state";
import {
  ACCESS_NEEDS_MAX_LENGTH,
  isAccessNeedsWithinLimit,
  toAccompanimentRequest,
  toStoredRequestFields,
  type AccompanimentRequestContent,
} from "./request";
import {
  ACCESS_NEEDS_MAX_LENGTH as BARREL_MAX_LENGTH,
  type AccompanimentRequest as BarrelAccompanimentRequest,
} from "../index";

describe("AccompanimentRequestContent (TI2-8)", () => {
  test("describe la solicitud de Sprint 1 completa", () => {
    expectTypeOf<AccompanimentRequestContent>().toHaveProperty("needSummary");
    expectTypeOf<AccompanimentRequestContent>().toHaveProperty("expectedOutcome");
    expectTypeOf<AccompanimentRequestContent>().toHaveProperty("accessNeeds");
    expectTypeOf<AccompanimentRequestContent>().toHaveProperty("modalityPreference");
    expectTypeOf<AccompanimentRequestContent>().toHaveProperty("generalAvailability");
    expectTypeOf<AccompanimentRequestContent>().toHaveProperty(
      "preferredAccessibleInformationChannel",
    );
  });

  test("el espejo manual del payload de Mobile se tipa sin conversión manual", () => {
    expectTypeOf<MobileSubmitPayload>().toMatchTypeOf<AccompanimentRequestContent>();
  });
});

/**
 * Espejo manual de la forma de `SubmitStudentRequestCommand` de Mobile, no
 * el tipo real: los modelos de Mobile son provisionales y pertenecen a TI4,
 * así que esta suite no depende de ellos. Si Mobile cambia, este espejo no
 * lo detecta; TI4-12 lo reemplaza por la comprobación cableada.
 */
type MobileSubmitPayload = {
  readonly needSummary: string;
  readonly expectedOutcome: string;
  readonly accessNeeds: readonly { readonly id: string; readonly label: string }[];
  readonly otherAccessNeed?: string;
  readonly generalAvailability: {
    readonly preferredWeekdays: readonly number[];
    readonly preferredTimeRange?: { readonly from: string; readonly to: string };
  };
  readonly modalityPreference: "inPerson" | "online";
  readonly preferredAccessibleInformationChannel: string;
};

describe("toAccompanimentRequest (TI2-8)", () => {
  test("adapta una fila existente con cada estado de Sprint 1", () => {
    for (const status of SPRINT_1_REQUEST_STATES) {
      expect(
        toAccompanimentRequest({
          _id: "request-id",
          studentId: "student-id",
          status,
          accessNeeds: "Necesidad ficticia",
          createdAt: 1000,
        }),
      ).toEqual({
        _id: "request-id",
        studentId: "student-id",
        status,
        accessNeeds: "Necesidad ficticia",
        createdAt: 1000,
      });
    }
  });

  test("rechaza una fila con estado desconocido en vez de propagarla", () => {
    expect(() =>
      toAccompanimentRequest({
        _id: "request-id",
        studentId: "student-id",
        status: "under_review_typo",
        accessNeeds: "Necesidad ficticia",
        createdAt: 1000,
      }),
    ).toThrow("Estado de solicitud desconocido");
  });

  test("la entidad publica se importa desde el barrel", () => {
    const entity: BarrelAccompanimentRequest = {
      _id: "request-id",
      studentId: "student-id",
      status: "received",
      accessNeeds: "Necesidad ficticia",
      createdAt: 1000,
    };
    expect(entity.status).toBe("received");
  });
});

describe("ACCESS_NEEDS_MAX_LENGTH (TI2-23)", () => {
  test("el tope definitivo es 2000 y sale por el barrel", () => {
    expect(ACCESS_NEEDS_MAX_LENGTH).toBe(2000);
    expect(BARREL_MAX_LENGTH).toBe(2000);
    expect(isAccessNeedsWithinLimit("a".repeat(2000))).toBe(true);
    expect(isAccessNeedsWithinLimit("a".repeat(2001))).toBe(false);
  });
});

describe("toStoredRequestFields (TI2-23)", () => {
  const contenido: AccompanimentRequestContent = {
    needSummary: "Necesidad ficticia",
    expectedOutcome: "Resultado ficticio",
    accessNeeds: [
      { id: "1", label: "Intérprete" },
      { id: "2", label: "Sala silenciosa" },
    ],
    modalityPreference: "inPerson",
    generalAvailability: { preferredWeekdays: [1, 3] },
    preferredAccessibleInformationChannel: "correo",
    otherAccessNeed: "Silla cerca de la puerta",
  };

  test("une etiquetas y texto libre con salto de línea", () => {
    const resultado = toStoredRequestFields(contenido);
    expect(resultado).toEqual({
      status: "ok",
      data: { accessNeeds: "Intérprete\nSala silenciosa\nSilla cerca de la puerta" },
    });
  });

  test("omite el texto libre vacío sin dejar líneas de más", () => {
    const resultado = toStoredRequestFields({ ...contenido, otherAccessNeed: "   " });
    expect(resultado).toEqual({
      status: "ok",
      data: { accessNeeds: "Intérprete\nSala silenciosa" },
    });
  });

  test("rechaza el exceso con error estable en vez de truncar", () => {
    const resultado = toStoredRequestFields({
      ...contenido,
      accessNeeds: [{ id: "1", label: "a".repeat(2001) }],
      otherAccessNeed: undefined,
    });
    expect(resultado).toEqual({
      status: "error",
      error: {
        code: "access_needs_too_long",
        message: "El texto de necesidades de acceso supera el máximo permitido.",
      },
    });
  });
});

describe("REQUEST_STATE_LABELS (TI2-8)", () => {
  test("traduce todos los estados al español para Web y Mobile", () => {
    expect(REQUEST_STATE_LABELS.received).toBe("Recibida");
    expect(REQUEST_STATE_LABELS.under_review).toBe("En revisión");
    expect(REQUEST_STATE_LABELS.awaiting_information_or_acceptance).toBe(
      "Esperando información o aceptación",
    );
    expect(REQUEST_STATE_LABELS.accepted).toBe("Aceptada");
    expect(REQUEST_STATE_LABELS.referred).toBe("Derivada");
    expect(REQUEST_STATE_LABELS.closed_without_accompaniment).toBe("Cerrada sin acompañamiento");
    expect(REQUEST_STATE_LABELS.cancelled).toBe("Cancelada");
  });
});
