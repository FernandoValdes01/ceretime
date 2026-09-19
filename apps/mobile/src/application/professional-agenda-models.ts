/**
 * Proyección provisional de la agenda profesional para el prototipo mobile.
 * No representa todavía el contrato canónico del backend.
 */
export type ProfessionalAgendaEventColor = "teal" | "ochre" | "green";

export interface ProfessionalAgendaEvent {
  readonly id: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly studentName: string;
  readonly title: string;
  readonly location: string;
  readonly modality: "inPerson" | "online";
  readonly color: ProfessionalAgendaEventColor;
  readonly summary: string;
}

export interface ProfessionalAgendaDay {
  readonly id: string;
  readonly weekdayLabel: string;
  readonly dateLabel: string;
  readonly events: readonly ProfessionalAgendaEvent[];
}
