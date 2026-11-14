/**
 * Participantes de la atención: varios profesionales por atención (TI2-142).
 *
 * Dominio puro: no importa Convex, React ni Expo. La atención conserva
 * `professionalId` como Profesional responsable (contrato v1 que ya consumen
 * Web y Mobile) y suma `additionalProfessionalIds` con los demás profesionales
 * que participan, que se guardan en `appointmentProfessionals` (TI2-138);
 * ninguna lista reemplaza a la otra. La detección de cruces
 * sigue siendo una sola (`occupySlotAtomically`, TI2-84/TI2-96): este módulo
 * solo entrega el conjunto de profesionales que esa comprobación debe recorrer
 * y la regla de quién participa, sin otra comprobación de ocupación.
 */

/**
 * Máximo provisional de profesionales en una misma atención, contando al
 * responsable. Acota la lectura de ocupación por atención; se ajusta cuando
 * CERETI confirme cuántos profesionales coordinan a la vez.
 */
export const MAX_APPOINTMENT_PROFESSIONALS = 3 as const;

/** Profesionales de una atención con identificadores genéricos. */
export interface AppointmentProfessionals {
  /** Profesional responsable: el mismo `professionalId` del contrato v1. */
  readonly professionalId: string;
  /** Profesionales que acompañan al responsable; ausente o vacío si no hay. */
  readonly additionalProfessionalIds?: readonly string[];
}

/** Participantes con acceso propio a la atención: Estudiante y profesionales. */
export interface AppointmentParticipants extends AppointmentProfessionals {
  readonly studentId: string;
}

/** Causas de rechazo al fijar los profesionales, devueltas como valor. */
export const APPOINTMENT_PROFESSIONALS_REJECTION_CAUSES = [
  "professional_required",
  "professional_invalid",
  "too_many_professionals",
] as const;

export type AppointmentProfessionalsRejectionCause =
  (typeof APPOINTMENT_PROFESSIONALS_REJECTION_CAUSES)[number];

export type AppointmentProfessionalsResult =
  | {
      readonly status: "valid";
      readonly professionalId: string;
      /** Adicionales recortados, sin repetir ni incluir al responsable, en el orden recibido. */
      readonly additionalProfessionalIds: readonly string[];
    }
  | { readonly status: "rejected"; readonly cause: AppointmentProfessionalsRejectionCause };

/**
 * Normaliza los profesionales que el personal autorizado pide para una
 * atención.
 *
 * Recorta cada identificador y descarta repeticiones, incluido el responsable
 * repetido entre los adicionales: pedir dos veces a la misma persona no es un
 * error. Un adicional vacío sí lo es, porque indica un cliente que perdió el
 * dato. El total, con el responsable, no supera
 * `MAX_APPOINTMENT_PROFESSIONALS`. Que cada identificador sea un Profesional
 * vigente y asignado al acompañamiento lo comprueba Aplicación.
 */
export function normalizeAppointmentProfessionals(
  input: AppointmentProfessionals,
): AppointmentProfessionalsResult {
  const professionalId = input.professionalId.trim();
  if (professionalId === "") return { status: "rejected", cause: "professional_required" };

  const seen = new Set<string>([professionalId]);
  const additionalProfessionalIds: string[] = [];
  for (const raw of input.additionalProfessionalIds ?? []) {
    const id = raw.trim();
    if (id === "") return { status: "rejected", cause: "professional_invalid" };
    if (seen.has(id)) continue;
    seen.add(id);
    additionalProfessionalIds.push(id);
  }

  if (seen.size > MAX_APPOINTMENT_PROFESSIONALS) {
    return { status: "rejected", cause: "too_many_professionals" };
  }
  return { status: "valid", professionalId, additionalProfessionalIds };
}

/**
 * Todos los profesionales de la atención, responsable primero y sin repetir.
 *
 * Es el conjunto que recorre la detección de cruces: cada uno debe estar libre
 * en `[startAt, endAt)`, no solo el responsable.
 */
export function appointmentProfessionalIds(
  appointment: AppointmentProfessionals,
): readonly string[] {
  return [
    ...new Set([appointment.professionalId, ...(appointment.additionalProfessionalIds ?? [])]),
  ];
}

/** Verdadero cuando la persona es uno de los profesionales de la atención. */
export function isAppointmentProfessional(
  userId: string,
  appointment: AppointmentProfessionals,
): boolean {
  const id = userId.trim();
  return id !== "" && appointmentProfessionalIds(appointment).includes(id);
}

/**
 * Verdadero cuando la persona participa en la atención: el Estudiante dueño o
 * uno de sus profesionales. El Practicante no participa por estar asignado al
 * acompañamiento: su acceso sigue siendo la vista minimizada (TI2-127).
 */
export function isAppointmentParticipant(
  userId: string,
  appointment: AppointmentParticipants,
): boolean {
  const id = userId.trim();
  if (id === "") return false;
  return id === appointment.studentId || isAppointmentProfessional(id, appointment);
}
