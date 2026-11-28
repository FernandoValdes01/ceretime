/**
 * Estados de la toma de una solicitud (TI4-84).
 *
 * Dominio puro. La toma es la relación explícita entre el Profesional y la
 * solicitud que revisa, `TOMAS_SOLICITUD` en el MER, que tiene su propia
 * unión de estados y no comparte la de las asignaciones de acompañamiento:
 *
 * - `active`: el Profesional la revisa y la opera. Es `vigente` en el MER.
 * - `revoked`: se liberó, por el propio Profesional o al revocarse su cuenta.
 *   Guarda quién la liberó y cuándo, que es `liberadaEn` en el MER. Quien la
 *   liberó deja de leerla.
 * - `finished`: la solicitud llegó a un estado terminal mientras la tomaba.
 *   Es `finalizada` en el MER: ya no opera, pero sigue leyendo lo que revisó.
 *
 * Los literales son los valores persistidos de `requestAssignments.status`;
 * las filas anteriores a TI4-84 solo traen `active` o `revoked`, que siguen
 * siendo válidos.
 */
export const REQUEST_TAKE_STATUS_VALUES = ["active", "revoked", "finished"] as const;

export type RequestTakeStatus = (typeof REQUEST_TAKE_STATUS_VALUES)[number];
