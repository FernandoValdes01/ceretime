import { describe, expect, expectTypeOf, test } from "vitest";
import { toAccompanimentProjection } from "./accompaniment";
import type {
  Accompaniment,
  AccompanimentProjection,
  AccompanimentRow,
  MinimizedAccompaniment,
} from "./accompaniment";

describe("Vistas de acompañamiento (TI2-8)", () => {
  test("la vista completa lleva studentId y accessNeeds", () => {
    expectTypeOf<Accompaniment>().toMatchTypeOf<{
      _id: string;
      studentId: string;
      status: string;
      objective: string;
      accessNeeds: string;
      view: "full";
    }>();
  });

  test("la vista minimizada no es la completa: sin studentId ni accessNeeds", () => {
    expectTypeOf<MinimizedAccompaniment>().toMatchTypeOf<{
      _id: string;
      status: string;
      objective: string;
      view: "minimized";
    }>();
    expectTypeOf<MinimizedAccompaniment>().not.toEqualTypeOf<Accompaniment>();
  });

  test("ambas vistas se consumen como una sola proyección", () => {
    expectTypeOf<Accompaniment>().toMatchTypeOf<AccompanimentProjection>();
    expectTypeOf<MinimizedAccompaniment>().toMatchTypeOf<AccompanimentProjection>();
  });

  test("la vista minimizada no expone studentId ni accessNeeds", () => {
    const minimized: MinimizedAccompaniment = {
      _id: "a",
      status: "active",
      objective: "O",
      view: "minimized",
    };
    expect("studentId" in minimized).toBe(false);
    expect("accessNeeds" in minimized).toBe(false);
  });
});

describe("toAccompanimentProjection (TI2-8)", () => {
  const row: AccompanimentRow = {
    _id: "accompaniment-id",
    studentId: "student-id",
    status: "active",
    objective: "Objetivo ficticio",
    accessNeeds: "Acceso ficticio",
  };

  test("la vista completa conserva todos los campos de la fila", () => {
    expect(toAccompanimentProjection(row, "full")).toEqual({
      _id: "accompaniment-id",
      studentId: "student-id",
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Acceso ficticio",
      view: "full",
    });
  });

  test("la vista minimizada recorta studentId y accessNeeds aunque la fila los traiga", () => {
    const projected = toAccompanimentProjection(row, "minimized");
    expect(projected).toEqual({
      _id: "accompaniment-id",
      status: "active",
      objective: "Objetivo ficticio",
      view: "minimized",
    });
    expect("studentId" in projected).toBe(false);
    expect("accessNeeds" in projected).toBe(false);
  });
});
