import { describe, expect, expectTypeOf, test } from "vitest";
import { SPRINT_1_REQUEST_STATES, REQUEST_STATE_LABELS } from "./state";
import {
  ACCESS_NEEDS_MAX_LENGTH,
  toAccessNeedsText,
  toAccompanimentRequest,
  type AccompanimentRequestContent,
} from "./request";
import type { AccompanimentRequest as BarrelAccompanimentRequest } from "../index";
import { ACCESS_NEEDS_MAX_LENGTH as BarrelAccessNeedsMaxLength } from "../index";

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

  test("un payload de Mobile se tipa sin conversión manual", () => {
    expectTypeOf<MobileSubmitPayload>().toMatchTypeOf<AccompanimentRequestContent>();
  });
});

/** Misma forma que `SubmitStudentRequestCommand` de Mobile. */
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

describe("toAccessNeedsText (TI2-26)", () => {
  test("recorta el texto con contenido válido", () => {
    expect(toAccessNeedsText("  Necesidad ficticia  ")).toBe("Necesidad ficticia");
  });

  test("rechaza el texto vacío o solo con espacios", () => {
    expect(toAccessNeedsText("")).toBeNull();
    expect(toAccessNeedsText("   ")).toBeNull();
  });

  test("el tope provisorio se comparte desde el barrel sin duplicarlo", () => {
    expect(ACCESS_NEEDS_MAX_LENGTH).toBe(2000);
    expect(BarrelAccessNeedsMaxLength).toBe(ACCESS_NEEDS_MAX_LENGTH);
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
