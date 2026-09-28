import type { Id } from "../../../../convex/_generated/dataModel";

import type { CanonicalTakenRequest } from "../application/ti2-sprint-1-contracts";
import type { CanonicalProfessionalRequestResponses } from "./ti2-contract-mappers";

const requestId = (value: string) => value as Id<"requests">;
const studentId = "users:student-demo-1" as Id<"users">;

/** Fictional list results shaped from TI2's generated public API types. */
export const fictionalProfessionalRequestResponses: CanonicalProfessionalRequestResponses = {
  open: [
    {
      _id: requestId("SOL-PRO-001"),
      studentId,
      status: "received",
      createdAt: Date.parse("2026-09-16T13:00:00.000Z"),
    },
    {
      _id: requestId("SOL-PRO-004"),
      studentId,
      status: "received",
      createdAt: Date.parse("2026-09-18T08:20:00.000Z"),
    },
  ],
  authorized: [
    {
      _id: requestId("SOL-PRO-002"),
      studentId,
      status: "under_review",
      accessNeeds: "Comunicación escrita",
      createdAt: Date.parse("2026-09-15T15:30:00.000Z"),
    },
    {
      _id: requestId("SOL-PRO-003"),
      studentId,
      status: "awaiting_information_or_acceptance",
      accessNeeds: "Información anticipada",
      createdAt: Date.parse("2026-09-12T12:00:00.000Z"),
    },
    {
      _id: requestId("SOL-PRO-005"),
      studentId,
      status: "under_review",
      accessNeeds: "Reducción de estímulos\nComunicación escrita",
      createdAt: Date.parse("2026-09-17T17:10:00.000Z"),
    },
    {
      _id: requestId("SOL-PRO-006"),
      studentId,
      status: "accepted",
      accessNeeds: "Material digital accesible",
      createdAt: Date.parse("2026-09-10T14:25:00.000Z"),
    },
    {
      _id: requestId("SOL-PRO-007"),
      studentId,
      status: "awaiting_information_or_acceptance",
      accessNeeds: "Información anticipada",
      createdAt: Date.parse("2026-09-08T09:50:00.000Z"),
    },
  ],
};

/** Full mutation results available after mock takeRequest calls. */
export const fictionalTakenRequestResults: Readonly<Record<string, CanonicalTakenRequest>> = {
  "SOL-PRO-001": {
    _id: requestId("SOL-PRO-001"),
    studentId,
    status: "received",
    accessNeeds: "Material digital accesible",
    createdAt: Date.parse("2026-09-16T13:00:00.000Z"),
  },
  "SOL-PRO-004": {
    _id: requestId("SOL-PRO-004"),
    studentId,
    status: "received",
    accessNeeds: "Comunicación escrita",
    createdAt: Date.parse("2026-09-18T08:20:00.000Z"),
  },
};
