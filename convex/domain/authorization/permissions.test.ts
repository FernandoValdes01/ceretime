import { describe, expect, test } from "vitest";
import {
  appointmentCancellationTarget,
  AUTHORIZATION_ACTIONS,
  canBookAppointment,
  canCancelAppointment,
  canEditAvailability,
  canReadAvailability,
  canReadInternalNote,
  canReadSpaceCatalog,
  canRecordAppointmentAttendance,
  canRescheduleAppointment,
  getAccompanimentView,
  isProfessionalBookable,
  isProfileActive,
  PERMISSION_MATRIX,
  type AgendaAuthorizationContext,
  type AppointmentChangeAuthorizationContext,
  type AuthorizationContext,
  type AvailabilityAuthorizationContext,
} from "./permissions";

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

describe("PERMISSION_MATRIX", () => {
  test("documenta cada acción una vez, en el orden de AUTHORIZATION_ACTIONS", () => {
    expect(PERMISSION_MATRIX.map((row) => row.action)).toEqual([...AUTHORIZATION_ACTIONS]);
  });
});
