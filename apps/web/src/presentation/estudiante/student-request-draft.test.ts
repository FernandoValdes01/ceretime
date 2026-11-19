// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import {
  clearAllRequestDrafts,
  clearRequestDraft,
  emptyRequestDraft,
  findMissingFields,
  loadRequestDraft,
  saveRequestDraft,
  toRequestContentSubmission,
  type RequestDraft,
} from "./student-request-draft.ts";

/** Pruebas del borrador de solicitud (TI2-149). Todos los datos son ficticios. */

const TITULAR = "estudiante@alu.uct.cl";

function borradorCompleto(overrides: Partial<RequestDraft> = {}): RequestDraft {
  return {
    ...emptyRequestDraft(),
    needSummary: "Necesidad ficticia de prueba",
    expectedOutcome: "Resultado ficticio esperado",
    accessNeedIds: ["support-person", "written-communication"],
    modalityPreference: "online",
    preferredWeekdays: [0, 3, 1],
    preferredAccessibleInformationChannel: "Correo con letra grande",
    idempotencyKey: "clave-ficticia",
    ...overrides,
  };
}

afterEach(() => {
  window.sessionStorage.clear();
});

describe("TI2-149: campos que faltan", () => {
  test("un borrador vacío señala todos los obligatorios y no el horario opcional", () => {
    expect(Object.keys(findMissingFields(emptyRequestDraft(), "student")).sort()).toEqual(
      [
        "accessNeeds",
        "expectedOutcome",
        "modalityPreference",
        "needSummary",
        "preferredAccessibleInformationChannel",
        "preferredWeekdays",
      ].sort(),
    );
  });

  test("solo espacios en un texto obligatorio cuenta como vacío", () => {
    expect(findMissingFields(borradorCompleto({ needSummary: "   " }), "student")).toEqual({
      needSummary: "Describe la barrera o necesidad.",
    });
  });

  test("el texto de «Otra» basta como necesidad de acceso", () => {
    expect(
      findMissingFields(
        borradorCompleto({ accessNeedIds: [], otherAccessNeed: "Apoyo ficticio" }),
        "student",
      ),
    ).toEqual({});
  });

  test("en la voz del personal los mensajes hablan del estudiante (TI2-158)", () => {
    const errores = findMissingFields(
      borradorCompleto({ expectedOutcome: "", preferredAccessibleInformationChannel: "" }),
      "staff",
    );
    expect(errores).toEqual({
      expectedOutcome: "Indica qué espera el estudiante de CERETI.",
      preferredAccessibleInformationChannel:
        "Indica cómo prefiere recibir información el estudiante.",
    });
  });

  test("un horario a medias se señala; completo o vacío no", () => {
    expect(
      findMissingFields(borradorCompleto({ availableFrom: "09:00" }), "student"),
    ).toHaveProperty("availableTime");
    expect(
      findMissingFields(
        borradorCompleto({ availableFrom: "09:00", availableTo: "13:00" }),
        "student",
      ),
    ).toEqual({});
  });
});

describe("TI2-149: envío desde el borrador", () => {
  test("arma la forma completa en el orden del formulario y omite lo opcional vacío", () => {
    expect(toRequestContentSubmission(borradorCompleto({ otherAccessNeed: "  " }))).toEqual({
      needSummary: "Necesidad ficticia de prueba",
      expectedOutcome: "Resultado ficticio esperado",
      accessNeeds: [
        { id: "written-communication", label: "Comunicación escrita" },
        { id: "support-person", label: "Persona de apoyo" },
      ],
      modalityPreference: "online",
      generalAvailability: { preferredWeekdays: [1, 3, 0] },
      preferredAccessibleInformationChannel: "Correo con letra grande",
      idempotencyKey: "clave-ficticia",
    });
  });

  test("incluye el texto libre y el horario cuando están", () => {
    const submission = toRequestContentSubmission(
      borradorCompleto({
        otherAccessNeed: "Apoyo ficticio",
        availableFrom: "09:00",
        availableTo: "13:00",
      }),
    );
    expect(submission.otherAccessNeed).toBe("Apoyo ficticio");
    expect(submission.generalAvailability.preferredTimeRange).toEqual({
      from: "09:00",
      to: "13:00",
    });
  });
});

describe("TI2-149: conservación del borrador", () => {
  test("cada borrador nuevo trae su propia clave de idempotencia", () => {
    expect(emptyRequestDraft().idempotencyKey).not.toBe(emptyRequestDraft().idempotencyKey);
  });

  test("lo guardado se recupera con la misma clave y solo para la misma cuenta", () => {
    const draft = borradorCompleto();
    saveRequestDraft(TITULAR, draft);
    expect(loadRequestDraft(TITULAR)).toEqual(draft);
    expect(loadRequestDraft("otra@alu.uct.cl").needSummary).toBe("");
  });

  test("al borrarlo, la próxima solicitud empieza vacía con otra clave", () => {
    saveRequestDraft(TITULAR, borradorCompleto());
    clearRequestDraft(TITULAR);
    const next = loadRequestDraft(TITULAR);
    expect(next.needSummary).toBe("");
    expect(next.idempotencyKey).not.toBe("clave-ficticia");
  });

  test("un contenido dañado se descarta sin romper el formulario", () => {
    window.sessionStorage.setItem(`cereti:solicitud-borrador:${TITULAR}`, "{no es json");
    expect(loadRequestDraft(TITULAR).needSummary).toBe("");
    window.sessionStorage.setItem(
      `cereti:solicitud-borrador:${TITULAR}`,
      JSON.stringify({ ...borradorCompleto(), modalityPreference: "sin-modalidad" }),
    );
    expect(loadRequestDraft(TITULAR).needSummary).toBe("");
  });

  test("un borrador sin clave de idempotencia se descarta y el nuevo trae una", () => {
    window.sessionStorage.setItem(
      `cereti:solicitud-borrador:${TITULAR}`,
      JSON.stringify({ ...borradorCompleto(), idempotencyKey: "" }),
    );
    const draft = loadRequestDraft(TITULAR);
    expect(draft.needSummary).toBe("");
    expect(draft.idempotencyKey).not.toBe("");
  });

  test("al cerrar sesión se borran los borradores de todas las cuentas y nada más", () => {
    saveRequestDraft(TITULAR, borradorCompleto());
    saveRequestDraft("otra@alu.uct.cl", borradorCompleto());
    window.sessionStorage.setItem("otra-clave", "se conserva");

    clearAllRequestDrafts();

    expect(window.sessionStorage.getItem(`cereti:solicitud-borrador:${TITULAR}`)).toBeNull();
    expect(window.sessionStorage.getItem("cereti:solicitud-borrador:otra@alu.uct.cl")).toBeNull();
    expect(window.sessionStorage.getItem("otra-clave")).toBe("se conserva");
  });
});
