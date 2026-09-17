import { describe, expect, expectTypeOf, test } from "vitest";
import type {
  Accompaniment,
  AccompanimentProjection,
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
