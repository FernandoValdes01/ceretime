import { describe, expect, test } from "vitest";
import type { Sprint1RequestState } from "./state";
import { INITIAL_REQUEST_STATE, SPRINT_1_REQUEST_STATES } from "./state";
import { ACCEPTANCE_STATE, SPRINT_1_REQUEST_TRANSITIONS } from "./transitions";

/**
 * `transition_policy.test.ts` prueba qué responde la política ante cada fila.
 * Acá se prueba la forma de la tabla: son las propiedades que TI2-24 dará por
 * ciertas al leer el estado persistido para decidir si abre el acompañamiento.
 */
const pair = (row: { readonly from: string; readonly to: string }) => `${row.from} -> ${row.to}`;

/**
 * Estados alcanzables desde `start` siguiendo `next`. Recorrer un `Set` mientras
 * se le agregan elementos está definido en JavaScript: lo agregado entra en el
 * mismo recorrido, así que el grafo se cierra sin llevar una cola aparte.
 */
function closure(
  start: Sprint1RequestState,
  next: (state: Sprint1RequestState) => readonly Sprint1RequestState[],
): Set<Sprint1RequestState> {
  const seen = new Set<Sprint1RequestState>([start]);
  for (const state of seen) {
    for (const reached of next(state)) {
      seen.add(reached);
    }
  }
  return seen;
}

const successors = (state: Sprint1RequestState) =>
  SPRINT_1_REQUEST_TRANSITIONS.filter((row) => row.from === state).map((row) => row.to);

const predecessors = (state: Sprint1RequestState) =>
  SPRINT_1_REQUEST_TRANSITIONS.filter((row) => row.to === state).map((row) => row.from);

describe("SPRINT_1_REQUEST_TRANSITIONS como grafo", () => {
  test("no declara dos veces la misma transición", () => {
    const pairs = SPRINT_1_REQUEST_TRANSITIONS.map(pair);
    expect(pairs.filter((value, index) => pairs.indexOf(value) !== index)).toEqual([]);
  });

  test("ninguna fila deja la solicitud en el estado donde ya estaba", () => {
    const loops = SPRINT_1_REQUEST_TRANSITIONS.filter((row) => row.from === row.to);
    expect(loops.map(pair)).toEqual([]);
  });

  test("todo estado de Sprint 1 se alcanza desde el inicial", () => {
    const reached = closure(INITIAL_REQUEST_STATE, successors);
    expect(SPRINT_1_REQUEST_STATES.filter((state) => !reached.has(state))).toEqual([]);
  });

  test("desde todo estado de Sprint 1 se llega a la aceptación", () => {
    const leadToAcceptance = closure(ACCEPTANCE_STATE, predecessors);
    expect(SPRINT_1_REQUEST_STATES.filter((state) => !leadToAcceptance.has(state))).toEqual([]);
  });

  test("la aceptación no tiene salidas: ahí termina el flujo de Sprint 1", () => {
    const exits = SPRINT_1_REQUEST_TRANSITIONS.filter((row) => row.from === ACCEPTANCE_STATE);
    expect(exits.map(pair)).toEqual([]);
  });

  test("ninguna fila devuelve la solicitud al estado inicial", () => {
    const returns = SPRINT_1_REQUEST_TRANSITIONS.filter((row) => row.to === INITIAL_REQUEST_STATE);
    expect(returns.map(pair)).toEqual([]);
  });
});
