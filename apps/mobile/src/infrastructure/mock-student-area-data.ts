import type { StudentAreaSnapshot } from "../application/student-area-models";

/** Fictional, demo-only values owned by Infrastructure. */
export const fictionalStudentArea: StudentAreaSnapshot = {
  student: {
    id: "example-student-1",
    displayName: "Valentina Rojas",
    email: "valentina.rojas@alu.uct.cl",
    role: "student",
  },
  requests: [
    {
      id: "SOL-DEMO-001",
      status: "accepted",
      origin: "student",
      createdAt: "2026-08-10T15:00:00.000Z",
      updatedAt: "2026-08-12T15:00:00.000Z",
      needSummary: "Organizar apoyos para participar en actividades académicas.",
      expectedOutcome: "Contar con coordinación accesible durante el semestre.",
      accessNeeds: [{ id: "example-access-1", label: "Material digital accesible" }],
      generalAvailability: {
        preferredWeekdays: [2, 4],
        preferredTimeRange: { from: "10:00", to: "13:00" },
      },
      modalityPreference: "online",
      preferredAccessibleInformationChannel: "Correo institucional con texto accesible",
    },
    {
      id: "SOL-DEMO-002",
      status: "underReview",
      origin: "student",
      createdAt: "2026-09-01T11:30:00.000Z",
      updatedAt: "2026-09-02T09:15:00.000Z",
      needSummary: "Contar con apoyos para organizar las evaluaciones del semestre.",
      expectedOutcome: "Planificar cada evaluación con información accesible.",
      accessNeeds: [
        { id: "example-access-2", label: "Comunicación escrita" },
        { id: "example-access-3", label: "Más tiempo para comunicarme" },
      ],
      generalAvailability: {
        preferredWeekdays: [1, 3, 5],
      },
      modalityPreference: "inPerson",
      preferredAccessibleInformationChannel: "Correo institucional con texto accesible",
    },
    {
      id: "SOL-DEMO-003",
      status: "received",
      origin: "institutionalChannel",
      createdAt: "2026-09-05T08:45:00.000Z",
      updatedAt: "2026-09-05T08:45:00.000Z",
      needSummary:
        "Coordinar apoyos para comprender instrucciones extensas y participar en trabajos colaborativos.",
      expectedOutcome: "Contar con acuerdos claros antes de cada actividad grupal.",
      accessNeeds: [],
      generalAvailability: {
        preferredWeekdays: [1, 4],
        preferredTimeRange: { from: "08:30", to: "10:30" },
      },
      modalityPreference: "inPerson",
      preferredAccessibleInformationChannel: "Mensaje escrito dentro de la plataforma",
    },
    {
      id: "SOL-DEMO-004",
      status: "awaitingInformationOrAcceptance",
      origin: "student",
      createdAt: "2026-09-08T09:50:00.000Z",
      updatedAt: "2026-09-12T16:30:00.000Z",
      needSummary:
        "Revisar alternativas de apoyo para actividades de terreno y salidas académicas.",
      expectedOutcome: "Acordar una alternativa segura y accesible para el semestre.",
      accessNeeds: [{ id: "example-access-4", label: "Información anticipada" }],
      generalAvailability: {
        preferredWeekdays: [1, 2, 4],
      },
      modalityPreference: "online",
      preferredAccessibleInformationChannel: "Correo institucional con texto accesible",
    },
    {
      id: "SOL-DEMO-005",
      status: "accepted",
      origin: "student",
      createdAt: "2026-08-25T14:10:00.000Z",
      updatedAt: "2026-08-28T11:20:00.000Z",
      needSummary: "Mantener apoyos para participar en clases y actividades prácticas.",
      expectedOutcome: "Continuar el semestre con acuerdos de participación accesibles.",
      accessNeeds: [{ id: "example-access-5", label: "Material digital accesible" }],
      generalAvailability: {
        preferredWeekdays: [2, 4],
        preferredTimeRange: { from: "14:00", to: "17:00" },
      },
      modalityPreference: "inPerson",
      preferredAccessibleInformationChannel: "Correo institucional con texto accesible",
    },
  ],
  accompaniments: [
    {
      id: "example-accompaniment-1",
      requestId: "SOL-DEMO-001",
      status: "active",
      createdAt: "2026-08-12T15:00:00.000Z",
    },
    {
      id: "example-accompaniment-2",
      requestId: "SOL-DEMO-005",
      status: "paused",
      createdAt: "2026-08-28T11:20:00.000Z",
    },
  ],
};
