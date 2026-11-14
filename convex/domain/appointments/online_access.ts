/**
 * Acceso privado de la atención en línea (TI2-142, decisión del 08/11/2026).
 *
 * Dominio puro: no importa Convex, React ni Expo. Un Profesional de la
 * atención agrega un enlace de Google Meet institucional; CERETI lo guarda en
 * esa atención y lo entrega solo a sus participantes. No se genera desde
 * Google Calendar: vincular Calendar es opcional y el evento no lleva enlaces
 * privados (`docs/google-calendar.md`). La generación con la API de Meet
 * queda para una fase posterior.
 *
 * El enlace no forma parte de `Appointment` ni de sus proyecciones: los
 * listados de agenda nunca lo traen y solo sale por la lectura dedicada, que
 * decide con `toOnlineAccessView` quién lo recibe. Los apoyos de la atención
 * en línea reutilizan `AccessNeed`, igual que `CompatibilityOption.onlineSupports`
 * (TI2-82), sin un catálogo paralelo.
 */

import type { AccessNeed, ModalityPreference } from "../requests/request";
import { isCalendarActionableStatus, type AppointmentStatus } from "./appointment";
import {
  isAppointmentParticipant,
  isAppointmentProfessional,
  type AppointmentParticipants,
} from "./participants";

/** Dominios permitidos para el enlace privado; hoy solo Google Meet. */
export const ONLINE_ACCESS_ALLOWED_HOSTS = ["meet.google.com"] as const;

/** Largo máximo del texto recibido, antes de normalizar. */
export const ONLINE_ACCESS_LINK_MAX_LENGTH = 2048 as const;

/** Código de reunión de Meet: tres, cuatro y tres letras separadas por guion. */
const MEET_MEETING_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/** Causas de rechazo del enlace, devueltas como valor y no como excepción. */
export const ONLINE_ACCESS_LINK_REJECTION_CAUSES = [
  "link_required",
  "link_too_long",
  "link_malformed",
  "link_not_https",
  "link_host_not_allowed",
  "link_meeting_code_invalid",
] as const;

export type OnlineAccessLinkRejectionCause = (typeof ONLINE_ACCESS_LINK_REJECTION_CAUSES)[number];

export type OnlineAccessLinkResult =
  | { readonly status: "valid"; readonly link: string }
  | { readonly status: "rejected"; readonly cause: OnlineAccessLinkRejectionCause };

/**
 * Valida el enlace y devuelve su forma canónica
 * `https://meet.google.com/sol-casa-pan`.
 *
 * Exige `https`, el dominio exacto de `ONLINE_ACCESS_ALLOWED_HOSTS` (sin
 * subdominios parecidos, credenciales ni puerto) y un código de reunión. La
 * consulta y el fragmento se descartan: suelen traer la cuenta de quien copió
 * el enlace y no cambian la reunión. La forma canónica permite comparar
 * enlaces para no reutilizar una misma sala entre atenciones.
 */
export function normalizeOnlineAccessLink(raw: string): OnlineAccessLinkResult {
  const text = raw.trim();
  if (text === "") return { status: "rejected", cause: "link_required" };
  if (text.length > ONLINE_ACCESS_LINK_MAX_LENGTH) {
    return { status: "rejected", cause: "link_too_long" };
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { status: "rejected", cause: "link_malformed" };
  }

  if (url.protocol !== "https:") return { status: "rejected", cause: "link_not_https" };
  if (
    !(ONLINE_ACCESS_ALLOWED_HOSTS as readonly string[]).includes(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    return { status: "rejected", cause: "link_host_not_allowed" };
  }

  const code = url.pathname.replace(/^\//, "").replace(/\/$/, "").toLowerCase();
  if (!MEET_MEETING_CODE.test(code)) {
    return { status: "rejected", cause: "link_meeting_code_invalid" };
  }
  return { status: "valid", link: `https://${url.hostname}/${code}` };
}

/** Datos de la atención que deciden sobre su acceso en línea. */
export interface OnlineAccessSubject extends AppointmentParticipants {
  readonly modality: ModalityPreference;
  readonly status: AppointmentStatus;
  /** Enlace canónico guardado; ausente mientras esté pendiente. */
  readonly privateAccessReference?: string;
}

/** Causas por las que no se puede agregar ni reemplazar el enlace. */
export const ONLINE_ACCESS_UPDATE_REJECTION_CAUSES = [
  "actor_not_professional",
  "not_online",
  "not_actionable",
] as const;

export type OnlineAccessUpdateRejectionCause =
  (typeof ONLINE_ACCESS_UPDATE_REJECTION_CAUSES)[number];

/**
 * Cambio del enlace que produce agregarlo: `added` si estaba pendiente,
 * `replaced` si cambia y `unchanged` si es el mismo (un reintento).
 */
export type OnlineAccessChange = "added" | "replaced" | "unchanged";

export type OnlineAccessUpdateResult =
  | { readonly status: "applied"; readonly link: string; readonly change: OnlineAccessChange }
  | {
      readonly status: "rejected";
      readonly cause: OnlineAccessUpdateRejectionCause | OnlineAccessLinkRejectionCause;
    };

/**
 * Decide si un Profesional puede agregar o reemplazar el enlace de la atención.
 *
 * Solo un profesional de la atención (responsable o adicional), solo en una
 * atención en línea y solo mientras siga vigente (`scheduled` o
 * `rescheduled`). Las causas van de la más general a la más específica: un
 * actor ajeno recibe `actor_not_professional` antes de saber nada de la
 * atención, y Presentación la traduce a `unauthorized`. `actorId` sale de la
 * sesión autenticada, nunca de un argumento del cliente.
 *
 * `added` y `replaced` avisan al Estudiante; `unchanged` no escribe ni avisa.
 */
export function decideOnlineAccessUpdate(
  appointment: OnlineAccessSubject,
  actorId: string,
  rawLink: string,
): OnlineAccessUpdateResult {
  if (!isAppointmentProfessional(actorId, appointment)) {
    return { status: "rejected", cause: "actor_not_professional" };
  }
  if (appointment.modality !== "online") return { status: "rejected", cause: "not_online" };
  if (!isCalendarActionableStatus(appointment.status)) {
    return { status: "rejected", cause: "not_actionable" };
  }

  const normalized = normalizeOnlineAccessLink(rawLink);
  if (normalized.status === "rejected") return normalized;

  const change: OnlineAccessChange =
    appointment.privateAccessReference === undefined
      ? "added"
      : appointment.privateAccessReference === normalized.link
        ? "unchanged"
        : "replaced";
  return { status: "applied", link: normalized.link, change };
}

/** Estados visibles del acceso en línea para un participante. */
export const ONLINE_ACCESS_STATUS_VALUES = ["pending", "available", "not_applicable"] as const;

export type OnlineAccessStatus = (typeof ONLINE_ACCESS_STATUS_VALUES)[number];

/**
 * Lo que recibe un participante sobre el acceso en línea.
 *
 * `pending` muestra la atención con el enlace pendiente; `available` trae el
 * enlace; `not_applicable` cubre la atención presencial y la que dejó de estar
 * vigente (cancelada, realizada o con inasistencia): ninguna entrega enlace.
 */
export type OnlineAccessView =
  | { readonly status: "pending" }
  | { readonly status: "available"; readonly link: string }
  | { readonly status: "not_applicable" };

/**
 * Vista del acceso en línea para quien consulta, o `null` si no participa.
 *
 * `null` es la señal para responder `unauthorized` sin revelar si la atención
 * existe ni si tiene enlace. El Practicante y el Administrador no reciben el
 * enlace aunque vean la atención por otra vía.
 */
export function toOnlineAccessView(
  appointment: OnlineAccessSubject,
  viewerId: string,
): OnlineAccessView | null {
  if (!isAppointmentParticipant(viewerId, appointment)) return null;
  if (appointment.modality !== "online" || !isCalendarActionableStatus(appointment.status)) {
    return { status: "not_applicable" };
  }
  if (appointment.privateAccessReference === undefined) return { status: "pending" };
  return { status: "available", link: appointment.privateAccessReference };
}

/** Causas de rechazo de los apoyos de la atención en línea. */
export const ONLINE_SUPPORTS_REJECTION_CAUSES = ["not_online", "support_invalid"] as const;

export type OnlineSupportsRejectionCause = (typeof ONLINE_SUPPORTS_REJECTION_CAUSES)[number];

export type OnlineSupportsResult =
  | { readonly status: "valid"; readonly supports: readonly AccessNeed[] }
  | { readonly status: "rejected"; readonly cause: OnlineSupportsRejectionCause };

/**
 * Normaliza los apoyos que la atención en línea ofrece, como subtítulos o
 * interpretación.
 *
 * Usa la misma forma `AccessNeed` que la compatibilidad de TI2-82, así la
 * reserva puede comprobar que los apoyos cubren las necesidades vigentes con
 * `assessCompatibility`. Recorta, exige identificador y etiqueta, y deja el
 * primero de cada identificador repetido. Una lista vacía es válida: la
 * atención no declara apoyos. En presencial los apoyos van en el espacio, no
 * acá.
 */
export function normalizeOnlineSupports(
  modality: ModalityPreference,
  supports: readonly AccessNeed[],
): OnlineSupportsResult {
  if (modality !== "online") {
    return supports.length === 0
      ? { status: "valid", supports: [] }
      : { status: "rejected", cause: "not_online" };
  }
  const seen = new Set<string>();
  const normalized: AccessNeed[] = [];
  for (const support of supports) {
    const id = support.id.trim();
    const label = support.label.trim();
    if (id === "" || label === "") return { status: "rejected", cause: "support_invalid" };
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push({ id, label });
  }
  return { status: "valid", supports: normalized };
}
