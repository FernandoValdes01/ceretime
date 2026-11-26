import type { RequestDraftField, RequestFormVoice } from "./student-request-draft.ts";

/**
 * Textos, identificadores y foco del formulario de contenido de una solicitud
 * (TI2-158). Viven fuera de `request-content-fields.tsx` para que ese archivo
 * solo exporte componentes; los usan el formulario del Estudiante y el
 * registro por canal oficial del Profesional.
 */

/** Contenedor de cada sección del formulario. */
export const SECTION_CLASS =
  "flex flex-col gap-5 rounded-lg border border-border-low bg-surface-container-lowest p-6";

type RequestContentCopy = {
  readonly needTitle: string;
  readonly needSummaryHint: string;
  readonly expectedOutcomeLabel: string;
  readonly expectedOutcomeHint: string;
  readonly accessNeedsHint: string;
  readonly otherAccessNeedHint: string;
  readonly weekdaysHint: string;
  readonly timeHint: string;
};

export const REQUEST_CONTENT_COPY: Record<RequestFormVoice, RequestContentCopy> = {
  student: {
    needTitle: "Tu necesidad",
    needSummaryHint: "Cuéntalo con tus palabras. No es necesario indicar un diagnóstico.",
    expectedOutcomeLabel: "Qué esperas de CERETI",
    expectedOutcomeHint: "Por ejemplo: acordar ajustes con tus docentes o recibir orientación.",
    accessNeedsHint:
      "Puedes elegir varias. Si la tuya no aparece, escribe cuál es en «Otra necesidad de acceso».",
    otherAccessNeedHint: "Describe cualquier otra condición o apoyo que necesites para participar.",
    weekdaysHint: "Elige los días en que podrías asistir. No es un compromiso de horario.",
    timeHint: "Si tienes un rango de horas preferido, indica el inicio y el término.",
  },
  staff: {
    needTitle: "Necesidad del estudiante",
    needSummaryHint: "Usa lo que contó el estudiante. No registres diagnósticos.",
    expectedOutcomeLabel: "Qué espera el estudiante de CERETI",
    expectedOutcomeHint: "Por ejemplo: acordar ajustes con sus docentes o recibir orientación.",
    accessNeedsHint:
      "Puedes elegir varias. Si la del estudiante no aparece, escribe cuál es en «Otra necesidad de acceso».",
    otherAccessNeedHint:
      "Describe cualquier otra condición o apoyo que el estudiante necesite para participar.",
    weekdaysHint:
      "Elige los días en que el estudiante podría asistir. No es un compromiso de horario.",
    timeHint: "Si el estudiante tiene un rango de horas preferido, indica el inicio y el término.",
  },
};

/** Nombre de cada campo en el resumen de errores, en la voz del formulario. */
export function requestFieldLabel(voice: RequestFormVoice, field: RequestDraftField): string {
  switch (field) {
    case "needSummary":
      return "Barrera o necesidad";
    case "expectedOutcome":
      return REQUEST_CONTENT_COPY[voice].expectedOutcomeLabel;
    case "accessNeeds":
      return "Necesidades de acceso";
    case "modalityPreference":
      return "Modalidad preferida";
    case "preferredWeekdays":
      return "Días disponibles";
    case "availableTime":
      return "Horario disponible";
    case "preferredAccessibleInformationChannel":
      return "Medio para recibir información";
  }
}

/**
 * Elemento al que lleva cada error del resumen: el campo de texto o el
 * `fieldset` del grupo, cuyo primer control recibe el foco.
 */
const FIELD_FOCUS_TARGET: Record<RequestDraftField, string> = {
  needSummary: "request-need-summary",
  expectedOutcome: "request-expected-outcome",
  accessNeeds: requestFieldGroupId("accessNeeds"),
  modalityPreference: requestFieldGroupId("modalityPreference"),
  preferredWeekdays: requestFieldGroupId("preferredWeekdays"),
  availableTime: requestFieldGroupId("availableTime"),
  preferredAccessibleInformationChannel: "request-information-channel",
};

export function requestFieldFocusTarget(field: RequestDraftField): string {
  return FIELD_FOCUS_TARGET[field];
}

export function requestFieldGroupId(field: string): string {
  return `request-${field}-group`;
}

/** Lleva el foco al campo o al primer control del grupo. */
export function focusRequestField(targetId: string) {
  const target = document.getElementById(targetId);
  const control = target instanceof HTMLFieldSetElement ? target.querySelector("input") : target;
  control?.focus();
}

export function fieldErrorId(field: string): string {
  return `request-${field}-error`;
}
