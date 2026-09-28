import type { Id } from "../../../convex/_generated/dataModel";
import type {
  CanonicalCreatedRequest,
  CanonicalStudentAccompaniment,
  CanonicalStudentRequest,
} from "../src/application/ti2-sprint-1-contracts";
import {
  mapCanonicalStudentAccompaniment,
  mapCanonicalStudentRequest,
  mapCreatedRequestToReceipt,
  mapProfessionalActionToContract,
  mapStudentSubmissionToCreateRequest,
} from "../src/infrastructure/ti2-contract-mappers";
import { toMobileOperationError } from "../src/presentation/to-mobile-operation-error";
import type { SubmitStudentRequestCommand } from "../src/application/student-area-models";

const requestId = "SOL-DEMO-001" as Id<"requests">;
const studentId = "users:student-demo-1" as Id<"users">;

const canonicalRequest: CanonicalStudentRequest = {
  _id: requestId,
  studentId,
  status: "awaiting_information_or_acceptance",
  accessNeeds: "Comunicación escrita",
  createdAt: Date.parse("2026-09-15T15:30:00.000Z"),
};

describe("adaptadores de contratos TI2 para Mobile", () => {
  it("mapea nombres, estados y fechas del contrato a la vista de Mobile", () => {
    expect(mapCanonicalStudentRequest(canonicalRequest)).toEqual({
      id: "SOL-DEMO-001",
      status: "awaitingInformationOrAcceptance",
      createdAt: "2026-09-15T15:30:00.000Z",
      accessNeeds: "Comunicación escrita",
    });
  });

  it("conserva únicamente los campos que TI2 expone en el acompañamiento", () => {
    const accompaniment: CanonicalStudentAccompaniment = {
      _id: "accompaniments:demo-1" as Id<"accompaniments">,
      studentId,
      status: "active",
      objective: "Participar en actividades académicas",
      accessNeeds: "Comunicación escrita",
      view: "full",
    };

    expect(mapCanonicalStudentAccompaniment(accompaniment)).toEqual({
      id: "accompaniments:demo-1",
      status: "active",
      objective: "Participar en actividades académicas",
      accessNeeds: "Comunicación escrita",
      view: "full",
    });
  });

  it("mapea el formulario al único dato aceptado por createRequest y enumera lo omitido", () => {
    const command: SubmitStudentRequestCommand = {
      needSummary: "Participar en las evaluaciones",
      expectedOutcome: "Planificar apoyos accesibles",
      accessNeeds: [{ id: "written", label: "Comunicación escrita" }],
      otherAccessNeed: "Material digital",
      generalAvailability: { preferredWeekdays: [2] },
      modalityPreference: "online",
      preferredAccessibleInformationChannel: "Correo accesible",
    };

    expect(mapStudentSubmissionToCreateRequest(command)).toEqual({
      args: { accessNeeds: "Comunicación escrita\nMaterial digital" },
      omittedFields: [
        "needSummary",
        "expectedOutcome",
        "generalAvailability",
        "modalityPreference",
        "preferredAccessibleInformationChannel",
      ],
    });
  });

  it("rechaza necesidades vacías o sobre el máximo del contrato antes del envío", () => {
    const command: SubmitStudentRequestCommand = {
      needSummary: "Participar en clases",
      expectedOutcome: "Acordar apoyos",
      accessNeeds: [],
      generalAvailability: { preferredWeekdays: [1] },
      modalityPreference: "online",
      preferredAccessibleInformationChannel: "Correo accesible",
    };
    expect(() => mapStudentSubmissionToCreateRequest(command)).toThrow(
      "Se requiere describir la necesidad de acceso",
    );
    expect(() =>
      mapStudentSubmissionToCreateRequest({ ...command, otherAccessNeed: "a".repeat(2001) }),
    ).toThrow("La necesidad de acceso supera el máximo permitido (2000 caracteres)");
  });

  it("convierte la respuesta pública de creación al recibo que espera el formulario", () => {
    const createdRequest: CanonicalCreatedRequest = {
      ...canonicalRequest,
      status: "received",
    };

    expect(mapCreatedRequestToReceipt(createdRequest)).toEqual({
      requestId: "SOL-DEMO-001",
      receivedAt: "2026-09-15T15:30:00.000Z",
    });
  });

  it("exige el motivo y el objetivo que requieren las operaciones públicas", () => {
    expect(mapProfessionalActionToContract("SOL-DEMO-001", "startReview")).toEqual({
      kind: "takeRequest",
      args: { requestId: "SOL-DEMO-001" },
    });
    expect(mapProfessionalActionToContract("SOL-DEMO-001", "requestInformation")).toEqual({
      kind: "unsupported",
      reason: "reason_required",
    });
    expect(
      mapProfessionalActionToContract("SOL-DEMO-001", "requestInformation", {
        reason: "  Falta un dato  ",
      }),
    ).toEqual({
      kind: "requestAdditionalInformation",
      args: { requestId: "SOL-DEMO-001", reason: "Falta un dato" },
    });
    expect(mapProfessionalActionToContract("SOL-DEMO-001", "accept")).toEqual({
      kind: "unsupported",
      reason: "objective_required",
    });
    expect(
      mapProfessionalActionToContract("SOL-DEMO-001", "accept", {
        objective: "  Acordar apoyos  ",
      }),
    ).toEqual({
      kind: "acceptRequest",
      args: { requestId: "SOL-DEMO-001", objective: "Acordar apoyos" },
    });
  });

  it("muestra sólo las formas públicas de error y reemplaza los demás mensajes", () => {
    expect(
      toMobileOperationError(
        { data: { code: "FORBIDDEN", message: "No autorizado" } },
        "No se pudo cargar.",
      ),
    ).toEqual(new Error("No se pudo cargar."));
    expect(
      toMobileOperationError(
        { data: { code: "INTERNAL", message: "Detalle interno" } },
        "No se pudo cargar.",
      ),
    ).toEqual(new Error("No se pudo cargar."));
    expect(
      toMobileOperationError(new Error("detalle interno no público"), "No se pudo cargar."),
    ).toEqual(new Error("No se pudo cargar."));
    expect(
      toMobileOperationError(
        new Error("La necesidad de acceso supera el máximo permitido (2000 caracteres)"),
        "No se pudo enviar.",
      ),
    ).toEqual(new Error("La necesidad de acceso supera el máximo permitido (2000 caracteres)"));
    expect(toMobileOperationError({ data: "No autorizado" }, "No se pudo cargar.")).toEqual(
      new Error("No autorizado"),
    );
  });
});
