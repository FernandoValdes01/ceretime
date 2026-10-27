import { describe, expect, test } from "vitest";
import { applyAppointmentTransition, type ApplyAppointmentTransitionDeps } from "./commands";
import type { AppointmentStatus } from "../../domain/appointments/appointment";

describe("applyAppointmentTransition use case", () => {
  test("applies valid transition and persists without Convex or repository", async () => {
    const rows = new Map<
      string,
      {
        readonly status: AppointmentStatus;
        readonly startsAt: number;
        readonly originalStartsAt?: number;
      }
    >();
    rows.set("app-1", { status: "scheduled", startsAt: 1000 });

    const persisted: Array<{
      readonly id: string;
      readonly fields: {
        readonly status: AppointmentStatus;
        readonly cancelReason?: string;
        readonly originalStartsAt?: number;
      };
    }> = [];

    const deps: ApplyAppointmentTransitionDeps = {
      reader: {
        normalizeAppointmentId: (raw) => (raw.startsWith("app-") ? raw : null),
        getAppointmentById: async (id) => rows.get(id) ?? null,
      },
      persister: {
        persistAppointmentTransition: async (id, fields) => {
          persisted.push({ id, fields });
          const row = rows.get(id);
          if (row) {
            rows.set(id, {
              ...row,
              status: fields.status,
              ...(fields.originalStartsAt !== undefined
                ? { originalStartsAt: fields.originalStartsAt }
                : {}),
            });
          }
        },
      },
    };

    const result = await applyAppointmentTransition(deps, {
      appointmentId: "app-1",
      to: "completed",
      actorId: "pro-1",
      occurredAt: 2000,
    });

    expect(result.status).toBe("ok");
    expect((result as Extract<typeof result, { readonly status: "ok" }>).data.appointmentId).toBe(
      "app-1",
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0].fields.status).toBe("completed");
  });
});
