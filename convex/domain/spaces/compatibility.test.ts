import { describe, expect, test } from "vitest";
import {
  COMPATIBILITY_ISSUE_VALUES,
  assessCompatibility,
  selectCompatibleOptions,
  type CompatibilityOption,
} from "./compatibility";
import {
  assessCompatibility as barrelAssessCompatibility,
  selectCompatibleOptions as barrelSelectCompatibleOptions,
  type CompatibilityOption as BarrelCompatibilityOption,
  type Space as BarrelSpace,
} from "../index";
import type { AccessNeed } from "../requests/request";
import type { Space } from "./space";

function need(id: string, label: string): AccessNeed {
  return { id, label };
}

function space(): Space {
  return {
    id: "espacio-ficticio-c204",
    campus: "Campus San Francisco (ficticio)",
    building: "Edificio C (ficticio)",
    floor: "Piso 2",
    room: "Sala C-204",
    accessConditions: "Acceso por rampa lateral (ficticio).",
    arrivalInstructions: "Siga a la derecha 20 metros (ficticio).",
    version: "v1",
  };
}

function inPersonOption(satisfied: readonly AccessNeed[], isActive = true): CompatibilityOption {
  return {
    modality: "inPerson",
    space: { space: space(), isActive, satisfiedNeeds: satisfied },
  };
}

function onlineOption(supports: readonly AccessNeed[]): CompatibilityOption {
  return { modality: "online", onlineSupports: supports };
}

const RAMP = "rampa-ficticia";
const INTERPRETER = "interprete-ficticio";
const CAPTIONS = "subtitulos-ficticios";

describe("assessCompatibility (TI2-82)", () => {
  test("el presencial compatible cubre cada necesidad sin recortar", () => {
    const decision = assessCompatibility(
      [need(RAMP, "Rampa (ficticio)"), need(INTERPRETER, "Intérprete (ficticio)")],
      inPersonOption([need(RAMP, "Rampa (ficticio)"), need(INTERPRETER, "Intérprete (ficticio)")]),
    );

    expect(decision).toEqual({ compatible: true, issues: [] });
  });

  test("el en línea compatible se apoya en la plataforma", () => {
    const decision = assessCompatibility(
      [need(CAPTIONS, "Subtítulos (ficticio)")],
      onlineOption([need(CAPTIONS, "Subtítulos (ficticio)")]),
    );

    expect(decision).toEqual({ compatible: true, issues: [] });
  });

  test("la condición faltante deja la necesidad sin cubrir", () => {
    const decision = assessCompatibility(
      [need(RAMP, "Rampa (ficticio)"), need(INTERPRETER, "Intérprete (ficticio)")],
      inPersonOption([need(RAMP, "Rampa (ficticio)")]),
    );

    expect(decision.compatible).toBe(false);
    expect(decision.issues).toHaveLength(1);
    expect(decision.issues[0]).toMatchObject({ code: "unmet_needs", needIds: [INTERPRETER] });
  });

  test("el espacio inactivo es incompatible aunque cubra todo", () => {
    const decision = assessCompatibility(
      [need(RAMP, "Rampa (ficticio)")],
      inPersonOption([need(RAMP, "Rampa (ficticio)")], false),
    );

    expect(decision.compatible).toBe(false);
    expect(decision.issues.some((issue) => issue.code === "space_inactive")).toBe(true);
  });

  test("la incompatibilidad junta la inactividad con lo no cubierto", () => {
    const decision = assessCompatibility(
      [need(RAMP, "Rampa (ficticio)"), need(INTERPRETER, "Intérprete (ficticio)")],
      inPersonOption([need(RAMP, "Rampa (ficticio)")], false),
    );

    expect(decision.compatible).toBe(false);
    expect(decision.issues.map((issue) => issue.code).sort()).toEqual([
      "space_inactive",
      "unmet_needs",
    ]);
  });

  test("el en línea sin apoyos no cubre necesidades", () => {
    const decision = assessCompatibility(
      [need(CAPTIONS, "Subtítulos (ficticio)")],
      onlineOption([]),
    );

    expect(decision.compatible).toBe(false);
    expect(decision.issues[0]).toMatchObject({ code: "unmet_needs", needIds: [CAPTIONS] });
  });

  test("sin necesidades toda opción es compatible", () => {
    expect(assessCompatibility([], inPersonOption([])).compatible).toBe(true);
    expect(assessCompatibility([], onlineOption([])).compatible).toBe(true);
  });

  test("rechaza modalidad híbrida, espacio cruzado e identificadores vacíos", () => {
    expect(() =>
      assessCompatibility([need(RAMP, "Rampa (ficticio)")], { modality: "hybrid" as never }),
    ).toThrow("sin híbrida");
    expect(() =>
      assessCompatibility([need(RAMP, "Rampa (ficticio)")], {
        modality: "online",
        space: { space: space(), isActive: true, satisfiedNeeds: [] },
      }),
    ).toThrow("no lleva espacio");
    expect(() =>
      assessCompatibility([need(RAMP, "Rampa (ficticio)")], { modality: "inPerson" }),
    ).toThrow("requiere su espacio");
    expect(() => assessCompatibility([need("  ", "Vacío (ficticio)")], onlineOption([]))).toThrow(
      "identificador no vacío",
    );
  });
});

describe("selectCompatibleOptions (TI2-82)", () => {
  test("filtra con la misma política sin rebajar necesidades", () => {
    const needs = [need(RAMP, "Rampa (ficticio)")];
    const compatible = inPersonOption([need(RAMP, "Rampa (ficticio)")]);
    const incompatible = inPersonOption([]);

    expect(selectCompatibleOptions(needs, [compatible, incompatible])).toEqual([compatible]);
  });

  test("la ausencia de opción devuelve vacía", () => {
    expect(selectCompatibleOptions([need(RAMP, "Rampa (ficticio)")], [])).toEqual([]);
  });
});

describe("superficie compartida por el barrel (TI2-82)", () => {
  test("la política se importa desde convex/domain con un Space completo", () => {
    const needs = [need(RAMP, "Rampa (ficticio)")];
    const fullSpace: BarrelSpace = space();
    const option: BarrelCompatibilityOption = {
      modality: "inPerson",
      space: { space: fullSpace, isActive: true, satisfiedNeeds: needs },
    };

    expect(barrelAssessCompatibility(needs, option)).toEqual(assessCompatibility(needs, option));
    expect(barrelAssessCompatibility(needs, option)).toEqual({
      compatible: true,
      issues: [],
    });
    expect(barrelSelectCompatibleOptions(needs, [option])).toEqual([option]);
  });
});

describe("códigos de incompatibilidad (TI2-82)", () => {
  test("los códigos son estables y conocidos", () => {
    expect([...COMPATIBILITY_ISSUE_VALUES]).toEqual(["space_inactive", "unmet_needs"]);
  });
});
