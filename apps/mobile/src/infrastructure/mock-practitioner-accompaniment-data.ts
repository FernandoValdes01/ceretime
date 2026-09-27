import type { PractitionerAccompaniment } from "../application/practitioner-accompaniment-models";

/**
 * Proyecciones ficticias con la forma minimizada de TI2: id, objetivo, estado
 * y vista. No agregamos estudiante ni necesidades de acceso a este dataset.
 */
export const fictionalPractitionerAccompanimentsByPractitioner: Readonly<
  Record<string, readonly PractitionerAccompaniment[]>
> = {
  "mock-practitioner-assigned-1": [
    {
      id: "mock-accompaniment-1",
      objective: "Organizar apoyos para participar en actividades académicas.",
      status: "active",
      view: "minimized",
    },
    {
      id: "mock-accompaniment-2",
      objective: "Retomar gradualmente la participación en laboratorios y trabajos grupales.",
      status: "paused",
      view: "minimized",
    },
    {
      id: "mock-accompaniment-3",
      objective: "Preparar apoyos accesibles para organizar su participación académica.",
      status: "active",
      view: "minimized",
    },
    {
      id: "mock-accompaniment-4",
      objective:
        "Coordinar apoyos para presentar evaluaciones y comunicar acuerdos de manera clara durante el semestre.",
      status: "closed",
      view: "minimized",
    },
    {
      id: "mock-accompaniment-5",
      objective: "Acordar un canal accesible para recibir información institucional.",
      status: "paused",
      view: "minimized",
    },
  ],
  "mock-practitioner-other-1": [
    {
      id: "mock-accompaniment-foreign-1",
      objective: "Acompañamiento de otra asignación profesional.",
      status: "active",
      view: "minimized",
    },
  ],
};
