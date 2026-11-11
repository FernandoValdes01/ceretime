import type { Id } from "../../../../convex/_generated/dataModel";

import type { StudentIdentity } from "../domain/student-area-models";
import type { BackendStudentAreaResponses } from "./backend-contract-mappers";
import type { StudentPublicOperation } from "../application/student-area-port";
import type { StudentContractArgs, StudentContractResponse } from "./student-contract-mappers";

const requestId = (value: string) => value as Id<"requests">;
const studentId = "users:student-demo-1" as Id<"users">;
const accompanimentId = (value: string) => value as Id<"accompaniments">;

// Identidad mínima del Estudiante de demostración.
export const demoStudentIdentity: StudentIdentity = {
  id: "example-student-1",
  displayName: "Valentina Rojas",
  email: "valentina.rojas@alu.uct.cl",
};

// Resultados ficticios con la forma exacta de la API pública generada de TI2.
export const demoStudentAreaResponses: BackendStudentAreaResponses = {
  requests: [
    {
      _id: requestId("SOL-DEMO-001"),
      studentId,
      status: "accepted",
      accessNeeds: "Material digital accesible",
      createdAt: Date.parse("2026-08-10T15:00:00.000Z"),
    },
    {
      _id: requestId("SOL-DEMO-002"),
      studentId,
      status: "under_review",
      accessNeeds: "Comunicación escrita\nMás tiempo para comunicarme",
      createdAt: Date.parse("2026-09-01T11:30:00.000Z"),
    },
    {
      _id: requestId("SOL-DEMO-003"),
      studentId,
      status: "received",
      accessNeeds: "Comunicación escrita",
      createdAt: Date.parse("2026-09-05T08:45:00.000Z"),
    },
    {
      _id: requestId("SOL-DEMO-004"),
      studentId,
      status: "awaiting_information_or_acceptance",
      accessNeeds: "Información anticipada",
      createdAt: Date.parse("2026-09-08T09:50:00.000Z"),
    },
    {
      _id: requestId("SOL-DEMO-005"),
      studentId,
      status: "accepted",
      accessNeeds: "Material digital accesible",
      createdAt: Date.parse("2026-08-25T14:10:00.000Z"),
    },
  ],
  accompaniments: [
    {
      _id: accompanimentId("accompaniments:accompaniment-demo-1"),
      studentId,
      status: "active",
      objective: "Apoyos para participar en actividades académicas",
      accessNeeds: "Material digital accesible",
      view: "full",
    },
    {
      _id: accompanimentId("accompaniments:accompaniment-demo-2"),
      studentId,
      status: "paused",
      objective: "Continuar el semestre con apoyo accesible",
      accessNeeds: "Material digital accesible",
      view: "full",
    },
  ],
};

/** Ejemplos locales de las cinco operaciones publicadas; no requieren cliente ni conexión. */
export const demoStudentContractExamples = {
  createRequest: {
    args: { accessNeeds: "Comunicación escrita" },
    response: demoStudentAreaResponses.requests[2],
  },
  listOwnRequests: {
    args: { paginationOpts: { numItems: 5, cursor: null } },
    response: {
      page: demoStudentAreaResponses.requests,
      isDone: true,
      continueCursor: "",
    },
  },
  getRequest: {
    args: { requestId: demoStudentAreaResponses.requests[0]._id },
    response: demoStudentAreaResponses.requests[0],
  },
  listOwnedAccompaniments: {
    args: { paginationOpts: { numItems: 5, cursor: null } },
    response: {
      page: demoStudentAreaResponses.accompaniments,
      isDone: true,
      continueCursor: "",
    },
  },
  getAccompaniment: {
    args: { accompanimentId: demoStudentAreaResponses.accompaniments[0]._id },
    response: demoStudentAreaResponses.accompaniments[0],
  },
} satisfies {
  [Operation in StudentPublicOperation]: {
    args: StudentContractArgs<Operation>;
    response: StudentContractResponse<Operation>;
  };
};

// Enlaces de demostración para la navegación de acompañamientos de TI4-35.
export const demoAccompanimentDetails: Readonly<
  Record<string, { readonly requestId: string; readonly createdAt: string }>
> = {
  "accompaniments:accompaniment-demo-1": {
    requestId: "SOL-DEMO-001",
    createdAt: "2026-08-12T15:00:00.000Z",
  },
  "accompaniments:accompaniment-demo-2": {
    requestId: "SOL-DEMO-005",
    createdAt: "2026-08-28T11:20:00.000Z",
  },
};
