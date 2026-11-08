/** Modelos de vista provisionales: el lector entrega colores, etiquetas y horarios civiles ya preparados. */
export type ProfessionalAgendaAppointmentColor = "teal" | "ochre" | "green";

export interface ProfessionalAgendaAppointmentViewModel {
  readonly id: string;
  /** Horas civiles HH:MM de CERETI, sin convertirlas en instantes ni usar la zona del dispositivo. */
  readonly startTime: string;
  readonly endTime: string;
  readonly studentName: string;
  readonly title: string;
  readonly location: string;
  readonly modality: "inPerson" | "online";
  readonly color: ProfessionalAgendaAppointmentColor;
  readonly summary: string;
}

export interface ProfessionalAgendaDayViewModel {
  readonly id: string;
  readonly weekdayLabel: string;
  readonly dateLabel: string;
  readonly appointments: readonly ProfessionalAgendaAppointmentViewModel[];
}
