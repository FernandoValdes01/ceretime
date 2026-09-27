import type { ProfessionalAccompaniment } from "../application/professional-accompaniment-models";

/** Datos ficticios del conjunto autorizado que ve el Profesional actual. */
export const fictionalProfessionalAccompaniments: readonly ProfessionalAccompaniment[] = [
  {
    id: "ACO-PRO-001",
    studentName: "Camila Muñoz",
    objective: "Coordinar apoyos para participar en las evaluaciones del semestre.",
    status: "active",
  },
  {
    id: "ACO-PRO-002",
    studentName: "Diego Pérez",
    objective: "Preparar apoyos accesibles para organizar su participación académica.",
    status: "paused",
  },
];

/** Fixture de control: este acompañamiento pertenece a otro Profesional y no se expone. */
export const fictionalOtherProfessionalAccompaniments: readonly ProfessionalAccompaniment[] = [
  {
    id: "ACO-OTRO-PROFESIONAL-001",
    studentName: "Sofía Contreras",
    objective: "Este acompañamiento nunca debe aparecer en el listado actual.",
    status: "active",
  },
];

export interface MockProfessionalAccompanimentStore {
  readonly read: () => readonly ProfessionalAccompaniment[];
  readonly add: (accompaniment: ProfessionalAccompaniment) => void;
}

export function createMockProfessionalAccompanimentStore(
  initialAccompaniments: readonly ProfessionalAccompaniment[] = fictionalProfessionalAccompaniments,
): MockProfessionalAccompanimentStore {
  let accompaniments = initialAccompaniments.map((accompaniment) => ({ ...accompaniment }));

  return {
    read: () => accompaniments.map((accompaniment) => ({ ...accompaniment })),
    add: (accompaniment) => {
      if (accompaniments.some((candidate) => candidate.id === accompaniment.id)) return;
      accompaniments = [...accompaniments, { ...accompaniment }];
    },
  };
}
