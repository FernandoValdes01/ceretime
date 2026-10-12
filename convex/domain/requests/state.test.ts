import { describe, expect, test } from "vitest";
import {
  CLOSURE_REQUEST_STATES,
  FUTURE_REQUEST_STATES,
  INITIAL_REQUEST_STATE,
  isPersistableRequestState,
  isSprint1RequestState,
  PERSISTABLE_REQUEST_STATES,
  REQUEST_STATE_LABELS,
  REQUEST_STATES,
  SPRINT_1_REQUEST_STATES,
} from "./state";

/**
 * Los grupos se fijan por sus literales y no por su largo: si alguien agrega
 * un estado, el fallo muestra cuál, en vez de una resta que no lo nombra.
 */
describe("SPRINT_1_REQUEST_STATES", () => {
  test("son los cuatro estados con operación en Sprint 1, en orden de flujo", () => {
    expect(SPRINT_1_REQUEST_STATES).toEqual([
      "received",
      "under_review",
      "awaiting_information_or_acceptance",
      "accepted",
    ]);
  });
});

describe("FUTURE_REQUEST_STATES", () => {
  test("solo la derivación sigue declarada sin operación", () => {
    expect(FUTURE_REQUEST_STATES).toEqual(["referred"]);
  });
});

describe("CLOSURE_REQUEST_STATES", () => {
  test("son los dos cierres sin acompañamiento que habilita TI2-85", () => {
    expect(CLOSURE_REQUEST_STATES).toEqual(["closed_without_accompaniment", "cancelled"]);
  });
});

describe("REQUEST_STATES", () => {
  test("ningún estado aparece dos veces, ni siquiera uno en cada grupo", () => {
    const repeated = REQUEST_STATES.filter(
      (state, index) => REQUEST_STATES.indexOf(state) !== index,
    );
    expect(repeated).toEqual([]);
  });

  test("conserva los siete literales en el orden anterior a TI2-85", () => {
    expect(REQUEST_STATES).toEqual([
      "received",
      "under_review",
      "awaiting_information_or_acceptance",
      "accepted",
      "referred",
      "closed_without_accompaniment",
      "cancelled",
    ]);
  });
});

describe("PERSISTABLE_REQUEST_STATES", () => {
  test("suma los cierres a Sprint 1 y deja fuera la derivación", () => {
    expect(PERSISTABLE_REQUEST_STATES).toEqual([
      ...SPRINT_1_REQUEST_STATES,
      ...CLOSURE_REQUEST_STATES,
    ]);
  });
});

describe("INITIAL_REQUEST_STATE", () => {
  test("toda solicitud nace recibida, un estado con operación en Sprint 1", () => {
    expect(INITIAL_REQUEST_STATE).toBe("received");
    expect(isSprint1RequestState(INITIAL_REQUEST_STATE)).toBe(true);
  });
});

describe("isSprint1RequestState", () => {
  test.each(SPRINT_1_REQUEST_STATES)(
    "reconoce %s como estado con operación en Sprint 1",
    (state) => {
      expect(isSprint1RequestState(state)).toBe(true);
    },
  );

  test.each([...FUTURE_REQUEST_STATES, ...CLOSURE_REQUEST_STATES])(
    "no reconoce %s, que el contrato público de Sprint 1 no entrega",
    (state) => {
      expect(isSprint1RequestState(state)).toBe(false);
    },
  );
});

describe("isPersistableRequestState", () => {
  test.each(PERSISTABLE_REQUEST_STATES)("acepta %s como valor de una fila", (state) => {
    expect(isPersistableRequestState(state)).toBe(true);
  });

  test.each(["referred", "cancelada", "", "CANCELLED", "closed"])(
    "rechaza %j, sin reglas o desconocido",
    (state) => {
      expect(isPersistableRequestState(state)).toBe(false);
    },
  );
});

describe("REQUEST_STATE_LABELS", () => {
  test.each(REQUEST_STATES)("%s tiene una etiqueta visible", (state) => {
    expect(REQUEST_STATE_LABELS[state]?.trim()).toBeTruthy();
  });

  test("no etiqueta estados que el modelo no declara", () => {
    expect(Object.keys(REQUEST_STATE_LABELS).sort()).toEqual([...REQUEST_STATES].sort());
  });
});
