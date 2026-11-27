import { ACCESS_NEED_OPTIONS, toStoredAccessNeeds } from "../../../../../convex/domain/index.ts";

/**
 * Borrador de las necesidades de acceso del acompañamiento (TI2-166).
 *
 * El formulario usa el formato de TI2-135 (opciones y una necesidad libre),
 * pero `updateAccompanimentNeeds` (TI2-156) recibe y guarda un texto. Para
 * enviar, el texto se arma con `toStoredAccessNeeds` del dominio, la misma
 * regla que convierte la solicitud en el texto del acompañamiento: una línea
 * por opción elegida y, al final, la necesidad libre. Para partir de lo
 * vigente se hace el camino inverso: cada línea que coincide con la etiqueta
 * de una opción la marca, y las demás forman la necesidad libre.
 */
export interface AccessNeedsDraft {
  readonly accessNeedIds: string[];
  readonly otherAccessNeed: string;
}

/** Borrador a partir del texto vigente del acompañamiento. */
export function toAccessNeedsDraft(text: string): AccessNeedsDraft {
  const accessNeedIds: string[] = [];
  const other: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const option = ACCESS_NEED_OPTIONS.find((candidate) => candidate.label === trimmed);
    if (option !== undefined && !accessNeedIds.includes(option.id)) {
      accessNeedIds.push(option.id);
    } else if (option === undefined) {
      other.push(trimmed);
    }
  }
  return { accessNeedIds, otherAccessNeed: other.join("\n") };
}

export type AccessNeedsText =
  | { readonly status: "ok"; readonly text: string }
  | { readonly status: "error"; readonly message: string };

/**
 * Texto que se envía, en el orden de las opciones, o el error que se muestra
 * junto al campo. Los mensajes son los de la Web, no los del dominio.
 */
export function toAccessNeedsText(draft: AccessNeedsDraft): AccessNeedsText {
  const selected = ACCESS_NEED_OPTIONS.filter((option) => draft.accessNeedIds.includes(option.id));
  const stored = toStoredAccessNeeds(selected, draft.otherAccessNeed);
  if (stored.status === "ok") return { status: "ok", text: stored.data.accessNeeds };
  return {
    status: "error",
    message:
      stored.error.code === "access_needs_empty"
        ? "Elige al menos una necesidad o describe otra."
        : "El texto es demasiado largo. Resume tus necesidades e inténtalo de nuevo.",
  };
}
