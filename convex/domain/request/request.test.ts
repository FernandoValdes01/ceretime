import { describe, expect, expectTypeOf, test } from "vitest";
import { REQUEST_STATE_LABELS } from "./state";
import type { AccompanimentRequestContent } from "./request";

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

describe("REQUEST_STATE_LABELS (TI2-8)", () => {
  test("traduce todos los estados al español para Web y Mobile", () => {
    expect(REQUEST_STATE_LABELS.received).toBe("Recibida");
    expect(REQUEST_STATE_LABELS.underReview).toBe("En revisión");
    expect(REQUEST_STATE_LABELS.awaitingInformationOrAcceptance).toBe(
      "Esperando información o aceptación",
    );
    expect(REQUEST_STATE_LABELS.accepted).toBe("Aceptada");
    expect(REQUEST_STATE_LABELS.referred).toBe("Derivada");
    expect(REQUEST_STATE_LABELS.closedWithoutAccompaniment).toBe("Cerrada sin acompañamiento");
    expect(REQUEST_STATE_LABELS.cancelled).toBe("Cancelada");
  });
});
