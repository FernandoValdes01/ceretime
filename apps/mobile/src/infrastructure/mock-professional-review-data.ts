import type { ProfessionalRequest } from "../application/professional-review-models";

/** Datos ficticios para demostrar la revisión de solicitudes del Profesional. */
export const fictionalProfessionalRequests: readonly ProfessionalRequest[] = [
  {
    id: "SOL-PRO-001",
    studentName: "Martín Gómez",
    status: "received",
    createdAt: "2026-09-16T13:00:00.000Z",
    updatedAt: "2026-09-16T13:00:00.000Z",
    needSummary: "Organizar apoyos para participar en las evaluaciones del semestre.",
    expectedOutcome: "Contar con coordinación accesible para cada evaluación.",
    accessNeeds: [{ id: "access-pro-1", label: "Material digital accesible" }],
    generalAvailability: {
      preferredWeekdays: [2, 4],
      preferredTimeRange: { from: "10:00", to: "13:00" },
    },
    modalityPreference: "online",
    preferredAccessibleInformationChannel: "Correo institucional con texto accesible",
    availableActions: ["startReview"],
  },
  {
    id: "SOL-PRO-002",
    studentName: "Valentina Rojas",
    status: "underReview",
    createdAt: "2026-09-15T15:30:00.000Z",
    updatedAt: "2026-09-17T09:15:00.000Z",
    needSummary: "Contar con apoyos para organizar las evaluaciones del semestre.",
    expectedOutcome: "Planificar cada evaluación con información clara y accesible.",
    accessNeeds: [
      { id: "access-pro-2", label: "Comunicación escrita" },
      { id: "access-pro-3", label: "Más tiempo para comunicarme" },
    ],
    generalAvailability: {
      preferredWeekdays: [1, 3, 5],
    },
    modalityPreference: "inPerson",
    preferredAccessibleInformationChannel: "Correo institucional con texto accesible",
    availableActions: ["requestInformation"],
  },
  {
    id: "SOL-PRO-003",
    studentName: "Tomás Herrera",
    status: "awaitingInformationOrAcceptance",
    createdAt: "2026-09-12T12:00:00.000Z",
    updatedAt: "2026-09-14T16:45:00.000Z",
    needSummary: "Explorar apoyos para continuar su participación académica.",
    expectedOutcome: "Definir el apoyo que mejor se ajusta a sus necesidades.",
    accessNeeds: [{ id: "access-pro-4", label: "Información anticipada" }],
    generalAvailability: {
      preferredWeekdays: [2],
    },
    modalityPreference: "online",
    preferredAccessibleInformationChannel: "Mensaje escrito dentro de la plataforma",
    availableActions: ["accept"],
  },
];
