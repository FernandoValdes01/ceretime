import { describe, expect, test } from "vitest";
import type { RequestState, Sprint1RequestState } from "./state";
import {
  CLOSURE_REQUEST_STATES,
  INITIAL_REQUEST_STATE,
  REQUEST_STATES,
  REFERRAL_REQUEST_STATES,
  SPRINT_1_REQUEST_STATES,
} from "./state";
import {
  ACCEPTANCE_STATE,
  CLOSURE_REQUEST_TRANSITIONS,
  isOpenRequestState,
  REFERRAL_REQUEST_TRANSITIONS,
  RELEASE_REQUEST_TRANSITIONS,
  REQUEST_TRANSITIONS,
  RESPONSE_REQUEST_TRANSITIONS,
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
function closure<State extends RequestState>(
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

describe("RESPONSE_REQUEST_TRANSITIONS (TI2-141)", () => {
  test("declara solo la vuelta de la espera a la revisión, con motivo", () => {
    expect(RESPONSE_REQUEST_TRANSITIONS).toEqual([
      { from: "awaiting_information_or_acceptance", to: "under_review", requiresReason: true },
    ]);
  });

  test("con la liberación son los únicos retrocesos: ninguna otra fila vuelve atrás", () => {
    const order = (state: RequestState) => REQUEST_STATES.indexOf(state);
    const backwards = REQUEST_TRANSITIONS.filter((row) => order(row.to) < order(row.from));
    expect(backwards.map(pair)).toEqual([
      ...RESPONSE_REQUEST_TRANSITIONS.map(pair),
      ...RELEASE_REQUEST_TRANSITIONS.map(pair),
    ]);
  });
});

describe("RELEASE_REQUEST_TRANSITIONS (TI4-84)", () => {
  test("declara la vuelta a recibida desde los estados con toma, sin motivo", () => {
    expect(RELEASE_REQUEST_TRANSITIONS).toEqual([
      { from: "under_review", to: "received", requiresReason: false },
      { from: "awaiting_information_or_acceptance", to: "received", requiresReason: false },
    ]);
  });

  test("sale de los mismos estados que la derivación: los que tienen toma activa", () => {
    expect(RELEASE_REQUEST_TRANSITIONS.map((row) => row.from)).toEqual(
      REFERRAL_REQUEST_TRANSITIONS.map((row) => row.from),
    );
  });
});

describe("REFERRAL_REQUEST_TRANSITIONS (TI2-143)", () => {
  test("declara exactamente la derivación de salida desde los estados con toma", () => {
    expect(REFERRAL_REQUEST_TRANSITIONS.map(pair)).toEqual([
      "under_review -> referred",
      "awaiting_information_or_acceptance -> referred",
    ]);
  });

  test("toda fila exige motivo: es la razón que lee el estudiante", () => {
    const withoutReason = REFERRAL_REQUEST_TRANSITIONS.filter((row) => !row.requiresReason);
    expect(withoutReason.map(pair)).toEqual([]);
  });

  test("no deriva una recibida, que nadie tomó, ni una aceptada, que ya abrió su acompañamiento", () => {
    const origins: readonly string[] = REFERRAL_REQUEST_TRANSITIONS.map((row) => row.from);
    expect(origins).not.toContain(INITIAL_REQUEST_STATE);
    expect(origins).not.toContain(ACCEPTANCE_STATE);
  });

  test("sale de los mismos estados que el cierre sin acompañamiento", () => {
    const closable = CLOSURE_REQUEST_TRANSITIONS.filter(
      (row) => row.to === "closed_without_accompaniment",
    ).map((row) => row.from);
    expect(REFERRAL_REQUEST_TRANSITIONS.map((row) => row.from).sort()).toEqual(closable.sort());
  });
});

const allSuccessors = (state: RequestState) =>
  REQUEST_TRANSITIONS.filter((row) => row.from === state).map((row) => row.to);

describe("REQUEST_TRANSITIONS como grafo", () => {
  test("es la suma exacta de las cinco tablas, sin repetir pares", () => {
    const pairs = REQUEST_TRANSITIONS.map(pair);
    expect(pairs).toEqual([
      ...SPRINT_1_REQUEST_TRANSITIONS.map(pair),
      ...RESPONSE_REQUEST_TRANSITIONS.map(pair),
      ...RELEASE_REQUEST_TRANSITIONS.map(pair),
      ...REFERRAL_REQUEST_TRANSITIONS.map(pair),
      ...CLOSURE_REQUEST_TRANSITIONS.map(pair),
    ]);
    expect(pairs.filter((value, index) => pairs.indexOf(value) !== index)).toEqual([]);
  });

  test("todo estado se alcanza desde el inicial", () => {
    const reached = closure<RequestState>(INITIAL_REQUEST_STATE, allSuccessors);
    expect(REQUEST_STATES.filter((state) => !reached.has(state))).toEqual([]);
  });

  test.each([ACCEPTANCE_STATE, ...REFERRAL_REQUEST_STATES, ...CLOSURE_REQUEST_STATES])(
    "%s es terminal: ninguna fila sale de ahí",
    (terminal) => {
      expect(REQUEST_TRANSITIONS.filter((row) => row.from === terminal).map(pair)).toEqual([]);
    },
  );

  test("ninguna fila deja la solicitud donde estaba y solo la liberación la devuelve al inicio", () => {
    expect(REQUEST_TRANSITIONS.filter((row) => row.from === row.to).map(pair)).toEqual([]);
    const toInitial = REQUEST_TRANSITIONS.filter((row) => row.to === INITIAL_REQUEST_STATE);
    expect(toInitial.map(pair)).toEqual(RELEASE_REQUEST_TRANSITIONS.map(pair));
  });
});

describe("isOpenRequestState (TI2-149)", () => {
  test("en curso mientras admite un paso; terminada al aceptar, derivar, cerrar o cancelar", () => {
    expect(
      ["received", "under_review", "awaiting_information_or_acceptance"].every(isOpenRequestState),
    ).toBe(true);
    expect(
      ["accepted", "referred", "closed_without_accompaniment", "cancelled", "desconocido"].some(
        isOpenRequestState,
      ),
    ).toBe(false);
  });
});
