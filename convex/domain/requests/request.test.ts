import { describe, expect, expectTypeOf, test } from "vitest";
import { PERSISTABLE_REQUEST_STATES, REQUEST_STATE_LABELS } from "./state";
import {
  ACCESS_NEED_ID_MAX_LENGTH,
  ACCESS_NEED_LABEL_MAX_LENGTH,
  ACCESS_NEED_SELECTIONS_MAX,
  ACCESS_NEEDS_MAX_LENGTH,
  isAccessNeedsWithinLimit,
  LEGACY_REQUEST_PROVENANCE_CHANNEL,
  REQUEST_PROVENANCE_CHANNEL_VALUES,
  requestProvenanceChannelOf,
  toAccessNeedsText,
  toAccompanimentRequest,
  toRequestExchange,
  toRequestSubmission,
  toStoredRequestFields,
  type AccompanimentRequestContent,
} from "./request";
import {
  ACCESS_NEEDS_MAX_LENGTH as BARREL_MAX_LENGTH,
  type AccompanimentRequest as BarrelAccompanimentRequest,
} from "../index";

describe("AccompanimentRequestContent (TI2-8)", () => {
  test("describe la solicitud de Sprint 1 completa", () => {
    expectTypeOf<AccompanimentRequestContent>().toHaveProperty("needSummary");
    expectTypeOf<AccompanimentRequestContent>().toHaveProperty("expectedOutcome");
    expectTypeOf<AccompanimentRequestContent>().toHaveProperty("accessNeeds");
    expectTypeOf<AccompanimentRequestContent>().toHaveProperty("modalityPreference");
    expectTypeOf<AccompanimentRequestContent>().toHaveProperty("generalAvailability");
    expectTypeOf<AccompanimentRequestContent>().toHaveProperty(
      "preferredAccessibleInformationChannel",
    );
  });

  test("el espejo manual del payload de Mobile se tipa sin conversión manual", () => {
    expectTypeOf<MobileSubmitPayload>().toMatchTypeOf<AccompanimentRequestContent>();
  });
});

/**
 * Espejo manual de la forma de `SubmitStudentRequestCommand` de Mobile, no
 * el tipo real: los modelos de Mobile son provisionales y pertenecen a TI4,
 * así que esta suite no depende de ellos. Si Mobile cambia, este espejo no
 * lo detecta; TI4-12 lo reemplaza por la comprobación cableada.
 */
type MobileSubmitPayload = {
  readonly needSummary: string;
  readonly expectedOutcome: string;
  readonly accessNeeds: readonly { readonly id: string; readonly label: string }[];
  readonly otherAccessNeed?: string;
  readonly generalAvailability: {
    readonly preferredWeekdays: readonly number[];
    readonly preferredTimeRange?: { readonly from: string; readonly to: string };
  };
  readonly modalityPreference: "inPerson" | "online";
  readonly preferredAccessibleInformationChannel: string;
};

/** Fila ficticia de `requests` con el estado indicado. */
const rowWith = (status: string) => ({
  _id: "request-id",
  studentId: "student-id",
  status,
  accessNeeds: "Necesidad ficticia",
  createdAt: 1000,
});

describe("toAccompanimentRequest (TI2-8, TI2-85)", () => {
  test("adapta una fila existente con cada estado persistible, cierres incluidos", () => {
    for (const status of PERSISTABLE_REQUEST_STATES) {
      expect(
        toAccompanimentRequest({
          _id: "request-id",
          studentId: "student-id",
          status,
          accessNeeds: "Necesidad ficticia",
          createdAt: 1000,
        }),
      ).toEqual({
        _id: "request-id",
        studentId: "student-id",
        status,
        accessNeeds: "Necesidad ficticia",
        createdAt: 1000,
      });
    }
  });

  test("rechaza una fila con estado desconocido en vez de propagarla", () => {
    expect(() =>
      toAccompanimentRequest({
        _id: "request-id",
        studentId: "student-id",
        status: "under_review_typo",
        accessNeeds: "Necesidad ficticia",
        createdAt: 1000,
      }),
    ).toThrow("Estado de solicitud desconocido");
  });

  test("rechaza una fila derivada, estado sin reglas ni proyección acordada", () => {
    expect(() => toAccompanimentRequest(rowWith("referred"))).toThrow(
      "Estado de solicitud desconocido",
    );
  });

  test("la entidad publica se importa desde el barrel", () => {
    const entity: BarrelAccompanimentRequest = {
      _id: "request-id",
      studentId: "student-id",
      status: "received",
      accessNeeds: "Necesidad ficticia",
      createdAt: 1000,
    };
    expect(entity.status).toBe("received");
  });
});

describe("toAccessNeedsText (TI2-26)", () => {
  test("recorta el texto con contenido válido", () => {
    expect(toAccessNeedsText("  Necesidad ficticia  ")).toBe("Necesidad ficticia");
  });

  test("rechaza el texto vacío o solo con espacios", () => {
    expect(toAccessNeedsText("")).toBeNull();
    expect(toAccessNeedsText("   ")).toBeNull();
  });

  test("el tope acordado se comparte desde el barrel sin duplicarlo", () => {
    expect(ACCESS_NEEDS_MAX_LENGTH).toBe(2000);
    expect(BARREL_MAX_LENGTH).toBe(ACCESS_NEEDS_MAX_LENGTH);
  });
});

describe("ACCESS_NEEDS_MAX_LENGTH (TI2-23)", () => {
  test("el tope definitivo es 2000 y sale por el barrel", () => {
    expect(ACCESS_NEEDS_MAX_LENGTH).toBe(2000);
    expect(BARREL_MAX_LENGTH).toBe(2000);
    expect(isAccessNeedsWithinLimit("a".repeat(2000))).toBe(true);
    expect(isAccessNeedsWithinLimit("a".repeat(2001))).toBe(false);
  });
});

describe("toStoredRequestFields (TI2-23)", () => {
  const contenido: AccompanimentRequestContent = {
    needSummary: "Necesidad ficticia",
    expectedOutcome: "Resultado ficticio",
    accessNeeds: [
      { id: "1", label: "Intérprete" },
      { id: "2", label: "Sala silenciosa" },
    ],
    modalityPreference: "inPerson",
    generalAvailability: { preferredWeekdays: [1, 3] },
    preferredAccessibleInformationChannel: "correo",
    otherAccessNeed: "Silla cerca de la puerta",
  };

  test("une etiquetas y texto libre con salto de línea", () => {
    const resultado = toStoredRequestFields(contenido);
    expect(resultado).toEqual({
      status: "ok",
      data: { accessNeeds: "Intérprete\nSala silenciosa\nSilla cerca de la puerta" },
    });
  });

  test("omite el texto libre vacío sin dejar líneas de más", () => {
    const resultado = toStoredRequestFields({ ...contenido, otherAccessNeed: "   " });
    expect(resultado).toEqual({
      status: "ok",
      data: { accessNeeds: "Intérprete\nSala silenciosa" },
    });
  });

  test("rechaza el exceso con error estable en vez de truncar", () => {
    const resultado = toStoredRequestFields({
      ...contenido,
      accessNeeds: [{ id: "1", label: "a".repeat(2001) }],
      otherAccessNeed: undefined,
    });
    expect(resultado).toEqual({
      status: "error",
      error: {
        code: "access_needs_too_long",
        message: "El texto de necesidades de acceso supera el máximo permitido.",
      },
    });
  });

  test("rechaza el arreglo vacío con error estable en vez de devolver texto vacío", () => {
    const resultado = toStoredRequestFields({
      ...contenido,
      accessNeeds: [],
      otherAccessNeed: undefined,
    });
    expect(resultado).toEqual({
      status: "error",
      error: {
        code: "access_needs_empty",
        message: "Se requiere describir la necesidad de acceso.",
      },
    });
  });
});

describe("REQUEST_STATE_LABELS (TI2-8)", () => {
  test("traduce todos los estados al español para Web y Mobile", () => {
    expect(REQUEST_STATE_LABELS.received).toBe("Recibida");
    expect(REQUEST_STATE_LABELS.under_review).toBe("En revisión");
    expect(REQUEST_STATE_LABELS.awaiting_information_or_acceptance).toBe(
      "Esperando información o aceptación",
    );
    expect(REQUEST_STATE_LABELS.accepted).toBe("Aceptada");
    expect(REQUEST_STATE_LABELS.referred).toBe("Derivada");
    expect(REQUEST_STATE_LABELS.closed_without_accompaniment).toBe("Cerrada sin acompañamiento");
    expect(REQUEST_STATE_LABELS.cancelled).toBe("Cancelada");
  });
});

describe("Procedencia de la solicitud (TI2-135)", () => {
  test("declara los dos canales y el del Estudiante para las filas anteriores", () => {
    expect(REQUEST_PROVENANCE_CHANNEL_VALUES).toEqual(["student", "official_channel"]);
    expect(LEGACY_REQUEST_PROVENANCE_CHANNEL).toBe("student");
    expect(REQUEST_PROVENANCE_CHANNEL_VALUES).toContain(LEGACY_REQUEST_PROVENANCE_CHANNEL);
  });

  test("una fila sin procedencia se lee como la del Estudiante", () => {
    expect(requestProvenanceChannelOf({})).toBe("student");
  });

  test("una fila con procedencia conserva su canal", () => {
    const official = requestProvenanceChannelOf({ provenance: { channel: "official_channel" } });
    expect(official).toBe("official_channel");
    expect(requestProvenanceChannelOf({ provenance: { channel: "student" } })).toBe("student");
  });
});

describe("toRequestExchange (TI2-141)", () => {
  const asked = (reason: string) =>
    ({ from: "under_review", to: "awaiting_information_or_acceptance", reason }) as const;
  const answered = (reason: string) =>
    ({ from: "awaiting_information_or_acceptance", to: "under_review", reason }) as const;
  const taken = { from: "received", to: "under_review" } as const;

  test("mientras espera entrega lo pedido más reciente, sin la respuesta a un pedido anterior", () => {
    const changes = [asked("Segundo pedido"), answered("Respuesta"), asked("Primer pedido"), taken];
    expect(toRequestExchange("awaiting_information_or_acceptance", changes)).toEqual({
      informationRequest: "Segundo pedido",
    });
  });

  test("tras responder el pedido nuevo entrega esa respuesta, no la anterior", () => {
    const changes = [
      answered("Segunda respuesta"),
      asked("Segundo pedido"),
      answered("Primera respuesta"),
      asked("Primer pedido"),
      taken,
    ];
    expect(toRequestExchange("under_review", changes)).toEqual({
      informationResponse: "Segunda respuesta",
    });
  });

  test("una respuesta cuyo pedido quedó fuera de lo leído se entrega", () => {
    expect(toRequestExchange("under_review", [answered("Respuesta")])).toEqual({
      informationResponse: "Respuesta",
    });
  });

  test("fuera de la espera no entrega lo pedido: ya no está pendiente", () => {
    const changes = [answered("Respuesta"), asked("Pedido"), taken];
    expect(toRequestExchange("under_review", changes)).toEqual({
      informationResponse: "Respuesta",
    });
    expect(toRequestExchange("accepted", changes)).toEqual({ informationResponse: "Respuesta" });
  });

  test("la toma no cuenta como respuesta y sin intercambio no entrega nada", () => {
    expect(toRequestExchange("under_review", [taken])).toEqual({});
    expect(toRequestExchange("received", [])).toEqual({});
  });
});

describe("toRequestSubmission (TI2-141)", () => {
  const valid = {
    needSummary: " Necesidad ficticia ",
    expectedOutcome: " Resultado ficticio ",
    accessNeeds: [{ id: " written ", label: " Comunicación escrita " }],
    otherAccessNeed: "   ",
    modalityPreference: "inPerson",
    generalAvailability: { preferredWeekdays: [0, 6] },
    preferredAccessibleInformationChannel: " Correo ",
    idempotencyKey: "clave",
  } as const;

  test("recorta los textos y omite el texto libre vacío", () => {
    expect(toRequestSubmission(valid)).toEqual({
      status: "ok",
      data: {
        needSummary: "Necesidad ficticia",
        expectedOutcome: "Resultado ficticio",
        accessNeeds: [{ id: "written", label: "Comunicación escrita" }],
        modalityPreference: "inPerson",
        generalAvailability: { preferredWeekdays: [0, 6] },
        preferredAccessibleInformationChannel: "Correo",
        idempotencyKey: "clave",
      },
    });
  });

  test("el texto libre basta como necesidad cuando no hay selecciones", () => {
    const result = toRequestSubmission({
      ...valid,
      accessNeeds: [],
      otherAccessNeed: "Persona de apoyo",
    });
    expect(result).toMatchObject({ status: "ok", data: { otherAccessNeed: "Persona de apoyo" } });
  });

  test("un rechazo usa un código estable y un mensaje para corregir", () => {
    expect(toRequestSubmission({ ...valid, needSummary: "" })).toEqual({
      status: "error",
      error: { code: "request_fields_invalid", message: "Describe la barrera o necesidad." },
    });
  });

  test("un identificador de necesidad más largo que su tope se rechaza", () => {
    const id = "x".repeat(ACCESS_NEED_ID_MAX_LENGTH);
    const need = (value: string) => [{ id: value, label: "Comunicación escrita" }];
    expect(toRequestSubmission({ ...valid, accessNeeds: need(id) })).toMatchObject({
      status: "ok",
    });
    expect(toRequestSubmission({ ...valid, accessNeeds: need(`${id}x`) })).toEqual({
      status: "error",
      error: {
        code: "request_fields_invalid",
        message: `El identificador de una necesidad de acceso supera el máximo permitido (${ACCESS_NEED_ID_MAX_LENGTH} caracteres).`,
      },
    });
  });

  test("las necesidades de acceso conservan sus códigos de Sprint 1", () => {
    expect(toRequestSubmission({ ...valid, accessNeeds: [] })).toEqual({
      status: "error",
      error: {
        code: "access_needs_empty",
        message: "Se requiere describir la necesidad de acceso.",
      },
    });

    // 20 nombres válidos de 200 caracteres superan juntos el tope del texto unido.
    const accessNeeds = Array.from({ length: ACCESS_NEED_SELECTIONS_MAX }, (_, index) => ({
      id: `need-${index}`,
      label: `${index}`.padEnd(ACCESS_NEED_LABEL_MAX_LENGTH, "x"),
    }));
    expect(toRequestSubmission({ ...valid, accessNeeds })).toEqual({
      status: "error",
      error: {
        code: "access_needs_too_long",
        message: `Las necesidades de acceso y el texto adicional superan juntos el máximo permitido (${ACCESS_NEEDS_MAX_LENGTH} caracteres).`,
      },
    });
  });

  test.each([
    [{ preferredWeekdays: [1.5] }, "Los días disponibles van de 0"],
    [{ preferredWeekdays: [-1] }, "Los días disponibles van de 0"],
    [{ preferredWeekdays: [1], preferredTimeRange: { from: "24:00", to: "25:00" } }, "HH:mm"],
    [
      { preferredWeekdays: [1], preferredTimeRange: { from: "10:00", to: "10:00" } },
      "antes de terminar",
    ],
  ])("rechaza la disponibilidad %j", (generalAvailability, message) => {
    expect(toRequestSubmission({ ...valid, generalAvailability })).toMatchObject({
      status: "error",
      error: { message: expect.stringContaining(message) },
    });
  });
});
