import { describe, expect, expectTypeOf, test } from "vitest";
import {
  PRIVACY_BLOCK_SCOPE_VALUES,
  PRIVACY_BLOCK_STATE_VALUES,
  PRIVACY_CONTROL_REFERENCE_MAX_LENGTH,
  PRIVACY_DATA_CATEGORY_VALUES,
  PRIVACY_RESPONSE_DELIVERY_CHANNEL_VALUES,
  PRIVACY_RETENTION_DISPOSITION_VALUES,
  PRIVACY_RETENTION_EXCEPTION_KIND_VALUES,
  doesPrivacyBlockCoverCategory,
  isPrivacyBlockScope,
  isPrivacyDataCategory,
  isPrivacyResponseDeliveryChannel,
  isPrivacyRetentionDisposition,
  isPrivacyRetentionExceptionActive,
  isPrivacyRetentionExceptionKind,
  isValidPrivacyRetentionDays,
  privacyBlockStateAt,
  type PrivacyBlockScope,
  type PrivacyDataCategory,
  type PrivacyResponseDeliveryChannel,
  type PrivacyRetentionDisposition,
  type PrivacyRetentionExceptionKind,
} from "./privacy_controls";
import {
  PRIVACY_BLOCK_SCOPE_VALUES as BARREL_BLOCK_SCOPE_VALUES,
  PRIVACY_DATA_CATEGORY_VALUES as BARREL_DATA_CATEGORY_VALUES,
  PRIVACY_RESPONSE_DELIVERY_CHANNEL_VALUES as BARREL_DELIVERY_CHANNELS,
  PRIVACY_RETENTION_DISPOSITION_VALUES as BARREL_DISPOSITIONS,
  PRIVACY_RETENTION_EXCEPTION_KIND_VALUES as BARREL_EXCEPTION_KINDS,
  privacyBlockStateAt as barrelPrivacyBlockStateAt,
  isPrivacyRetentionExceptionActive as barrelIsExceptionActive,
  type PrivacyBlockScope as BarrelBlockScope,
  type PrivacyDataCategory as BarrelDataCategory,
} from "../index";

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);
const T1 = T0 + 24 * 60 * 60 * 1000;
const T2 = T1 + 24 * 60 * 60 * 1000;

describe("Controles de privacidad: envío, bloqueos y conservación (TI2-151)", () => {
  test("el barrel reexporta las mismas referencias sin duplicar fuentes", () => {
    expect(BARREL_BLOCK_SCOPE_VALUES).toBe(PRIVACY_BLOCK_SCOPE_VALUES);
    expect(BARREL_DATA_CATEGORY_VALUES).toBe(PRIVACY_DATA_CATEGORY_VALUES);
    expect(BARREL_DELIVERY_CHANNELS).toBe(PRIVACY_RESPONSE_DELIVERY_CHANNEL_VALUES);
    expect(BARREL_DISPOSITIONS).toBe(PRIVACY_RETENTION_DISPOSITION_VALUES);
    expect(BARREL_EXCEPTION_KINDS).toBe(PRIVACY_RETENTION_EXCEPTION_KIND_VALUES);
    expect(barrelPrivacyBlockStateAt).toBe(privacyBlockStateAt);
    expect(barrelIsExceptionActive).toBe(isPrivacyRetentionExceptionActive);
    expectTypeOf<BarrelBlockScope>().toEqualTypeOf<PrivacyBlockScope>();
    expectTypeOf<BarrelDataCategory>().toEqualTypeOf<PrivacyDataCategory>();
  });

  test("valida canales de constancia de envío, categorías y alcances de bloqueo", () => {
    expect([...PRIVACY_RESPONSE_DELIVERY_CHANNEL_VALUES]).toEqual([
      "student_app",
      "email",
      "institutional_channel",
    ]);
    expect(isPrivacyResponseDeliveryChannel("student_app")).toBe(true);
    expect(isPrivacyResponseDeliveryChannel("sms")).toBe(false);
    expectTypeOf<PrivacyResponseDeliveryChannel>().toEqualTypeOf<
      "student_app" | "email" | "institutional_channel"
    >();

    expect(PRIVACY_CONTROL_REFERENCE_MAX_LENGTH).toBe(200);
    expect(isPrivacyDataCategory("accompaniments")).toBe(true);
    expect(isPrivacyDataCategory("all_personal_data")).toBe(false);
    expect(isPrivacyBlockScope("all_personal_data")).toBe(true);
    expect(isPrivacyBlockScope("follow_up")).toBe(true);
    expect(isPrivacyBlockScope("unknown")).toBe(false);

    expect(doesPrivacyBlockCoverCategory("all_personal_data", "appointments")).toBe(true);
    expect(doesPrivacyBlockCoverCategory("appointments", "appointments")).toBe(true);
    expect(doesPrivacyBlockCoverCategory("appointments", "follow_up")).toBe(false);
  });

  test("deriva el estado del bloqueo temporal desde startsAt, endsAt y liftedAt sin estado paralelo", () => {
    expect([...PRIVACY_BLOCK_STATE_VALUES]).toEqual(["scheduled", "active", "expired", "lifted"]);
    // Antes de startsAt todavía no rige.
    expect(privacyBlockStateAt({ startsAt: T1, endsAt: T2 }, T0)).toBe("scheduled");
    expect(privacyBlockStateAt({ startsAt: T1, endsAt: T2 }, T1)).toBe("active");
    expect(privacyBlockStateAt({ startsAt: T0, endsAt: T2 }, T1)).toBe("active");
    // El vencimiento es exclusivo: en el instante exacto de endsAt ya está vencido.
    expect(privacyBlockStateAt({ startsAt: T0, endsAt: T2 }, T2)).toBe("expired");
    expect(privacyBlockStateAt({ startsAt: T0, endsAt: T2, liftedAt: T1 }, T0 - 1)).toBe("lifted");
    expect(privacyBlockStateAt({ startsAt: T0, endsAt: T2, liftedAt: T1 }, T1)).toBe("lifted");
    expect(privacyBlockStateAt({ startsAt: T0, endsAt: T2, liftedAt: T1 }, T2 + 1000)).toBe(
      "lifted",
    );
    expect(() => privacyBlockStateAt({ startsAt: T0, endsAt: T2 }, Number.NaN)).toThrow(
      /epoch válido/i,
    );
  });

  test("valida disposición, plazos de conservación positivos y vigencia de excepciones", () => {
    expect([...PRIVACY_RETENTION_DISPOSITION_VALUES]).toEqual(["delete", "anonymize"]);
    expect(isPrivacyRetentionDisposition("delete")).toBe(true);
    expect(isPrivacyRetentionDisposition("archive")).toBe(false);
    expectTypeOf<PrivacyRetentionDisposition>().toEqualTypeOf<"delete" | "anonymize">();

    expect(isValidPrivacyRetentionDays(1)).toBe(true);
    expect(isValidPrivacyRetentionDays(365)).toBe(true);
    expect(isValidPrivacyRetentionDays(0)).toBe(false);
    expect(isValidPrivacyRetentionDays(-10)).toBe(false);
    expect(isValidPrivacyRetentionDays(30.5)).toBe(false);
    expect(isValidPrivacyRetentionDays(Number.NaN)).toBe(false);

    expect([...PRIVACY_RETENTION_EXCEPTION_KIND_VALUES]).toEqual([
      "legal_obligation",
      "open_procedure",
    ]);
    expect(isPrivacyRetentionExceptionKind("legal_obligation")).toBe(true);
    expect(isPrivacyRetentionExceptionKind("convenience")).toBe(false);
    expectTypeOf<PrivacyRetentionExceptionKind>().toEqualTypeOf<
      "legal_obligation" | "open_procedure"
    >();

    // Excepción sin fecha de término rige desde startsAt hasta que se levanta.
    expect(isPrivacyRetentionExceptionActive({ startsAt: T0 }, T0 - 1)).toBe(false);
    expect(isPrivacyRetentionExceptionActive({ startsAt: T0 }, T0)).toBe(true);
    expect(isPrivacyRetentionExceptionActive({ startsAt: T0, liftedAt: T1 }, T1)).toBe(false);
    // Con fecha de término vence de forma exclusiva.
    expect(isPrivacyRetentionExceptionActive({ startsAt: T0, expiresAt: T2 }, T1)).toBe(true);
    expect(isPrivacyRetentionExceptionActive({ startsAt: T0, expiresAt: T2 }, T2)).toBe(false);
    expect(() => isPrivacyRetentionExceptionActive({ startsAt: T0 }, 0)).toThrow(/epoch válido/i);
  });
});
