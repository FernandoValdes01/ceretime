import type { StudentAreaSnapshot } from "../application/student-area-models";

/** Fictional, demo-only values owned by Infrastructure. */
export const fictionalStudentArea: StudentAreaSnapshot = {
  student: {
    id: "example-student-1",
    displayName: "Estudiante de ejemplo",
    email: "estudiante.demo@example.com",
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
  ],
  accompaniments: [
    {
      id: "example-accompaniment-1",
      requestId: "SOL-DEMO-001",
      status: "active",
      createdAt: "2026-08-12T15:00:00.000Z",
    },
  ],
};
