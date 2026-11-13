import { describe, expect, test } from "vitest";
import {
  appointmentCancellationTarget,
  AUTHORIZATION_ACTIONS,
  canBookAppointment,
  canCancelAppointment,
  canEditAvailability,
  canEnableAccount,
  canListAccounts,
  canManageAccounts,
  canManageSpaceCatalog,
  canReadAccount,
  canReadAvailability,
  canReadInternalNote,
  canReadSpaceCatalog,
  canRecordAppointmentAttendance,
  canRescheduleAppointment,
  canRevokeAccount,
  canWriteFollowUp,
  getAccompanimentView,
  getAppointmentView,
  getFollowUpView,
  isProfessionalBookable,
  isProfileActive,
  PERMISSION_MATRIX,
  type AgendaAuthorizationContext,
  type AppointmentChangeAuthorizationContext,
  type AuthorizationContext,
  type AvailabilityAuthorizationContext,
} from "./permissions";
import { toAppointmentProjection, type Appointment } from "../appointments/appointment";
import { toFollowUpProjection, type FollowUpRecord } from "../follow_up/follow_up";
import { ROLE_VALUES } from "../identity/roles";

function activeContext(overrides: Partial<AuthorizationContext>): AuthorizationContext {
  return {
    role: "student",
    institutionalStatus: "enabled",
    accountStatus: "active",
    isOwner: false,
    hasActiveProfessionalAssignment: false,
    hasActiveInternAssignment: false,
    ...overrides,
  };
}

function agendaContext(overrides: Partial<AgendaAuthorizationContext>): AgendaAuthorizationContext {
  return { ...activeContext({}), accompanimentStatus: "active", ...overrides };
}

function changeContext(
  overrides: Partial<AppointmentChangeAuthorizationContext>,
): AppointmentChangeAuthorizationContext {
  return {
    ...agendaContext({}),
    isAppointmentStudent: false,
    isAppointmentProfessional: false,
    ...overrides,
  };
}

function availabilityContext(
  overrides: Partial<AvailabilityAuthorizationContext>,
): AvailabilityAuthorizationContext {
  return {
    role: "professional",
    institutionalStatus: "enabled",
    accountStatus: "active",
    isAvailabilityOwner: true,
    ...overrides,
  };
}

const INACTIVE_ACCOUNTS = [
  { institutionalStatus: "disabled", accountStatus: "active" },
  { institutionalStatus: "pending", accountStatus: "active" },
  { institutionalStatus: "enabled", accountStatus: "inactive" },
] as const;

describe("isProfileActive", () => {
  test("exige habilitación y vigencia", () => {
    expect(isProfileActive({ institutionalStatus: "enabled", accountStatus: "active" })).toBe(true);
    expect(isProfileActive({ institutionalStatus: "disabled", accountStatus: "active" })).toBe(
      false,
    );
    expect(isProfileActive({ institutionalStatus: "pending", accountStatus: "active" })).toBe(
      false,
    );
    expect(isProfileActive({ institutionalStatus: "enabled", accountStatus: "inactive" })).toBe(
      false,
    );
  });
});

describe("getAccompanimentView", () => {
  test("estudiante solo ve los propios en vista completa", () => {
    expect(getAccompanimentView(activeContext({ role: "student", isOwner: true }))).toBe("full");
    expect(getAccompanimentView(activeContext({ role: "student", isOwner: false }))).toBe(null);
  });

  test("profesional solo ve asignados activos en vista completa", () => {
    expect(
      getAccompanimentView(
        activeContext({ role: "professional", hasActiveProfessionalAssignment: true }),
      ),
    ).toBe("full");
    expect(
      getAccompanimentView(
        activeContext({ role: "professional", hasActiveProfessionalAssignment: false }),
      ),
    ).toBe(null);
  });

  test("practicante solo ve asignados activos en vista minimizada", () => {
    expect(
      getAccompanimentView(activeContext({ role: "intern", hasActiveInternAssignment: true })),
    ).toBe("minimized");
    expect(
      getAccompanimentView(activeContext({ role: "intern", hasActiveInternAssignment: false })),
    ).toBe(null);
  });

  test("administrador nunca accede a acompañamientos", () => {
    expect(
      getAccompanimentView(
        activeContext({
          role: "admin",
          isOwner: true,
          hasActiveProfessionalAssignment: true,
          hasActiveInternAssignment: true,
        }),
      ),
    ).toBe(null);
  });

  test("cuenta inhabilitada deniega aunque exista relación", () => {
    expect(
      getAccompanimentView(
        activeContext({
          role: "professional",
          institutionalStatus: "disabled",
          hasActiveProfessionalAssignment: true,
        }),
      ),
    ).toBe(null);
    expect(
      getAccompanimentView(
        activeContext({
          role: "student",
          accountStatus: "inactive",
          isOwner: true,
        }),
      ),
    ).toBe(null);
  });
});

describe("vistas de atención y seguimiento", () => {
  const professional = activeContext({
    role: "professional",
    hasActiveProfessionalAssignment: true,
  });
  const intern = activeContext({ role: "intern", hasActiveInternAssignment: true });
  const owner = activeContext({ role: "student", isOwner: true });

  test("cada rol recibe su vista de atención y de seguimiento", () => {
    expect(getAppointmentView(owner)).toBe("shared");
    expect(getAppointmentView(professional)).toBe("full");
    expect(getAppointmentView(intern)).toBe("minimized");
    expect(getFollowUpView(owner)).toBe("shared");
    expect(getFollowUpView(professional)).toBe("professional");
    expect(getFollowUpView(intern)).toBe("minimized");
  });

  test("sin relación vigente o con Administrador no hay vista", () => {
    const denied = [
      activeContext({ role: "student", isOwner: false }),
      activeContext({ role: "professional", hasActiveProfessionalAssignment: false }),
      activeContext({ role: "intern", hasActiveInternAssignment: false }),
      activeContext({ role: "admin", isOwner: true, hasActiveProfessionalAssignment: true }),
      activeContext({ role: "intern", hasActiveProfessionalAssignment: true }),
    ];
    for (const context of denied) {
      expect(getAppointmentView(context)).toBe(null);
      expect(getFollowUpView(context)).toBe(null);
    }
  });

  test("una cuenta sin habilitar o sin vigencia pierde la vista", () => {
    for (const account of INACTIVE_ACCOUNTS) {
      expect(getFollowUpView({ ...professional, ...account })).toBe(null);
      expect(getAppointmentView({ ...owner, ...account })).toBe(null);
    }
  });
});

describe("canWriteFollowUp", () => {
  const writer = agendaContext({ role: "professional", hasActiveProfessionalAssignment: true });

  test("solo el Profesional asignado con el acompañamiento activo", () => {
    expect(canWriteFollowUp(writer)).toBe(true);
    expect(canWriteFollowUp({ ...writer, accompanimentStatus: "closed" })).toBe(false);
    expect(canWriteFollowUp({ ...writer, accompanimentStatus: "paused" })).toBe(false);
    expect(canWriteFollowUp({ ...writer, hasActiveProfessionalAssignment: false })).toBe(false);
  });

  test("Estudiante, Practicante y Administrador no escriben aunque tengan relación", () => {
    for (const role of ["student", "intern", "admin"] as const) {
      expect(
        canWriteFollowUp({
          ...writer,
          role,
          isOwner: true,
          hasActiveInternAssignment: true,
        }),
      ).toBe(false);
    }
  });

  test("una cuenta sin habilitar o sin vigencia no escribe", () => {
    for (const account of INACTIVE_ACCOUNTS) {
      expect(canWriteFollowUp({ ...writer, ...account })).toBe(false);
    }
  });
});

describe("canReadInternalNote", () => {
  test("solo profesional asignado puede leer notas internas", () => {
    expect(
      canReadInternalNote(
        activeContext({ role: "professional", hasActiveProfessionalAssignment: true }),
      ),
    ).toBe(true);
  });

  test("niega a estudiante dueño, practicante asignado y administrador", () => {
    expect(canReadInternalNote(activeContext({ role: "student", isOwner: true }))).toBe(false);
    expect(
      canReadInternalNote(activeContext({ role: "intern", hasActiveInternAssignment: true })),
    ).toBe(false);
    expect(
      canReadInternalNote(
        activeContext({
          role: "admin",
          hasActiveProfessionalAssignment: true,
          hasActiveInternAssignment: true,
        }),
      ),
    ).toBe(false);
    expect(
      canReadInternalNote(
        activeContext({ role: "professional", hasActiveProfessionalAssignment: false }),
      ),
    ).toBe(false);
  });
});

describe("canEditAvailability", () => {
  test("el profesional vigente edita solo su propia disponibilidad", () => {
    expect(canEditAvailability(availabilityContext({ isAvailabilityOwner: true }))).toBe(true);
    expect(canEditAvailability(availabilityContext({ isAvailabilityOwner: false }))).toBe(false);
  });

  test("estudiante, practicante y administrador no editan ni la disponibilidad a su nombre", () => {
    for (const role of ["student", "intern", "admin"] as const) {
      expect(canEditAvailability(availabilityContext({ role }))).toBe(false);
    }
  });

  test("cuenta inhabilitada, pendiente o inactiva no edita", () => {
    for (const account of INACTIVE_ACCOUNTS) {
      expect(canEditAvailability(availabilityContext(account))).toBe(false);
    }
  });
});

describe("canReadAvailability", () => {
  test("el dueño y el profesional asignado consultan cupos de un acompañamiento activo", () => {
    expect(canReadAvailability(agendaContext({ role: "student", isOwner: true }))).toBe(true);
    expect(
      canReadAvailability(
        agendaContext({ role: "professional", hasActiveProfessionalAssignment: true }),
      ),
    ).toBe(true);
  });

  test("acompañamiento ajeno y profesional habilitado sin asignación no consultan", () => {
    expect(canReadAvailability(agendaContext({ role: "student", isOwner: false }))).toBe(false);
    expect(
      canReadAvailability(
        agendaContext({ role: "professional", hasActiveProfessionalAssignment: false }),
      ),
    ).toBe(false);
  });

  test("practicante asignado y administrador no consultan cupos", () => {
    expect(
      canReadAvailability(agendaContext({ role: "intern", hasActiveInternAssignment: true })),
    ).toBe(false);
    expect(
      canReadAvailability(
        agendaContext({
          role: "admin",
          isOwner: true,
          hasActiveProfessionalAssignment: true,
          hasActiveInternAssignment: true,
        }),
      ),
    ).toBe(false);
  });

  test("acompañamiento pausado o cerrado no admite consulta", () => {
    for (const accompanimentStatus of ["paused", "closed"] as const) {
      expect(
        canReadAvailability(agendaContext({ role: "student", isOwner: true, accompanimentStatus })),
      ).toBe(false);
      expect(
        canReadAvailability(
          agendaContext({
            role: "professional",
            hasActiveProfessionalAssignment: true,
            accompanimentStatus,
          }),
        ),
      ).toBe(false);
    }
  });

  test("cuenta inhabilitada, pendiente o inactiva no consulta aunque sea dueña", () => {
    for (const account of INACTIVE_ACCOUNTS) {
      expect(
        canReadAvailability(agendaContext({ role: "student", isOwner: true, ...account })),
      ).toBe(false);
    }
  });
});

describe("canBookAppointment", () => {
  test("solo el estudiante dueño reserva en un acompañamiento activo", () => {
    expect(canBookAppointment(agendaContext({ role: "student", isOwner: true }))).toBe(true);
    expect(canBookAppointment(agendaContext({ role: "student", isOwner: false }))).toBe(false);
  });

  test("profesional asignado, practicante asignado y administrador no reservan", () => {
    expect(
      canBookAppointment(
        agendaContext({ role: "professional", hasActiveProfessionalAssignment: true }),
      ),
    ).toBe(false);
    expect(
      canBookAppointment(agendaContext({ role: "intern", hasActiveInternAssignment: true })),
    ).toBe(false);
    expect(canBookAppointment(agendaContext({ role: "admin", isOwner: true }))).toBe(false);
  });

  test("acompañamiento pausado o cerrado no admite reserva", () => {
    for (const accompanimentStatus of ["paused", "closed"] as const) {
      expect(
        canBookAppointment(agendaContext({ role: "student", isOwner: true, accompanimentStatus })),
      ).toBe(false);
    }
  });

  test("cuenta inhabilitada, pendiente o inactiva no reserva", () => {
    for (const account of INACTIVE_ACCOUNTS) {
      expect(
        canBookAppointment(agendaContext({ role: "student", isOwner: true, ...account })),
      ).toBe(false);
    }
  });
});

describe("canCancelAppointment y canRescheduleAppointment", () => {
  test("el Estudiante dueño cambia solo su propia atención activa", () => {
    const ownAppointment = changeContext({
      role: "student",
      isOwner: true,
      isAppointmentStudent: true,
    });
    expect(canCancelAppointment(ownAppointment)).toBe(true);
    expect(canRescheduleAppointment(ownAppointment)).toBe(true);
    expect(appointmentCancellationTarget(ownAppointment)).toBe("cancelled_by_student");

    expect(
      canCancelAppointment(
        changeContext({
          role: "student",
          isOwner: true,
          isAppointmentStudent: false,
        }),
      ),
    ).toBe(false);
    expect(
      canRescheduleAppointment(
        changeContext({
          role: "student",
          isOwner: false,
          isAppointmentStudent: true,
        }),
      ),
    ).toBe(false);
  });

  test("el Profesional asignado cambia solo la atención que tiene a su cargo", () => {
    const ownAppointment = changeContext({
      role: "professional",
      hasActiveProfessionalAssignment: true,
      isAppointmentProfessional: true,
    });
    expect(canCancelAppointment(ownAppointment)).toBe(true);
    expect(canRescheduleAppointment(ownAppointment)).toBe(true);
    expect(appointmentCancellationTarget(ownAppointment)).toBe("cancelled_by_cereti");

    expect(
      canCancelAppointment(
        changeContext({
          role: "professional",
          hasActiveProfessionalAssignment: true,
          isAppointmentProfessional: false,
        }),
      ),
    ).toBe(false);
    expect(
      canRescheduleAppointment(
        changeContext({
          role: "professional",
          hasActiveProfessionalAssignment: false,
          isAppointmentProfessional: true,
        }),
      ),
    ).toBe(false);
  });

  test("Practicante y Administrador no cambian atenciones aunque la fila los nombre", () => {
    for (const role of ["intern", "admin"] as const) {
      const context = changeContext({
        role,
        isOwner: true,
        hasActiveProfessionalAssignment: true,
        hasActiveInternAssignment: true,
        isAppointmentStudent: true,
        isAppointmentProfessional: true,
      });
      expect(canCancelAppointment(context)).toBe(false);
      expect(canRescheduleAppointment(context)).toBe(false);
      expect(appointmentCancellationTarget(context)).toBe(null);
    }
  });

  test("acompañamiento no activo y cuenta no vigente no cambian la atención", () => {
    for (const accompanimentStatus of ["paused", "closed"] as const) {
      const context = changeContext({
        role: "student",
        isOwner: true,
        isAppointmentStudent: true,
        accompanimentStatus,
      });
      expect(canCancelAppointment(context)).toBe(false);
      expect(canRescheduleAppointment(context)).toBe(false);
    }
    for (const account of INACTIVE_ACCOUNTS) {
      const context = changeContext({
        role: "student",
        isOwner: true,
        isAppointmentStudent: true,
        ...account,
      });
      expect(canCancelAppointment(context)).toBe(false);
      expect(canRescheduleAppointment(context)).toBe(false);
    }
  });
});

describe("canRecordAppointmentAttendance", () => {
  test("solo el Profesional asignado de la propia atención registra el resultado", () => {
    expect(
      canRecordAppointmentAttendance(
        changeContext({
          role: "professional",
          hasActiveProfessionalAssignment: true,
          isAppointmentProfessional: true,
        }),
      ),
    ).toBe(true);

    expect(
      canRecordAppointmentAttendance(
        changeContext({
          role: "professional",
          hasActiveProfessionalAssignment: true,
          isAppointmentProfessional: false,
        }),
      ),
    ).toBe(false);
    expect(
      canRecordAppointmentAttendance(
        changeContext({
          role: "professional",
          hasActiveProfessionalAssignment: false,
          isAppointmentProfessional: true,
        }),
      ),
    ).toBe(false);
  });

  test("Estudiante dueño, Practicante y Administrador no registran aunque la fila los nombre", () => {
    const studentOwner = changeContext({
      role: "student",
      isOwner: true,
      isAppointmentStudent: true,
    });
    expect(canRecordAppointmentAttendance(studentOwner)).toBe(false);

    for (const role of ["intern", "admin"] as const) {
      const context = changeContext({
        role,
        isOwner: true,
        hasActiveProfessionalAssignment: true,
        hasActiveInternAssignment: true,
        isAppointmentStudent: true,
        isAppointmentProfessional: true,
      });
      expect(canRecordAppointmentAttendance(context)).toBe(false);
    }
  });

  test("acompañamiento no activo y cuenta no vigente no registran la atención", () => {
    for (const accompanimentStatus of ["paused", "closed"] as const) {
      expect(
        canRecordAppointmentAttendance(
          changeContext({
            role: "professional",
            hasActiveProfessionalAssignment: true,
            isAppointmentProfessional: true,
            accompanimentStatus,
          }),
        ),
      ).toBe(false);
    }
    for (const account of INACTIVE_ACCOUNTS) {
      expect(
        canRecordAppointmentAttendance(
          changeContext({
            role: "professional",
            hasActiveProfessionalAssignment: true,
            isAppointmentProfessional: true,
            ...account,
          }),
        ),
      ).toBe(false);
    }
  });
});

describe("isProfessionalBookable", () => {
  const bookableProfessional = {
    role: "professional",
    institutionalStatus: "enabled",
    accountStatus: "active",
    hasActiveProfessionalAssignment: true,
  } as const;

  test("exige rol profesional, cuenta vigente y asignación activa", () => {
    expect(isProfessionalBookable(bookableProfessional)).toBe(true);
    expect(isProfessionalBookable({ ...bookableProfessional, role: "intern" })).toBe(false);
    expect(
      isProfessionalBookable({
        ...bookableProfessional,
        hasActiveProfessionalAssignment: false,
      }),
    ).toBe(false);
    for (const account of INACTIVE_ACCOUNTS) {
      expect(isProfessionalBookable({ ...bookableProfessional, ...account })).toBe(false);
    }
  });
});

describe("canReadSpaceCatalog", () => {
  test("una cuenta habilitada y vigente lee el catálogo", () => {
    expect(canReadSpaceCatalog({ institutionalStatus: "enabled", accountStatus: "active" })).toBe(
      true,
    );
  });

  test("cuenta inhabilitada, pendiente o inactiva no lo lee", () => {
    for (const account of INACTIVE_ACCOUNTS) {
      expect(canReadSpaceCatalog(account)).toBe(false);
    }
  });
});

describe("gestión de cuentas (TI2-137)", () => {
  test("solo el administrador vigente administra cuentas", () => {
    const admin = {
      role: "admin" as const,
      institutionalStatus: "enabled" as const,
      accountStatus: "active" as const,
    };
    expect(canManageAccounts(admin)).toBe(true);
    expect(canListAccounts(admin)).toBe(true);
    expect(canReadAccount(admin)).toBe(true);
    expect(canEnableAccount(admin)).toBe(true);
    expect(canRevokeAccount(admin)).toBe(true);
    for (const role of ["student", "professional", "intern"] as const) {
      const context = {
        role,
        institutionalStatus: "enabled" as const,
        accountStatus: "active" as const,
      };
      expect(canManageAccounts(context)).toBe(false);
      expect(canListAccounts(context)).toBe(false);
      expect(canReadAccount(context)).toBe(false);
      expect(canEnableAccount(context)).toBe(false);
      expect(canRevokeAccount(context)).toBe(false);
    }
    expect(
      canManageAccounts({
        role: "admin",
        institutionalStatus: "disabled",
        accountStatus: "active",
      }),
    ).toBe(false);
    expect(
      canManageAccounts({
        role: "admin",
        institutionalStatus: "enabled",
        accountStatus: "inactive",
      }),
    ).toBe(false);
  });
});

describe("canManageSpaceCatalog", () => {
  test("solo el Administrador con cuenta vigente gestiona el catálogo", () => {
    expect(
      canManageSpaceCatalog({
        role: "admin",
        institutionalStatus: "enabled",
        accountStatus: "active",
      }),
    ).toBe(true);
  });

  test("otros roles o cuenta no vigente no gestionan", () => {
    for (const role of ["student", "professional", "intern"] as const) {
      expect(
        canManageSpaceCatalog({ role, institutionalStatus: "enabled", accountStatus: "active" }),
      ).toBe(false);
    }
    expect(
      canManageSpaceCatalog({
        role: "admin",
        institutionalStatus: "disabled",
        accountStatus: "active",
      }),
    ).toBe(false);
    expect(
      canManageSpaceCatalog({
        role: "admin",
        institutionalStatus: "enabled",
        accountStatus: "inactive",
      }),
    ).toBe(false);
  });
});

describe("PERMISSION_MATRIX", () => {
  test("documenta cada acción una vez, en el orden de AUTHORIZATION_ACTIONS", () => {
    expect(PERMISSION_MATRIX.map((row) => row.action)).toEqual([...AUTHORIZATION_ACTIONS]);
  });
});

/**
 * Proyecciones de TI2-127 compuestas con la política (TI2-117).
 *
 * Recorre todas las combinaciones de rol, relación y cuenta, y usa las
 * funciones de la política como oráculo en vez de copiar la matriz. Cada texto
 * libre lleva un marcador: si aparece en una salida, ese texto llegó a ese rol.
 */
describe("Proyecciones de TI2-127 compuestas con la política (TI2-117)", () => {
  const NOTE = "marcador-nota";
  const FREE_TEXTS = ["marcador-acuerdo", "marcador-tarea", "marcador-pasos", NOTE];
  const CANCEL_REASON = "marcador-motivo";

  const record: FollowUpRecord = {
    appointmentId: "atencion-ficticia-1",
    accompanimentId: "acompanamiento-ficticio-1",
    agreements: [{ id: "acuerdo-1", description: "marcador-acuerdo" }],
    tasks: [
      { id: "tarea-1", description: "marcador-tarea", responsible: "student", status: "pending" },
    ],
    nextSteps: "marcador-pasos",
    suggestedNextAppointmentDate: "2026-11-20",
    internalNote: NOTE,
    version: "v1",
  };

  const appointment: Appointment = {
    id: "atencion-ficticia-1",
    accompanimentId: "acompanamiento-ficticio-1",
    professionalId: "profesional-ficticio-1",
    modality: "online",
    startAt: 1000,
    endAt: 2000,
    cancelReason: CANCEL_REASON,
    status: "cancelled_by_cereti",
    version: "v1",
  };

  const ACCOUNTS = [
    { institutionalStatus: "enabled", accountStatus: "active" },
    ...INACTIVE_ACCOUNTS,
  ] as const;
  const contexts: AuthorizationContext[] = [];
  for (const role of ROLE_VALUES) {
    for (const isOwner of [false, true]) {
      for (const hasActiveProfessionalAssignment of [false, true]) {
        for (const hasActiveInternAssignment of [false, true]) {
          for (const account of ACCOUNTS) {
            contexts.push(
              activeContext({
                role,
                isOwner,
                hasActiveProfessionalAssignment,
                hasActiveInternAssignment,
                ...account,
              }),
            );
          }
        }
      }
    }
  }

  test("ninguna vista concede acceso que el acompañamiento niega", () => {
    // Detecta una regla de vista propia que se separe de `accompaniment:read`.
    for (const context of contexts) {
      const granted = getAccompanimentView(context) !== null;
      expect(getAppointmentView(context) !== null).toBe(granted);
      expect(getFollowUpView(context) !== null).toBe(granted);
    }
  });

  test("la cuenta sin vigencia y el Administrador no reciben ninguna vista", () => {
    // Detecta una vista para una cuenta inhabilitada o un acceso general del Administrador.
    for (const context of contexts) {
      if (isProfileActive(context) && context.role !== "admin") continue;
      expect(getAppointmentView(context)).toBe(null);
      expect(getFollowUpView(context)).toBe(null);
    }
  });

  test("la nota interna solo sale para quien puede leerla", () => {
    // Detecta una vista que entregue la nota a quien `canReadInternalNote` rechaza.
    let checked = 0;
    for (const context of contexts) {
      const view = getFollowUpView(context);
      if (view === null) continue;
      const output = JSON.stringify(toFollowUpProjection(record, "completed", view));
      expect(output.includes(NOTE)).toBe(canReadInternalNote(context));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("la vista minimizada no lleva textos libres ni el vínculo con el acompañamiento", () => {
    // Detecta un campo de texto libre o `accompanimentId` agregado a la vista del Practicante.
    let checked = 0;
    for (const context of contexts) {
      if (getFollowUpView(context) !== "minimized") continue;
      const projected = toFollowUpProjection(record, "completed", "minimized");
      const output = JSON.stringify(projected);
      for (const text of FREE_TEXTS) expect(output.includes(text)).toBe(false);
      expect(Object.keys(projected)).not.toContain("accompanimentId");
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("el motivo de cancelación solo llega al Profesional", () => {
    // Detecta una vista de atención que entregue `cancelReason` al Estudiante o al Practicante.
    let checked = 0;
    for (const context of contexts) {
      const view = getAppointmentView(context);
      if (view === null) continue;
      const output = JSON.stringify(toAppointmentProjection(appointment, view));
      expect(output.includes(CANCEL_REASON)).toBe(context.role === "professional");
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
