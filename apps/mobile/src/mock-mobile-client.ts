import type {
  Accompaniment,
  Appointment,
  MobileClient,
  OperationalFollowUp,
  StudentAreaSnapshot,
  StudentRequest,
} from './mobile-client';

/**
 * Fictitious, demo-only data for the isolated Sprint 1 example.
 * This adapter deliberately owns the mock data so UI code only sees MobileClient.
 */
const demoRequests: readonly StudentRequest[] = [
  {
    id: 'demo-request-1',
    status: 'accepted',
    needSummary: 'Organizar apoyos para participar en actividades académicas.',
    expectedOutcome: 'Contar con una coordinación accesible para el semestre.',
    accessNeeds: [
      {
        id: 'demo-access-1',
        label: 'Materiales en formato digital accesible',
      },
    ],
    generalAvailability: {
      preferredWeekdays: [2, 4],
      preferredTimeRange: { from: '10:00', to: '13:00' },
      preferredModality: 'either',
    },
    createdAt: '2026-08-10T15:00:00.000Z',
    origin: 'student',
  },
];

const demoAccompaniments: readonly Accompaniment[] = [
  {
    id: 'demo-accompaniment-1',
    requestId: 'demo-request-1',
    status: 'active',
    objective: 'Acordar apoyos y revisar su funcionamiento durante el semestre.',
    professionalNames: ['Profesional Demo'],
    openedAt: '2026-08-12T15:00:00.000Z',
  },
];

const demoAppointments: readonly Appointment[] = [
  {
    id: 'demo-appointment-1',
    accompanimentId: 'demo-accompaniment-1',
    status: 'scheduled',
    startsAt: '2026-09-10T14:00:00.000Z',
    endsAt: '2026-09-10T14:45:00.000Z',
    modality: 'online',
    accessNeedsSnapshot: demoRequests[0].accessNeeds,
  },
];

const demoFollowUps: readonly OperationalFollowUp[] = [
  {
    id: 'demo-follow-up-1',
    accompanimentId: 'demo-accompaniment-1',
    appointmentId: 'demo-appointment-1',
    summary: 'Revisar si los materiales digitales fueron recibidos correctamente.',
    nextStep: 'Conversar ajustes en la próxima atención.',
    suggestedNextDate: '2026-09-17T14:00:00.000Z',
    agreements: [
      {
        id: 'demo-agreement-1',
        summary: 'Mantener la preferencia de modalidad en línea para la coordinación.',
        agreedAt: '2026-08-27T14:45:00.000Z',
      },
    ],
    tasks: [
      {
        id: 'demo-task-1',
        summary: 'Compartir el próximo material en formato digital.',
        responsibleName: 'Profesional Demo',
        dueAt: '2026-09-08T17:00:00.000Z',
        completed: false,
      },
    ],
  },
];

export function createMockMobileClient(): MobileClient {
  return {
    async getStudentArea(): Promise<StudentAreaSnapshot> {
      return {
        user: {
          id: 'demo-user-1',
          displayName: 'Estudiante Demo',
          institutionalEmail: 'estudiante.demo@example.invalid',
          area: 'student',
          role: 'student',
        },
        requests: demoRequests,
        accompaniments: demoAccompaniments,
        appointments: demoAppointments,
        followUps: demoFollowUps,
      };
    },
  };
}
