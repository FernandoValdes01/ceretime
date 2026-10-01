/**
 * Modalidad de atención de la agenda (TI2-83).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. Representación
 * persistida propia de este módulo: usa los mismos literales que la
 * preferencia de modalidad de la solicitud (`ModalityPreference` en
 * `domain/request/request.ts`) porque la especificación vigente solo admite
 * presencial y en línea (sin híbrida), pero no importa ese tipo para no
 * acoplar la agenda a los contratos que otro responsable publique en S1.
 * `convex/validators.ts` los convierte a validadores en el borde.
 */

/** Modalidades admitidas por la especificación vigente. */
export const MODALITY_VALUES = ["inPerson", "online"] as const;

export type Modality = (typeof MODALITY_VALUES)[number];

/** Verdadero cuando el valor es una modalidad persistible conocida. */
export function isModality(value: string): value is Modality {
  return (MODALITY_VALUES as readonly string[]).includes(value);
}
