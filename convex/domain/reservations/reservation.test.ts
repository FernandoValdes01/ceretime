import { describe, expect, test } from "vitest";
import {
  isReservationRangeOrdered,
  isReservationStatus,
  JUSTIFICATION_WINDOW_BUSINESS_DAYS,
  RESERVATION_CONTRACT_VERSION,
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_VALUES,
  toReservation,
} from "./reservation";

describe("Reserva de atención versionada (TI2-87)", () => {
  test("la versión vigente es v1 con ocho estados y plazo de cinco días", () => {
    expect(RESERVATION_CONTRACT_VERSION).toBe("v1");
    expect(RESERVATION_STATUS_VALUES).toHaveLength(8);
    expect(JUSTIFICATION_WINDOW_BUSINESS_DAYS).toBe(5);
    expect(RESERVATION_STATUS_LABELS.reserved).toBe("Reservada");
    expect(RESERVATION_STATUS_LABELS.no_show_pending).toBe(
      "Inasistencia pendiente de justificación",
    );
  });

  test("una fila válida se versiona sin decidir transiciones", () => {
    const result = toReservation({
      _id: "reserva-ficticia-1",
      accompanimentId: "acompanamiento-ficticio-1",
      modality: "inPerson",
      startAt: 1000,
      endAt: 2000,
      status: "reserved",
      spaceId: "space-ficticio-c204",
      slotId: "slot-ficticio-1",
    });
    expect(result).toEqual({
      status: "ok",
      data: {
        _id: "reserva-ficticia-1",
        accompanimentId: "acompanamiento-ficticio-1",
        modality: "inPerson",
        startAt: 1000,
        endAt: 2000,
        status: "reserved",
        spaceId: "space-ficticio-c204",
        slotId: "slot-ficticio-1",
        version: "v1",
      },
    });
  });

  test("los casos de error o límite devuelven códigos estables en español", () => {
    expect(isReservationStatus("reserved")).toBe(true);
    expect(isReservationStatus("hybrid")).toBe(false);
    expect(isReservationRangeOrdered(1000, 2000)).toBe(true);
    expect(isReservationRangeOrdered(2000, 1000)).toBe(false);
    expect(
      toReservation({
        _id: "reserva-ficticia-2",
        accompanimentId: "acompanamiento-ficticio-1",
        modality: "inPerson",
        startAt: 1000,
        endAt: 2000,
        status: "invented",
      }),
    ).toEqual({
      status: "error",
      error: {
        code: "reservation_unknown_status",
        message: "El estado de la reserva no pertenece al contrato vigente.",
      },
    });
    expect(
      toReservation({
        _id: "reserva-ficticia-3",
        accompanimentId: "acompanamiento-ficticio-1",
        modality: "inPerson",
        startAt: 2000,
        endAt: 1000,
        status: "reserved",
      }),
    ).toEqual({
      status: "error",
      error: {
        code: "reservation_invalid_time_range",
        message: "El rango de la reserva debe avanzar en el tiempo.",
      },
    });
  });
});
