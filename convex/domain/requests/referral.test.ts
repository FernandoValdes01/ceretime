import { assert, describe, expect, test } from "vitest";
import {
  REFERRAL_REASON_MAX_LENGTH,
  REFERRAL_STEP_REJECTION_CAUSES,
  REFERRAL_UNIT_MAX_LENGTH,
  recordReferralAcceptance,
  recordReferralContact,
  referralAllowsAccompaniment,
  toDestinationUnit,
  toOfficialReceivedAt,
  toOriginUnit,
  toReferralReason,
  type IncomingReferral,
} from "./referral";

/** Datos ficticios: ninguna unidad ni persona es real. */
const referral: IncomingReferral = { originUnit: "Unidad ficticia", referredAt: 1000 };
const contact = { contactedBy: "profesional-ficticio-1", contactedAt: 2000 };

describe("toOriginUnit y toDestinationUnit (TI2-143)", () => {
  test("recortan el nombre de la unidad", () => {
    expect(toOriginUnit("  Unidad ficticia  ")).toEqual({ status: "ok", data: "Unidad ficticia" });
    expect(toDestinationUnit("  Otra unidad  ")).toEqual({ status: "ok", data: "Otra unidad" });
  });

  test.each(["", "   "])("rechazan %j con un mensaje que nombra qué falta", (raw) => {
    expect(toOriginUnit(raw)).toEqual({
      status: "error",
      error: {
        code: "request_fields_invalid",
        message: "Indica la unidad que derivó al estudiante.",
      },
    });
    expect(toDestinationUnit(raw)).toEqual({
      status: "error",
      error: {
        code: "request_fields_invalid",
        message: "Indica la unidad a la que se deriva al estudiante.",
      },
    });
  });

  test("aceptan el tope exacto y rechazan el exceso sin truncar", () => {
    const atLimit = "u".repeat(REFERRAL_UNIT_MAX_LENGTH);
    expect(toOriginUnit(atLimit)).toEqual({ status: "ok", data: atLimit });
    expect(toDestinationUnit(atLimit)).toEqual({ status: "ok", data: atLimit });
    expect(toOriginUnit(`${atLimit}u`)).toMatchObject({
      status: "error",
      error: { code: "request_fields_invalid" },
    });
    expect(toDestinationUnit(`${atLimit}u`)).toMatchObject({
      status: "error",
      error: { code: "request_fields_invalid" },
    });
  });
});

describe("toReferralReason (TI2-143)", () => {
  test("acepta el tope exacto y rechaza el exceso sin truncar", () => {
    const atLimit = "r".repeat(REFERRAL_REASON_MAX_LENGTH);
    expect(toReferralReason(atLimit)).toEqual({ status: "ok", data: atLimit });
    expect(toReferralReason(`${atLimit}r`)).toMatchObject({
      status: "error",
      error: { code: "request_fields_invalid" },
    });
  });
});

describe("toOfficialReceivedAt (TI2-143)", () => {
  test("sin fecha, la recepción es el instante del registro", () => {
    expect(toOfficialReceivedAt(undefined, 5000)).toEqual({ status: "ok", data: 5000 });
  });

  test("acepta una fecha pasada o igual al instante del registro", () => {
    expect(toOfficialReceivedAt(4000, 5000)).toEqual({ status: "ok", data: 4000 });
    expect(toOfficialReceivedAt(5000, 5000)).toEqual({ status: "ok", data: 5000 });
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])("rechaza %s como fecha", (raw) => {
    expect(toOfficialReceivedAt(raw, 5000)).toEqual({
      status: "error",
      error: { code: "request_fields_invalid", message: "La fecha de recepción no es válida." },
    });
  });

  test("rechaza una fecha futura", () => {
    expect(toOfficialReceivedAt(5001, 5000)).toEqual({
      status: "error",
      error: {
        code: "request_fields_invalid",
        message: "La fecha de recepción no puede ser futura.",
      },
    });
  });
});

describe("recordReferralContact (TI2-143)", () => {
  test("guarda quién contactó y cuándo, sin tocar el resto", () => {
    expect(recordReferralContact(referral, contact)).toEqual({
      status: "applied",
      referral: { ...referral, ...contact },
    });
  });

  test("una solicitud que no viene de una derivación no registra contacto", () => {
    expect(recordReferralContact(undefined, contact)).toEqual({
      status: "rejected",
      cause: "not_a_referral",
    });
  });

  test("el contacto ya registrado no se reescribe", () => {
    const first = recordReferralContact(referral, contact);
    assert(first.status === "applied");
    expect(
      recordReferralContact(first.referral, { contactedBy: "otra-persona", contactedAt: 9000 }),
    ).toEqual({ status: "rejected", cause: "already_contacted" });
  });
});

describe("recordReferralAcceptance (TI2-143)", () => {
  const contacted: IncomingReferral = { ...referral, ...contact };

  test("tras el contacto, guarda la fecha de la aceptación", () => {
    expect(recordReferralAcceptance(contacted, 3000)).toEqual({
      status: "applied",
      referral: { ...contacted, acceptedAt: 3000 },
    });
  });

  test("sin contacto previo se rechaza", () => {
    expect(recordReferralAcceptance(referral, 3000)).toEqual({
      status: "rejected",
      cause: "contact_required",
    });
  });

  test("una solicitud que no viene de una derivación no registra aceptación", () => {
    expect(recordReferralAcceptance(undefined, 3000)).toEqual({
      status: "rejected",
      cause: "not_a_referral",
    });
  });

  test("la aceptación ya registrada no se reescribe", () => {
    expect(recordReferralAcceptance({ ...contacted, acceptedAt: 3000 }, 9000)).toEqual({
      status: "rejected",
      cause: "already_accepted",
    });
  });

  test("cada causa declarada tiene un intento que la provoca", () => {
    const provoked = [
      recordReferralContact(undefined, contact),
      recordReferralContact(contacted, contact),
      recordReferralAcceptance(referral, 3000),
      recordReferralAcceptance({ ...contacted, acceptedAt: 3000 }, 9000),
    ].map((result) => (result.status === "rejected" ? result.cause : null));
    expect(provoked).toEqual([...REFERRAL_STEP_REJECTION_CAUSES]);
  });
});

describe("referralAllowsAccompaniment (TI2-143)", () => {
  test("una solicitud sin derivación de entrada no tiene esta condición", () => {
    expect(referralAllowsAccompaniment(undefined)).toBe(true);
  });

  test("una derivación sin contacto ni aceptación no abre acompañamiento", () => {
    expect(referralAllowsAccompaniment(referral)).toBe(false);
  });

  test("una derivación contactada pero sin aceptación no abre acompañamiento", () => {
    expect(referralAllowsAccompaniment({ ...referral, ...contact })).toBe(false);
  });

  test("una aceptación sin contacto guardado no basta", () => {
    expect(referralAllowsAccompaniment({ acceptedAt: 3000 })).toBe(false);
  });

  test("con contacto y aceptación sí abre", () => {
    expect(referralAllowsAccompaniment({ ...referral, ...contact, acceptedAt: 3000 })).toBe(true);
  });
});
