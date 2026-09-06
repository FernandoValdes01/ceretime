import type { StudentAreaSnapshot } from '../application/student-area-models';

/** Fictional, demo-only values. The reserved .invalid domain is deliberate. */
export const fictionalStudentArea: StudentAreaSnapshot = {
  student: {
    id: 'example-student-1',
    displayName: 'Estudiante de ejemplo',
    role: 'student',
  },
  requests: [
    {
      id: 'example-request-1',
      status: 'accepted',
      origin: 'student',
      createdAt: '2026-08-10T15:00:00.000Z',
      updatedAt: '2026-08-12T15:00:00.000Z',
      needSummary: 'Organizar apoyos para participar en actividades académicas.',
      expectedOutcome: 'Contar con coordinación accesible durante el semestre.',
      requiredInformation: 'Canal para coordinar los apoyos iniciales.',
      accessNeeds: [{ id: 'example-access-1', label: 'Material digital accesible' }],
      generalAvailability: {
        preferredWeekdays: [2, 4],
        preferredTimeRange: { from: '10:00', to: '13:00' },
      },
      modalityPreference: 'either',
      preferredAccessibleInformationChannel: 'Correo institucional accesible (demo)',
    },
  ],
  accompaniments: [
    {
      id: 'example-accompaniment-1',
      requestId: 'example-request-1',
      status: 'active',
      professionalName: 'Profesional de CERETI de ejemplo',
      createdAt: '2026-08-12T15:00:00.000Z',
    },
  ],
};
