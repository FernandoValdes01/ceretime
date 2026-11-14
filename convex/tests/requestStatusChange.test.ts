import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { toStatusChange } from "../application/requests/status_change";
import type { RequestStatusChange } from "../domain/requests/transitions";
import { setRequestStatus } from "../infrastructure/requests/repository";

/*
 * TI2-141: el cambio de estado vigente de una solicitud. Las líneas con
 * `@ts-expect-error` fijan en `convex/tsconfig.tests.json` que la firma no
 * admite combinaciones inválidas: si llegaran a compilar, el typecheck falla.
 */

describe("toStatusChange (TI2-141)", () => {
  const base = { from: "under_review", actorId: "pro-ficticio", occurredAt: 1 } as const;

  test("el destino sale de la política y solo el cierre lleva su razón", () => {
    expect(
      toStatusChange({ ...base, to: "awaiting_information_or_acceptance", reason: "Pedido" }),
    ).toEqual({ status: "awaiting_information_or_acceptance" });
    expect(
      toStatusChange({ ...base, to: "closed_without_accompaniment", reason: "Razón" }),
    ).toEqual({
      status: "closed_without_accompaniment",
      closureReason: "Razón",
    });
  });

  test("un cierre sin razón es un fallo interno, no una denegación", () => {
    expect(() => toStatusChange({ ...base, to: "closed_without_accompaniment" })).toThrow(
      "La política de solicitudes cerró sin dejar la razón del cierre.",
    );
  });

  test("la firma rechaza una razón de cierre con otro estado y un cierre sin razón", () => {
    // @ts-expect-error una razón de cierre en una solicitud aceptada no compila
    const acceptedWithReason: RequestStatusChange = { status: "accepted", closureReason: "x" };
    // @ts-expect-error un cierre sin razón no compila
    const closedWithoutReason: RequestStatusChange = { status: "closed_without_accompaniment" };
    // Llamadas que nunca se ejecutan: solo las revisa el compilador
    const invalidCalls = (ctx: MutationCtx, requestId: Id<"requests">) => [
      // @ts-expect-error la forma suelta de antes ya no compila
      setRequestStatus(ctx, requestId, "accepted", "x"),
      // @ts-expect-error tampoco con la unión
      setRequestStatus(ctx, requestId, { status: "accepted", closureReason: "x" }),
    ];
    expect([acceptedWithReason, closedWithoutReason]).toHaveLength(2);
    expect(invalidCalls).toBeTypeOf("function");
  });
});
