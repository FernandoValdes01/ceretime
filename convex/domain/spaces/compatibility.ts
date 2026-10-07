/**
 * Compatibilidad de modalidad y espacio con necesidades de acceso (TI2-82).
 *
 * Dominio puro: no importa Convex, React ni Expo, para que Web y Mobile consuman la misma política sin levantar el backend. Decide si un cupo presencial o en línea satisface las necesidades vigentes, sin reducirlas para encontrar una hora: cada necesidad debe quedar cubierta o la opción es incompatible.
 *
 * Reutiliza `Space`, `AccessNeed` y `ModalityPreference` sin repetirlos. La vigencia del espacio (`isActive`), las condiciones que satisface y las necesidades vigentes del acompañamiento las resuelve la capa de aplicación desde el catálogo y el acompañamiento (que persiste las necesidades como texto); acá solo se comparan identificadores. La reserva y la búsqueda consumen esta misma política (TI2-98/TI2-97): una opción incompatible nunca se reserva y las necesidades no se rebajan.
 */

import type { AccessNeed, ModalityPreference } from "../requests/request";
import type { Space } from "./space";

/** Códigos de incompatibilidad de una opción. */
export const COMPATIBILITY_ISSUE_VALUES = ["space_inactive", "unmet_needs"] as const;

export type CompatibilityIssueCode = (typeof COMPATIBILITY_ISSUE_VALUES)[number];

/** Motivo de incompatibilidad: código estable más detalle y necesidades afectadas. */
export interface CompatibilityIssue {
  readonly code: CompatibilityIssueCode;
  readonly detail: string;
  readonly needIds: readonly string[];
}

/** Decisión pura de compatibilidad: compatible sin motivos o incompatible con todos los detectados. */
export type CompatibilityDecision =
  | { readonly compatible: true; readonly issues: readonly [] }
  | { readonly compatible: false; readonly issues: readonly CompatibilityIssue[] };

/** Espacio del catálogo con su vigencia y las necesidades que satisface, resueltas por aplicación. */
export interface CompatibilitySpace {
  readonly space: Space;
  readonly isActive: boolean;
  /** Necesidades que el espacio satisface, por identificador. */
  readonly satisfiedNeeds: readonly AccessNeed[];
}

/** Opción a evaluar: modalidad con su espacio o sus apoyos en línea. */
export interface CompatibilityOption {
  readonly modality: ModalityPreference;
  readonly space?: CompatibilitySpace;
  /** Apoyos que la plataforma en línea declara para cubrir necesidades en esa modalidad. */
  readonly onlineSupports?: readonly AccessNeed[];
}

function assertNeedList(needs: readonly AccessNeed[], where: string): void {
  for (const need of needs) {
    if (need.id.trim() === "") {
      throw new Error(`${where}: cada necesidad requiere un identificador no vacío.`);
    }
  }
}

function assertOptionShape(option: CompatibilityOption): void {
  if (option.modality !== "inPerson" && option.modality !== "online") {
    throw new Error("La modalidad debe ser presencial o en línea, sin híbrida.");
  }
  if (option.modality === "inPerson" && option.space === undefined) {
    throw new Error("La opción presencial requiere su espacio con vigencia y condiciones.");
  }
  if (option.modality === "online" && option.space !== undefined) {
    throw new Error("La opción en línea no lleva espacio: sus apoyos van en la plataforma.");
  }
}

/**
 * Decide si una opción satisface todas las necesidades vigentes.
 *
 * En presencial exige espacio vigente y cada necesidad cubierta por sus condiciones; en línea exige cada necesidad cubierta por los apoyos declarados. Junta todos los motivos en vez de detenerse en el primero. Una lista vacía de necesidades no restringe: toda opción es compatible.
 */
export function assessCompatibility(
  needs: readonly AccessNeed[],
  option: CompatibilityOption,
): CompatibilityDecision {
  assertOptionShape(option);
  assertNeedList(needs, "Necesidades");
  const issues: CompatibilityIssue[] = [];
  if (option.modality === "inPerson" && option.space !== undefined) {
    assertNeedList(option.space.satisfiedNeeds, "Condiciones");
    if (!option.space.isActive) {
      issues.push({
        code: "space_inactive",
        detail: "El espacio está retirado del catálogo.",
        needIds: [],
      });
    }
    const satisfied = new Set(option.space.satisfiedNeeds.map((need) => need.id));
    const missing = needs.filter((need) => !satisfied.has(need.id)).map((need) => need.id);
    if (missing.length > 0) {
      issues.push({
        code: "unmet_needs",
        detail: "El espacio no cubre todas las necesidades.",
        needIds: missing,
      });
    }
    return issues.length === 0 ? { compatible: true, issues: [] } : { compatible: false, issues };
  }
  assertNeedList(option.onlineSupports ?? [], "Apoyos");
  const supported = new Set((option.onlineSupports ?? []).map((need) => need.id));
  const missing = needs.filter((need) => !supported.has(need.id)).map((need) => need.id);
  if (missing.length > 0) {
    issues.push({
      code: "unmet_needs",
      detail: "La plataforma en línea no cubre todas las necesidades.",
      needIds: missing,
    });
  }
  return issues.length === 0 ? { compatible: true, issues: [] } : { compatible: false, issues };
}

/**
 * Filtra las opciones compatibles con las mismas reglas de la decisión individual.
 *
 * Puerta común para búsqueda (TI2-97) y reserva (TI2-98): ambas consumen esta política y ninguna rebaja necesidades. Una lista vacía devuelve vacía, sin error.
 */
export function selectCompatibleOptions(
  needs: readonly AccessNeed[],
  options: readonly CompatibilityOption[],
): CompatibilityOption[] {
  return options.filter((option) => assessCompatibility(needs, option).compatible);
}
