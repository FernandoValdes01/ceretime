import type { InternAccompaniment } from "../domain/intern-accompaniment-models";

/**
 * Proyecciones ficticias con la forma minimizada de TI2: id, objetivo, estado
 * y vista. No agregamos estudiante ni necesidades de acceso a este dataset.
 */
export const demoInternAccompanimentsByIntern: Readonly<
  Record<string, readonly InternAccompaniment[]>
> = {
  "demo-intern-assigned-1": [
    {
      id: "demo-accompaniment-1",
      objective: "Organizar apoyos para participar en actividades académicas.",
      status: "active",
      view: "minimized",
    },
    {
      id: "demo-accompaniment-2",
      objective: "Retomar gradualmente la participación en laboratorios y trabajos grupales.",
      status: "paused",
      view: "minimized",
    },
    {
      id: "demo-accompaniment-3",
      objective: "Preparar apoyos accesibles para organizar su participación académica.",
      status: "active",
      view: "minimized",
    },
    {
      id: "demo-accompaniment-4",
      objective:
        "Coordinar apoyos para presentar evaluaciones y comunicar acuerdos de manera clara durante el semestre.",
      status: "closed",
      view: "minimized",
    },
    {
      id: "demo-accompaniment-5",
      objective: "Acordar un canal accesible para recibir información institucional.",
      status: "paused",
      view: "minimized",
    },
  ],
  "demo-intern-other-1": [
    {
      id: "demo-accompaniment-foreign-1",
      objective: "Acompañamiento de otra asignación profesional.",
      status: "active",
      view: "minimized",
    },
  ],
};
