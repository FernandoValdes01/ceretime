import type { Id } from "../../../../convex/_generated/dataModel";

import type { StudentIdentity } from "../application/student-area-models";
import type { CanonicalStudentAreaResponses } from "./ti2-contract-mappers";

const requestId = (value: string) => value as Id<"requests">;
const studentId = "users:student-demo-1" as Id<"users">;
const accompanimentId = (value: string) => value as Id<"accompaniments">;

/** Minimal authenticated identity used only by the demo fixture. */
export const fictionalStudentIdentity: StudentIdentity = {
  id: "example-student-1",
  displayName: "Valentina Rojas",
  email: "valentina.rojas@alu.uct.cl",
  role: "student",
};

/** Fictional query results shaped from TI2's generated public API types. */
export const fictionalStudentAreaResponses: CanonicalStudentAreaResponses = {
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

/** Demo-only links retained for the accompaniment navigation from TI4-35. */
export const fictionalAccompanimentDetails: Readonly<
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
