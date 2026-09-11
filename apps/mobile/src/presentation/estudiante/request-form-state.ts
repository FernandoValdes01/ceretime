// Estado editable de presentación, no contrato de creación ni entidad del backend.
// Los campos corresponden a la especificación y las proyecciones provisionales TI4-5.
import type { AccessNeed } from "../../application/student-area-models";

export interface RequestFormValues {
  needSummary: string;
  expectedOutcome: string;
  accessNeeds: AccessNeed[];
  otherAccessNeed: string;
  modalityPreference: "" | "inPerson" | "online";
  preferredWeekdays: number[];
  availableFrom: string;
  availableTo: string;
  preferredAccessibleInformationChannel: string;
}

export const initialRequestValues: RequestFormValues = {
  needSummary: "",
  expectedOutcome: "",
  accessNeeds: [],
  otherAccessNeed: "",
  modalityPreference: "",
  preferredWeekdays: [],
  availableFrom: "",
  availableTo: "",
  preferredAccessibleInformationChannel: "",
};

export type RequestFormErrors = Partial<Record<keyof RequestFormValues, string>>;

export function validateRequestForm(values: RequestFormValues): RequestFormErrors {
  const errors: RequestFormErrors = {};
  if (!values.needSummary.trim()) errors.needSummary = "Describe la necesidad que quieres abordar.";
  if (!values.expectedOutcome.trim())
    errors.expectedOutcome = "Indica qué esperas del acompañamiento.";
  if (!values.modalityPreference) errors.modalityPreference = "Selecciona una modalidad.";
  if (!values.preferredWeekdays.length) errors.preferredWeekdays = "Selecciona al menos un día.";
  if (!values.preferredAccessibleInformationChannel.trim()) {
    errors.preferredAccessibleInformationChannel = "Indica cómo prefieres recibir información.";
  }
  // La franja horaria es opcional; si se usa, ambos extremos deben ser legibles.
  if (values.availableFrom.trim() || values.availableTo.trim()) {
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timePattern.test(values.availableFrom.trim()))
      errors.availableFrom = "Escribe la hora inicial en formato HH:MM, por ejemplo 09:00.";
    if (!timePattern.test(values.availableTo.trim()))
      errors.availableTo = "Escribe la hora final en formato HH:MM, por ejemplo 13:00.";
    if (
      !errors.availableFrom &&
      !errors.availableTo &&
      values.availableFrom.trim() >= values.availableTo.trim()
    ) {
      errors.availableTo = "La hora final debe ser posterior a la inicial.";
    }
  }
  return errors;
}
