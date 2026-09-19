import type { ProfessionalAgendaDay } from "../application/professional-agenda-models";

/** Datos ficticios de la agenda mostrada en el mockup. */
export const fictionalProfessionalAgenda: ProfessionalAgendaDay = {
  id: "agenda-demo-2024-10-24",
  weekdayLabel: "Hoy",
  dateLabel: "Jueves, 24 de Octubre",
  events: [
    {
      id: "appointment-martin-gomez",
      startTime: "09:00",
      endTime: "10:00",
      studentName: "Martín Gómez",
      title: "Seguimiento",
      location: "Sala C-204",
      modality: "inPerson",
      color: "teal",
      summary: "Revisión del avance del acompañamiento y próximos acuerdos.",
    },
    {
      id: "appointment-valentina-rojas",
      startTime: "11:30",
      endTime: "12:30",
      studentName: "Valentina Rojas",
      title: "Tutoría Académica",
      location: "Online (Meet)",
      modality: "online",
      color: "ochre",
      summary: "Espacio de apoyo para organizar sus actividades académicas.",
    },
    {
      id: "appointment-tomas-herrera",
      startTime: "15:00",
      endTime: "16:00",
      studentName: "Tomás Herrera",
      title: "Apoyo y seguimiento",
      location: "Sala C-204",
      modality: "inPerson",
      color: "green",
      summary: "Revisión de acuerdos y preparación del siguiente encuentro.",
    },
  ],
};
