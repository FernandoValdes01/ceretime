import { describe, expect, test } from "vitest";
import type { AccompanimentStateChange } from "../../domain/accompaniments/accompaniment";
import type { AppointmentAuditEvent } from "../../domain/appointments/audit";
import { conflictError, errResult, unauthorizedError } from "../../domain/errors/api_error";
import type { NotificationEvent } from "../../domain/notifications/notification";
import type { CancellableAppointment } from "../appointments/changes";
import type { AuthorizationReader } from "../authorization/authorize";
import {
  closeAccompaniment,
  pauseAccompaniment,
  previewAccompanimentClosure,
  type CloseAccompanimentDeps,
} from "./status";

/**
 * Pruebas de los casos de uso del estado del acompañamiento (TI2-152) con
 * dobles en memoria y reloj fijo. Cubren los rechazos que la API real no
 * alcanza con datos sembrados: lectura incompleta y cancelación rechazada.
 */

const NOW = 1_000_000;
/** Participantes de cada atención: la cancelación por cierre les avisa (TI2-150). */
const PARTICIPANTS = { studentId: "user-student", professionalId: "user-pro" };
const INPUT = { tokenIdentifier: "token-pro", accompanimentId: "acc-1" };

function fakeAuth(status: "active" | "paused" | "closed" = "active"): AuthorizationReader {
  return {
    findProfileByTokenIdentifier: async (tokenIdentifier) =>
      tokenIdentifier === "token-pro"
        ? {
            _id: "user-pro",
            role: "professional",
            institutionalStatus: "enabled",
            accountStatus: "active",
          }
        : null,
    getProfileById: async () => null,
    getAccompaniment: async (accompanimentId) =>
      accompanimentId === "acc-1" ? { _id: "acc-1", studentId: "user-student", status } : null,
    findActiveAssignments: async (accompanimentId, userId) => [
      { accompanimentId, userId, assignedRole: "professional", status: "active" },
    ],
  };
}

function fakeDeps(
  options: {
    readonly auth?: AuthorizationReader;
    readonly complete?: boolean;
    readonly appointments?: readonly CancellableAppointment[];
  } = {},
) {
  const changes: AccompanimentStateChange[] = [];
  const persisted: { id: string; status: string; cancelReason?: string }[] = [];
  const audited: AppointmentAuditEvent[] = [];
  const notices: NotificationEvent[] = [];
  const deps: CloseAccompanimentDeps = {
    auth: options.auth ?? fakeAuth(),
    accompaniments: {
      persistStatusChange: async (_id, change) => {
        changes.push(change);
      },
    },
    appointments: {
      listPendingAppointments: async () => ({
        complete: options.complete ?? true,
        appointments: options.appointments ?? [],
      }),
    },
    persister: {
      persistAppointmentTransition: async (id, fields) => {
        persisted.push({ id, ...fields });
      },
    },
    audit: {
      recordAppointmentAudit: async (event) => {
        audited.push(event);
      },
    },
    notifications: {
      record: async (events) => {
        notices.push(...events);
      },
    },
    calendarSync: {
      scheduleSync: async () => undefined,
    },
    now: () => NOW,
  };
  return { deps, changes, persisted, audited, notices };
}

describe("estado del acompañamiento (TI2-152)", () => {
  test("pausar guarda solo el estado nuevo", async () => {
    const { deps, changes } = fakeDeps();
    expect(await pauseAccompaniment(deps, INPUT)).toEqual({
      status: "ok",
      data: { accompanimentId: "acc-1", status: "paused" },
    });
    expect(changes).toEqual([{ to: "paused" }]);
  });

  test("sin identidad o sin permiso se deniega igual y no se escribe", async () => {
    const { deps, changes } = fakeDeps();
    for (const tokenIdentifier of [null, "token-ajeno"]) {
      expect(await pauseAccompaniment(deps, { ...INPUT, tokenIdentifier })).toEqual(
        errResult(unauthorizedError()),
      );
      expect(await closeAccompaniment(deps, { ...INPUT, tokenIdentifier })).toEqual(
        errResult(unauthorizedError()),
      );
    }
    expect(changes).toHaveLength(0);
  });

  test("cerrar cancela solo las atenciones futuras, devuelve cuántas y guarda quién, cuándo y por qué", async () => {
    const { deps, changes, persisted, audited, notices } = fakeDeps({
      appointments: [
        { ...PARTICIPANTS, id: "apt-1", status: "scheduled", startAt: NOW + 1 },
        {
          ...PARTICIPANTS,
          id: "apt-2",
          status: "rescheduled",
          startAt: NOW + 2,
          originalStartAt: NOW - 5,
        },
      ],
    });
    expect(await closeAccompaniment(deps, { ...INPUT, reason: " Objetivo cumplido " })).toEqual({
      status: "ok",
      data: { accompanimentId: "acc-1", status: "closed", cancelledAppointments: 2 },
    });
    expect(persisted.map((row) => [row.id, row.status, row.cancelReason])).toEqual([
      ["apt-1", "cancelled_by_cereti", "Cierre del acompañamiento"],
      ["apt-2", "cancelled_by_cereti", "Cierre del acompañamiento"],
    ]);
    expect(audited.map((event) => event.actorId)).toEqual(["user-pro", "user-pro"]);
    expect(changes).toEqual([
      {
        to: "closed",
        closure: { closedById: "user-pro", closedAt: NOW, closureReason: "Objetivo cumplido" },
      },
    ]);
    // Quien cierra no se avisa a sí mismo: cada cancelación avisa al Estudiante.
    expect(notices.map((event) => [event.kind, event.recipientId])).toEqual([
      ["appointment_cancelled", "user-student"],
      ["appointment_cancelled", "user-student"],
    ]);
  });

  test("una atención que empieza justo ahora cuenta como pasada e impide cerrar", async () => {
    const appointments = [
      { ...PARTICIPANTS, id: "apt-1", status: "scheduled" as const, startAt: NOW },
    ];
    const { deps, changes, persisted } = fakeDeps({ appointments });
    expect(await previewAccompanimentClosure(deps, INPUT)).toEqual({
      status: "ok",
      data: { appointmentsToCancel: 0, unrecordedAppointments: 1 },
    });
    expect(await closeAccompaniment(deps, INPUT)).toEqual(errResult(conflictError()));
    expect(changes).toHaveLength(0);
    expect(persisted).toHaveLength(0);
  });

  test("una lectura incompleta de atenciones rechaza el cierre y su vista previa", async () => {
    const { deps, changes } = fakeDeps({ complete: false });
    expect(await previewAccompanimentClosure(deps, INPUT)).toEqual(errResult(conflictError()));
    expect(await closeAccompaniment(deps, INPUT)).toEqual(errResult(conflictError()));
    expect(changes).toHaveLength(0);
  });

  test("una cancelación rechazada por la política detiene el cierre sin cambiar el estado", async () => {
    const { deps, changes } = fakeDeps({
      appointments: [{ ...PARTICIPANTS, id: "apt-1", status: "completed", startAt: NOW + 1 }],
    });
    expect(await closeAccompaniment(deps, INPUT)).toEqual(errResult(conflictError()));
    expect(changes).toHaveLength(0);
  });

  test("un acompañamiento cerrado no admite cierre ni vista previa", async () => {
    const { deps, changes } = fakeDeps({ auth: fakeAuth("closed") });
    expect(await previewAccompanimentClosure(deps, INPUT)).toEqual(errResult(conflictError()));
    expect(await closeAccompaniment(deps, INPUT)).toEqual(errResult(conflictError()));
    expect(changes).toHaveLength(0);
  });
});
