import { describe, expect, expectTypeOf, test } from "vitest";
import {
  FOLLOW_UP_CONTRACT_VERSION,
  FOLLOW_UP_ENTRIES_MAX,
  FOLLOW_UP_RESPONSIBLE_VALUES,
  FOLLOW_UP_TASK_STATUS_VALUES,
  FOLLOW_UP_TEXT_MAX_LENGTH,
  isFollowUpResponsible,
  isFollowUpTaskStatus,
  toSharedFollowUpProjection,
  validateFollowUpRecord,
  type FollowUpRecord,
  type FollowUpRecordInput,
  type FollowUpRejectionCause,
  type SharedFollowUpProjection,
} from "./follow_up";
import {
  FOLLOW_UP_CONTRACT_VERSION as BARREL_VERSION,
  isFollowUpResponsible as barrelIsResponsible,
  isFollowUpTaskStatus as barrelIsStatus,
  toSharedFollowUpProjection as barrelToShared,
  validateFollowUpRecord as barrelValidate,
  type FollowUpRecord as BarrelRecord,
  type FollowUpRecordInput as BarrelInput,
  type SharedFollowUpProjection as BarrelShared,
} from "../index";

const validInput: FollowUpRecordInput = {
  appointmentId: "atencion-ficticia-1",
  accompanimentId: "acompanamiento-ficticio-1",
  appointmentStatus: "completed",
  agreements: [{ id: "acuerdo-1", description: " Continuar con el plan acordado. " }],
  tasks: [
    {
      id: "tarea-1",
      description: " Enviar el resumen de la atención. ",
      responsible: "professional",
      status: "pending",
    },
  ],
  nextSteps: " Revisar avances en dos semanas. ",
  suggestedNextAppointmentDate: "2026-11-03",
  internalNote: " La estudiante pidió confirmar por correo. ",
};

function causesOf(input: FollowUpRecordInput): readonly FollowUpRejectionCause[] {
  const result = validateFollowUpRecord(input);
  return result.status === "invalid" ? result.causes : [];
}

function recordOf(input: FollowUpRecordInput): FollowUpRecord {
  const result = validateFollowUpRecord(input);
  if (result.status === "invalid") {
    throw new Error(`El registro debía ser válido: ${result.causes.join(", ")}`);
  }
  return result.record;
}

describe("Registro de seguimiento (TI2-106)", () => {
  test("la versión y los guardas salen por el barrel sin duplicar la fuente", () => {
    expect(FOLLOW_UP_CONTRACT_VERSION).toBe("v1");
    expect(BARREL_VERSION).toBe(FOLLOW_UP_CONTRACT_VERSION);
    expect(barrelValidate).toBe(validateFollowUpRecord);
    expect(barrelToShared).toBe(toSharedFollowUpProjection);
    expect(barrelIsStatus).toBe(isFollowUpTaskStatus);
    expect(barrelIsResponsible).toBe(isFollowUpResponsible);
    expectTypeOf<BarrelRecord>().toEqualTypeOf<FollowUpRecord>();
    expectTypeOf<BarrelInput>().toEqualTypeOf<FollowUpRecordInput>();
    expectTypeOf<BarrelShared>().toEqualTypeOf<SharedFollowUpProjection>();
  });

  test("un registro válido se normaliza y conserva su contenido operativo", () => {
    const record = recordOf(validInput);
    expect(record).toEqual({
      appointmentId: "atencion-ficticia-1",
      accompanimentId: "acompanamiento-ficticio-1",
      agreements: [{ id: "acuerdo-1", description: "Continuar con el plan acordado." }],
      tasks: [
        {
          id: "tarea-1",
          description: "Enviar el resumen de la atención.",
          responsible: "professional",
          status: "pending",
        },
      ],
      nextSteps: "Revisar avances en dos semanas.",
      suggestedNextAppointmentDate: "2026-11-03",
      internalNote: "La estudiante pidió confirmar por correo.",
      version: "v1",
    });
    expect(Object.keys(record).sort()).toEqual([
      "accompanimentId",
      "agreements",
      "appointmentId",
      "internalNote",
      "nextSteps",
      "suggestedNextAppointmentDate",
      "tasks",
      "version",
    ]);
    expect("appointmentStatus" in record).toBe(false);
    expect("diagnosis" in record).toBe(false);
    expect("clinicalEvaluation" in record).toBe(false);
  });

  test("la proyección compartida no incluye la nota interna", () => {
    const record = recordOf(validInput);
    const shared = toSharedFollowUpProjection(record, "completed");
    expect(Object.keys(shared).sort()).toEqual([
      "accompanimentId",
      "agreements",
      "appointmentId",
      "appointmentStatus",
      "nextSteps",
      "suggestedNextAppointmentDate",
      "tasks",
      "version",
    ]);
    expect("internalNote" in shared).toBe(false);
    expect(JSON.stringify(shared)).not.toContain("pidió confirmar");
    expect(shared.agreements).toEqual(record.agreements);
    expect(shared.tasks).toEqual(record.tasks);
  });

  test("la proyección muestra el estado vigente de la atención", () => {
    const record = recordOf({ ...validInput, appointmentStatus: "completed" });
    expect("appointmentStatus" in record).toBe(false);
    const shared = toSharedFollowUpProjection(record, "no_show_justified");
    expect(shared.appointmentStatus).toBe("no_show_justified");
  });

  test("sin fecha sugerida la proyección tampoco inventa la clave", () => {
    const shared = toSharedFollowUpProjection(
      recordOf({ ...validInput, suggestedNextAppointmentDate: undefined }),
      "completed",
    );
    expect("suggestedNextAppointmentDate" in shared).toBe(false);
  });

  test("las referencias a la atención y al acompañamiento son obligatorias", () => {
    expect(causesOf({ ...validInput, appointmentId: "  " })).toEqual([
      "appointment_reference_required",
    ]);
    expect(causesOf({ ...validInput, accompanimentId: "" })).toEqual([
      "accompaniment_reference_required",
    ]);
    expect(causesOf({ ...validInput, appointmentId: "", accompanimentId: " " })).toEqual([
      "appointment_reference_required",
      "accompaniment_reference_required",
    ]);
  });

  test("solo se registra seguimiento posterior a una atención", () => {
    expect(causesOf({ ...validInput, appointmentStatus: "diagnosed" })).toEqual([
      "appointment_status_unknown",
    ]);
    for (const status of [
      "scheduled",
      "rescheduled",
      "cancelled_by_student",
      "cancelled_by_cereti",
    ]) {
      expect(causesOf({ ...validInput, appointmentStatus: status })).toEqual([
        "follow_up_not_admissible",
      ]);
    }
    for (const status of ["completed", "no_show", "no_show_justified", "no_show_unjustified"]) {
      expect(validateFollowUpRecord({ ...validInput, appointmentStatus: status }).status).toBe(
        "valid",
      );
    }
  });

  test("las tareas exigen responsable y estado conocidos", () => {
    const task = validInput.tasks[0];
    expect(causesOf({ ...validInput, tasks: [{ ...task, responsible: "apoderado" }] })).toEqual([
      "responsible_unknown",
    ]);
    expect(causesOf({ ...validInput, tasks: [{ ...task, status: "diagnosed" }] })).toEqual([
      "task_status_unknown",
    ]);
    expect(isFollowUpResponsible("student")).toBe(true);
    expect(isFollowUpResponsible("student_guardian")).toBe(false);
    expect(isFollowUpTaskStatus("in_progress")).toBe(true);
    expect(isFollowUpTaskStatus("evaluated")).toBe(false);
    for (const responsible of FOLLOW_UP_RESPONSIBLE_VALUES) {
      expect(
        validateFollowUpRecord({ ...validInput, tasks: [{ ...task, responsible }] }).status,
      ).toBe("valid");
    }
    for (const status of FOLLOW_UP_TASK_STATUS_VALUES) {
      expect(validateFollowUpRecord({ ...validInput, tasks: [{ ...task, status }] }).status).toBe(
        "valid",
      );
    }
  });

  test("los textos operativos no admiten etiquetas clínicas explícitas", () => {
    const labels = [
      "Diagnóstico: ansiedad generalizada",
      "Ficha clínica del proceso",
      "Informe psicológico adjunto",
      "Evaluación psicológica previa",
      "Criterios DSM-5",
      "Codificación CIE-10",
    ];
    for (const label of labels) {
      const result = validateFollowUpRecord({ ...validInput, nextSteps: label });
      expect(result.status === "invalid" ? result.causes : []).toEqual([
        "clinical_content_not_allowed",
      ]);
    }
    expect(
      validateFollowUpRecord({
        ...validInput,
        nextSteps: "Continuar el seguimiento operativo acordado.",
      }).status,
    ).toBe("valid");
    expect(
      validateFollowUpRecord({
        ...validInput,
        nextSteps: "Recordar que no se necesita certificado ni diagnóstico.",
      }).status,
    ).toBe("valid");
  });

  test("los textos deben existir y respetar el largo máximo", () => {
    expect(causesOf({ ...validInput, nextSteps: "  " })).toEqual(["text_required"]);
    expect(causesOf({ ...validInput, internalNote: "" })).toEqual(["text_required"]);
    expect(
      validateFollowUpRecord({
        ...validInput,
        nextSteps: "a".repeat(FOLLOW_UP_TEXT_MAX_LENGTH),
      }).status,
    ).toBe("valid");
    expect(
      causesOf({ ...validInput, nextSteps: "a".repeat(FOLLOW_UP_TEXT_MAX_LENGTH + 1) }),
    ).toEqual(["text_too_long"]);
  });

  test("los acuerdos y tareas exigen identificadores únicos y acotados", () => {
    const agreement = validInput.agreements[0];
    const task = validInput.tasks[0];
    expect(causesOf({ ...validInput, agreements: [{ ...agreement, id: " " }] })).toEqual([
      "entry_id_required",
    ]);
    expect(
      causesOf({ ...validInput, agreements: [agreement, { ...agreement, description: "Otra." }] }),
    ).toEqual(["duplicate_entry_id"]);
    expect(causesOf({ ...validInput, tasks: [task, { ...task, id: "tarea-1" }] })).toEqual([
      "duplicate_entry_id",
    ]);
    const manyAgreements = Array.from({ length: FOLLOW_UP_ENTRIES_MAX + 1 }, (_, index) => ({
      id: `acuerdo-${index}`,
      description: "Acuerdo operativo.",
    }));
    expect(causesOf({ ...validInput, agreements: manyAgreements })).toEqual([
      "entries_limit_exceeded",
    ]);
  });

  test("la fecha sugerida debe ser una fecha civil válida", () => {
    expect(causesOf({ ...validInput, suggestedNextAppointmentDate: "2026-02-30" })).toEqual([
      "suggested_date_invalid",
    ]);
    expect(
      validateFollowUpRecord({ ...validInput, suggestedNextAppointmentDate: "2026-02-28" }).status,
    ).toBe("valid");
  });

  test("varias causas se informan juntas en el orden declarado", () => {
    expect(
      causesOf({
        ...validInput,
        appointmentId: "",
        appointmentStatus: "diagnosed",
        nextSteps: " ",
        tasks: [
          {
            id: "",
            description: "Diagnóstico: ansiedad",
            responsible: "tutor",
            status: "unknown",
          },
        ],
      }),
    ).toEqual([
      "appointment_reference_required",
      "appointment_status_unknown",
      "entry_id_required",
      "text_required",
      "responsible_unknown",
      "task_status_unknown",
      "clinical_content_not_allowed",
    ]);
  });
});
