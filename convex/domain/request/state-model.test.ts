/// <reference types="vite/client" />
import { describe, expect, test } from "vitest";
import stateModel from "./state-model.md?raw";
import {
  FUTURE_REQUEST_STATES,
  INITIAL_REQUEST_STATE,
  REQUEST_STATE_LABELS,
  REQUEST_STATES,
  SPRINT_1_REQUEST_STATES,
} from "./state";
import { ACCEPTANCE_STATE, SPRINT_1_REQUEST_TRANSITIONS } from "./transitions";

/**
 * `state-model.md` es la evidencia de cierre del modelo, pero nada lo ataba al
 * código: estas pruebas lo leen y fallan si el diagrama o las tablas dejan de
 * describir `state.ts` y `transitions.ts`. Se corta con `\r?\n` porque el
 * repositorio no fija finales de línea y un clon en Windows puede traer CRLF.
 */
const lines = stateModel.split(/\r?\n/);

function mermaidLines(): string[] {
  const start = lines.indexOf("```mermaid");
  const end = lines.indexOf("```", start + 1);
  if (start === -1 || end === -1) throw new Error("state-model.md perdió su bloque mermaid");
  return lines.slice(start + 1, end).map((line) => line.trim());
}

function sectionLines(title: string): string[] {
  const start = lines.indexOf(`## ${title}`);
  if (start === -1) throw new Error(`state-model.md perdió la sección «${title}»`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start, end === -1 ? undefined : end);
}

/** Celdas de la fila de tabla que empieza con el estado, sin los bordes. */
function tableRow(state: string): string[] | undefined {
  const row = lines.find((line) => line.startsWith(`| \`${state}\``));
  return row
    ?.split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

type Edge = { readonly from: string; readonly to: string; readonly label: string | undefined };

/** En Mermaid, `[*]` marca el inicio y el final del diagrama, no es un estado. */
const EDGE = /^(\S+)\s*-->\s*([^\s:]+)(?:\s*:\s*(.+))?$/;

const edges: Edge[] = mermaidLines().flatMap((line) => {
  const match = EDGE.exec(line);
  return match ? [{ from: match[1], to: match[2], label: match[3]?.trim() }] : [];
});
const transitions = edges.filter((edge) => edge.from !== "[*]" && edge.to !== "[*]");
const pair = (from: string, to: string) => `${from} -> ${to}`;

describe("diagrama de state-model.md", () => {
  test("dibuja exactamente las transiciones de SPRINT_1_REQUEST_TRANSITIONS", () => {
    const drawn = transitions.map((edge) => pair(edge.from, edge.to));
    const declared = SPRINT_1_REQUEST_TRANSITIONS.map((row) => pair(row.from, row.to));
    expect(drawn.sort()).toEqual(declared.sort());
  });

  test("marca «exige motivo» justo en las transiciones que exigen motivo", () => {
    const marked = transitions
      .filter((edge) => edge.label === "exige motivo")
      .map((edge) => pair(edge.from, edge.to));
    const required = SPRINT_1_REQUEST_TRANSITIONS.filter((row) => row.requiresReason).map((row) =>
      pair(row.from, row.to),
    );
    expect(marked.sort()).toEqual(required.sort());
  });

  test("entra por el estado inicial del modelo", () => {
    const entries = edges.filter((edge) => edge.from === "[*]").map((edge) => edge.to);
    expect(entries).toEqual([INITIAL_REQUEST_STATE]);
  });

  test("termina en la aceptación, donde se abre el acompañamiento", () => {
    const exits = edges.filter((edge) => edge.to === "[*]").map((edge) => edge.from);
    expect(exits).toEqual([ACCEPTANCE_STATE]);
  });

  test("resalta como Sprint 1 exactamente los estados con operación", () => {
    const highlighted = mermaidLines()
      .find((line) => line.startsWith("class ") && line.endsWith(" sprint1"))
      ?.split(/\s+/)[1]
      ?.split(",");
    expect(highlighted?.sort()).toEqual([...SPRINT_1_REQUEST_STATES].sort());
  });

  test("no dibuja estados de un Cycle futuro, como decide «Declarado, no habilitado»", () => {
    const words = new Set(mermaidLines().flatMap((line) => line.split(/[^a-z_]+/)));
    expect(FUTURE_REQUEST_STATES.filter((state) => words.has(state))).toEqual([]);
  });
});

describe("tablas de state-model.md", () => {
  test.each(REQUEST_STATES)("muestra para %s la etiqueta de REQUEST_STATE_LABELS", (state) => {
    expect(tableRow(state)?.[1]).toBe(REQUEST_STATE_LABELS[state]);
  });

  test.each(SPRINT_1_REQUEST_STATES)("lista %s bajo «Implementado en Sprint 1»", (state) => {
    const rows = sectionLines("Implementado en Sprint 1");
    expect(rows.some((line) => line.startsWith(`| \`${state}\``))).toBe(true);
  });

  test.each(FUTURE_REQUEST_STATES)("lista %s bajo «Declarado, no habilitado»", (state) => {
    const rows = sectionLines("Declarado, no habilitado");
    expect(rows.some((line) => line.startsWith(`| \`${state}\``))).toBe(true);
  });
});
