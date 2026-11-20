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

  test("el destino sale de la política y la razón del cierre no viaja en la solicitud", () => {
    expect(
      toStatusChange({ ...base, to: "awaiting_information_or_acceptance", reason: "Pedido" }),
    ).toEqual({ status: "awaiting_information_or_acceptance" });
    // TI2-165: el MER guarda la razón solo en TRANSICIONES_SOLICITUD.
    expect(
      toStatusChange({ ...base, to: "closed_without_accompaniment", reason: "Razón" }),
    ).toEqual({ status: "closed_without_accompaniment" });
  });

  test("TI2-143: la derivación de salida lleva su unidad de destino por el mismo camino", () => {
    const outgoingReferral = {
      destinationUnit: "Unidad ficticia de destino",
      referredAt: 1,
      referredBy: "pro-ficticio",
      reason: "Razón",
    };
    expect(toStatusChange({ ...base, to: "referred", reason: "Razón" }, outgoingReferral)).toEqual({
      status: "referred",
      outgoingReferral,
    });
    // La derivación solo acompaña a `referred`: con otro destino es un fallo interno
    expect(() => toStatusChange({ ...base, to: "accepted" }, outgoingReferral)).toThrow(
      "La derivación de salida solo acompaña al estado de derivación.",
    );
    expect(() => toStatusChange({ ...base, to: "referred", reason: "Razón" })).toThrow(
      "La solicitud se derivó sin dejar la derivación de salida.",
    );
  });

  test("un cierre sin razón es un fallo interno, no una denegación", () => {
    expect(() => toStatusChange({ ...base, to: "closed_without_accompaniment" })).toThrow(
      "La política de solicitudes cerró sin dejar la razón del cierre.",
    );
  });

  test("la firma rechaza una razón de cierre en la solicitud y una derivación sin destino", () => {
    // @ts-expect-error la razón de cierre ya no se escribe en la solicitud (TI2-165)
    const acceptedWithReason: RequestStatusChange = { status: "accepted", closureReason: "x" };
    const closedWithoutReason: RequestStatusChange = { status: "closed_without_accompaniment" };
    // @ts-expect-error una solicitud derivada sin su derivación de salida no compila
    const referredWithoutDestination: RequestStatusChange = { status: "referred" };
    // Llamadas que nunca se ejecutan: solo las revisa el compilador
    const invalidCalls = (ctx: MutationCtx, requestId: Id<"requests">) => [
      // @ts-expect-error la forma suelta de antes ya no compila
      setRequestStatus(ctx, requestId, "accepted", "x"),
      // @ts-expect-error tampoco con la unión
      setRequestStatus(ctx, requestId, { status: "accepted", closureReason: "x" }),
      // @ts-expect-error ni un paso a `referred` sin su derivación de salida
      setRequestStatus(ctx, requestId, { status: "referred" }),
    ];
    expect([acceptedWithReason, closedWithoutReason, referredWithoutDestination]).toHaveLength(3);
    expect(invalidCalls).toBeTypeOf("function");
  });
});
