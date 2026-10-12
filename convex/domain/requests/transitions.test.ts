import { describe, expect, test } from "vitest";
import type { PersistableRequestState, Sprint1RequestState } from "./state";
import {
  CLOSURE_REQUEST_STATES,
  INITIAL_REQUEST_STATE,
  PERSISTABLE_REQUEST_STATES,
  SPRINT_1_REQUEST_STATES,
} from "./state";
import {
  ACCEPTANCE_STATE,
  CLOSURE_REQUEST_TRANSITIONS,
  REQUEST_TRANSITIONS,
  SPRINT_1_REQUEST_TRANSITIONS,
} from "./transitions";

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
function closure<State extends PersistableRequestState>(
  start: State,
  next: (state: State) => readonly State[],
): Set<State> {
  const seen = new Set<State>([start]);
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

/** Estados de Sprint 1 donde la solicitud sigue abierta: todos menos la aceptación. */
const OPEN_STATES = SPRINT_1_REQUEST_STATES.filter((state) => state !== ACCEPTANCE_STATE);

describe("CLOSURE_REQUEST_TRANSITIONS (TI2-85)", () => {
  test("declara exactamente los cierres acordados para TI2-85", () => {
    expect(CLOSURE_REQUEST_TRANSITIONS.map(pair)).toEqual([
      "received -> cancelled",
      "under_review -> cancelled",
      "awaiting_information_or_acceptance -> cancelled",
      "under_review -> closed_without_accompaniment",
      "awaiting_information_or_acceptance -> closed_without_accompaniment",
    ]);
  });

  test("toda fila exige motivo", () => {
    const withoutReason = CLOSURE_REQUEST_TRANSITIONS.filter((row) => !row.requiresReason);
    expect(withoutReason.map(pair)).toEqual([]);
  });

  test("solo llega a cierres y sale de estados abiertos de Sprint 1", () => {
    for (const row of CLOSURE_REQUEST_TRANSITIONS) {
      expect(CLOSURE_REQUEST_STATES).toContain(row.to);
      expect(OPEN_STATES).toContain(row.from);
    }
  });

  test("ningún cierre sale de la aceptación, que ya abrió su acompañamiento", () => {
    const fromAcceptance = CLOSURE_REQUEST_TRANSITIONS.filter(
      (row) => row.from === ACCEPTANCE_STATE,
    );
    expect(fromAcceptance.map(pair)).toEqual([]);
  });

  test("el Estudiante puede cancelar desde todo estado abierto", () => {
    const cancellable = CLOSURE_REQUEST_TRANSITIONS.filter((row) => row.to === "cancelled").map(
      (row) => row.from,
    );
    expect([...cancellable].sort()).toEqual([...OPEN_STATES].sort());
  });

  test("el Profesional no cierra una recibida: tomarla ya la pasa a revisión", () => {
    const closable = CLOSURE_REQUEST_TRANSITIONS.filter(
      (row) => row.to === "closed_without_accompaniment",
    ).map((row) => row.from);
    expect(closable).not.toContain(INITIAL_REQUEST_STATE);
  });
});

const allSuccessors = (state: PersistableRequestState) =>
  REQUEST_TRANSITIONS.filter((row) => row.from === state).map((row) => row.to);

describe("REQUEST_TRANSITIONS como grafo", () => {
  test("es la suma exacta de las dos tablas, sin repetir pares", () => {
    const pairs = REQUEST_TRANSITIONS.map(pair);
    expect(pairs).toEqual([
      ...SPRINT_1_REQUEST_TRANSITIONS.map(pair),
      ...CLOSURE_REQUEST_TRANSITIONS.map(pair),
    ]);
    expect(pairs.filter((value, index) => pairs.indexOf(value) !== index)).toEqual([]);
  });

  test("todo estado persistible se alcanza desde el inicial", () => {
    const reached = closure<PersistableRequestState>(INITIAL_REQUEST_STATE, allSuccessors);
    expect(PERSISTABLE_REQUEST_STATES.filter((state) => !reached.has(state))).toEqual([]);
  });

  test.each([ACCEPTANCE_STATE, ...CLOSURE_REQUEST_STATES])(
    "%s es terminal: ninguna fila sale de ahí",
    (terminal) => {
      expect(REQUEST_TRANSITIONS.filter((row) => row.from === terminal).map(pair)).toEqual([]);
    },
  );

  test("ninguna fila deja la solicitud donde estaba ni la devuelve al inicio", () => {
    const loops = REQUEST_TRANSITIONS.filter(
      (row) => row.from === row.to || row.to === INITIAL_REQUEST_STATE,
    );
    expect(loops.map(pair)).toEqual([]);
  });
});
