import { describe, expect, test } from "vitest";
import {
  ONLINE_ACCESS_ALLOWED_HOSTS,
  ONLINE_ACCESS_LINK_MAX_LENGTH,
  decideOnlineAccessUpdate,
  normalizeOnlineAccessLink,
  normalizeOnlineSupports,
  toOnlineAccessView,
  type OnlineAccessSubject,
} from "./online_access";
import {
  decideOnlineAccessUpdate as barrelDecide,
  normalizeOnlineAccessLink as barrelNormalize,
  toOnlineAccessView as barrelView,
} from "../index";
import type { AppointmentStatus } from "./appointment";

const RESPONSIBLE = "profesional-ficticio-1";
const SECOND = "profesional-ficticio-2";
const STUDENT = "estudiante-ficticio-1";
const LINK = "https://meet.google.com/sol-casa-pan";
const OTHER_LINK = "https://meet.google.com/mar-roca-sal";

function subject(overrides: Partial<OnlineAccessSubject> = {}): OnlineAccessSubject {
  return {
    studentId: STUDENT,
    professionalId: RESPONSIBLE,
    additionalProfessionalIds: [SECOND],
    modality: "online",
    status: "scheduled",
    ...overrides,
  };
}

describe("Enlace privado de la atención en línea (TI2-142)", () => {
  test("sale por el barrel sin duplicar la fuente", () => {
    expect(barrelNormalize).toBe(normalizeOnlineAccessLink);
    expect(barrelDecide).toBe(decideOnlineAccessUpdate);
    expect(barrelView).toBe(toOnlineAccessView);
    expect([...ONLINE_ACCESS_ALLOWED_HOSTS]).toEqual(["meet.google.com"]);
  });

  test("acepta un enlace de Meet y lo deja en forma canónica", () => {
    for (const raw of [
      LINK,
      `  ${LINK}  `,
      "https://MEET.google.com/SOL-CASA-PAN",
      `${LINK}/`,
      `${LINK}?origen=copia&cuenta=1`,
      `${LINK}#ingreso`,
    ]) {
      expect(normalizeOnlineAccessLink(raw)).toEqual({ status: "valid", link: LINK });
    }
  });

  test("rechaza vacío, exceso y texto que no es URL", () => {
    expect(normalizeOnlineAccessLink("  ")).toEqual({ status: "rejected", cause: "link_required" });
    expect(
      normalizeOnlineAccessLink(`${LINK}?${"a".repeat(ONLINE_ACCESS_LINK_MAX_LENGTH)}`),
    ).toEqual({ status: "rejected", cause: "link_too_long" });
    expect(normalizeOnlineAccessLink("meet.google.com/sol-casa-pan")).toEqual({
      status: "rejected",
      cause: "link_malformed",
    });
  });

  test("exige https", () => {
    for (const raw of ["http://meet.google.com/sol-casa-pan", "javascript:alert(1)"]) {
      expect(normalizeOnlineAccessLink(raw)).toEqual({
        status: "rejected",
        cause: "link_not_https",
      });
    }
  });

  test("exige el dominio exacto, sin credenciales ni puerto", () => {
    for (const raw of [
      "https://zoom.us/j/123456789",
      "https://meet.google.com.example.org/sol-casa-pan",
      "https://evil-meet.google.com/sol-casa-pan",
      "https://google.com/sol-casa-pan",
      "https://usuario@meet.google.com/sol-casa-pan",
      "https://usuario:clave@meet.google.com/sol-casa-pan",
      "https://meet.google.com:8443/sol-casa-pan",
    ]) {
      expect(normalizeOnlineAccessLink(raw)).toEqual({
        status: "rejected",
        cause: "link_host_not_allowed",
      });
    }
  });

  test("exige un código de reunión, no una sala genérica ni otra ruta", () => {
    for (const raw of [
      "https://meet.google.com/",
      "https://meet.google.com/landing",
      "https://meet.google.com/sol-casa-pan/extra",
      "https://meet.google.com/solcasapan",
      "https://meet.google.com/so1-casa-pan",
    ]) {
      expect(normalizeOnlineAccessLink(raw)).toEqual({
        status: "rejected",
        cause: "link_meeting_code_invalid",
      });
    }
  });
});

describe("Agregar o reemplazar el enlace (TI2-142)", () => {
  test("el responsable o un profesional adicional lo agregan cuando está pendiente", () => {
    for (const actor of [RESPONSIBLE, SECOND]) {
      expect(decideOnlineAccessUpdate(subject(), actor, `${LINK}?origen=copia`)).toEqual({
        status: "applied",
        link: LINK,
        change: "added",
      });
    }
  });

  test("distingue reemplazo de reintento con el mismo enlace", () => {
    const withLink = subject({ privateAccessReference: LINK });
    expect(decideOnlineAccessUpdate(withLink, RESPONSIBLE, OTHER_LINK)).toEqual({
      status: "applied",
      link: OTHER_LINK,
      change: "replaced",
    });
    expect(decideOnlineAccessUpdate(withLink, RESPONSIBLE, `${LINK}#otra`)).toEqual({
      status: "applied",
      link: LINK,
      change: "unchanged",
    });
  });

  test("un actor ajeno se rechaza antes de mirar la atención o el enlace", () => {
    for (const actor of [STUDENT, "practicante-ficticio-1", "profesional-ficticio-9", " "]) {
      expect(
        decideOnlineAccessUpdate(subject({ modality: "inPerson" }), actor, "no es un enlace"),
      ).toEqual({ status: "rejected", cause: "actor_not_professional" });
    }
  });

  test("solo procede en línea y mientras la atención siga vigente", () => {
    expect(decideOnlineAccessUpdate(subject({ modality: "inPerson" }), RESPONSIBLE, LINK)).toEqual({
      status: "rejected",
      cause: "not_online",
    });
    expect(
      decideOnlineAccessUpdate(subject({ status: "rescheduled" }), RESPONSIBLE, LINK).status,
    ).toBe("applied");
    const closed: readonly AppointmentStatus[] = [
      "completed",
      "cancelled_by_student",
      "cancelled_by_cereti",
      "no_show",
      "no_show_justified",
      "no_show_unjustified",
    ];
    for (const status of closed) {
      expect(decideOnlineAccessUpdate(subject({ status }), RESPONSIBLE, LINK)).toEqual({
        status: "rejected",
        cause: "not_actionable",
      });
    }
  });

  test("un enlace inválido devuelve la causa del enlace", () => {
    expect(
      decideOnlineAccessUpdate(subject(), RESPONSIBLE, "http://meet.google.com/sol-casa-pan"),
    ).toEqual({ status: "rejected", cause: "link_not_https" });
  });
});

describe("Entrega del enlace a los participantes (TI2-142)", () => {
  test("estudiante y profesionales ven el enlace pendiente o disponible", () => {
    for (const viewer of [STUDENT, RESPONSIBLE, SECOND]) {
      expect(toOnlineAccessView(subject(), viewer)).toEqual({ status: "pending" });
      expect(toOnlineAccessView(subject({ privateAccessReference: LINK }), viewer)).toEqual({
        status: "available",
        link: LINK,
      });
    }
  });

  test("quien no participa no recibe nada, ni siquiera si hay enlace", () => {
    for (const viewer of [
      "practicante-ficticio-1",
      "administrador-ficticio-1",
      "estudiante-ficticio-2",
    ]) {
      expect(toOnlineAccessView(subject({ privateAccessReference: LINK }), viewer)).toBeNull();
    }
  });

  test("presencial o atención que ya no está vigente no entrega enlace", () => {
    expect(toOnlineAccessView(subject({ modality: "inPerson" }), STUDENT)).toEqual({
      status: "not_applicable",
    });
    expect(
      toOnlineAccessView(
        subject({ status: "cancelled_by_cereti", privateAccessReference: LINK }),
        STUDENT,
      ),
    ).toEqual({ status: "not_applicable" });
  });
});

describe("Apoyos de la atención en línea (TI2-142)", () => {
  const captions = { id: "subtítulos-ficticios", label: "Subtítulos (ficticio)" };
  const interpreter = { id: "interprete-ficticio", label: "Intérprete (ficticio)" };

  test("recorta, conserva el primero de cada identificador y admite lista vacía", () => {
    expect(
      normalizeOnlineSupports("online", [
        { id: ` ${captions.id} `, label: ` ${captions.label}` },
        interpreter,
        { id: captions.id, label: "Otra etiqueta" },
      ]),
    ).toEqual({ status: "valid", supports: [captions, interpreter] });
    expect(normalizeOnlineSupports("online", [])).toEqual({ status: "valid", supports: [] });
  });

  test("rechaza apoyos sin identificador o etiqueta", () => {
    expect(normalizeOnlineSupports("online", [{ id: " ", label: "Sin id" }])).toEqual({
      status: "rejected",
      cause: "support_invalid",
    });
    expect(normalizeOnlineSupports("online", [{ id: "x", label: "" }])).toEqual({
      status: "rejected",
      cause: "support_invalid",
    });
  });

  test("en presencial los apoyos van en el espacio, no en la atención", () => {
    expect(normalizeOnlineSupports("inPerson", [captions])).toEqual({
      status: "rejected",
      cause: "not_online",
    });
    expect(normalizeOnlineSupports("inPerson", [])).toEqual({ status: "valid", supports: [] });
  });
});
