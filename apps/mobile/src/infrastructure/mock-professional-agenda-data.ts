import type { ProfessionalAgendaDay } from "../application/professional-agenda-models";

/** Datos ficticios de la agenda mostrada en el mockup. */
export const fictionalProfessionalAgenda: ProfessionalAgendaDay = {
  id: "agenda-demo-2026-11-05",
  weekdayLabel: "Día de demostración",
  dateLabel: "Jueves, 5 de noviembre",
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
    {
      id: "appointment-4",
      startTime: "16:30",
      endTime: "17:30",
      studentName: "Camila Soto",
      title: "Coordinación de apoyos",
      location: "Sala D-105",
      modality: "inPerson",
      color: "teal",
      summary: "Definición de apoyos para las próximas actividades académicas.",
    },
  ],
};

const demoDate = Date.UTC(2026, 10, 5, 12);
const dateFormatter = new Intl.DateTimeFormat("es-CL", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export function createFictionalProfessionalAgenda(dayOffset: number): ProfessionalAgendaDay {
  const date = new Date(demoDate);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  const formatted = dateFormatter.format(date);
  const events =
    dayOffset === 0
      ? fictionalProfessionalAgenda.events
      : dayOffset === 1
        ? fictionalProfessionalAgenda.events.slice(1, 2)
        : [];
  return {
    id: `agenda-demo-${date.toISOString().slice(0, 10)}`,
    weekdayLabel: "Día de demostración",
    dateLabel: formatted.charAt(0).toUpperCase() + formatted.slice(1),
    events: events.map((event) => ({ ...event, id: `${event.id}-${dayOffset}` })),
  };
}
