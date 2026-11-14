/**
 * Asignación de acceso a un acompañamiento (TI2-8).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. Alineada con la
 * tabla `accompanimentAssignments` del schema actual. Invariante de
 * persistencia (ver `schema.ts`): como máximo una fila activa por cada
 * combinación de acompañamiento, usuario y rol asignado.
 *
 * Trazabilidad mínima: la fila registra quién concedió (`grantedBy`), cuándo
 * (`grantedAt`) y, si se revoca, quién y cuándo (fecha de revocación), sin
 * borrar el historial. Los cuatro campos son opcionales porque el schema los
 * declara así: las filas legacy (anteriores a TI2-16) no los tienen y las
 * filas activas nuevas todavía no tienen fecha de revocación. La vigencia
 * del acceso la decide `status`, no la presencia de estos campos. Desde
 * TI2-138 la fila admite además una vigencia opcional (`validFrom`/
 * `validUntil`): expresa la ventana sin inventar revocaciones y no reemplaza
 * a `status`. El cambio de profesional asignado se rastrea con la fila
 * revocada y la nueva concesión, sin tabla ni vínculo paralelo. TI2-140
 * comprueba la coherencia de esa ventana cuando se acuerda: `validFrom` no
 * puede ser posterior a `validUntil`.
 */

/** Rol con el que una persona queda asignada al acompañamiento. */
export const ASSIGNMENT_ROLE_VALUES = ["professional", "intern"] as const;

export type AssignmentRole = (typeof ASSIGNMENT_ROLE_VALUES)[number];

/** Vigencia de la asignación: activa o revocada. */
export const ASSIGNMENT_STATUS_VALUES = ["active", "revoked"] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUS_VALUES)[number];

/**
 * Fila de asignación con trazabilidad, no una entidad que se borra.
 * `grantedBy` es el perfil del Profesional que concedió. Los cuatro campos
 * de trazabilidad son opcionales como en el schema: una fila legacy válida
 * puede no traer ninguno, y una fila activa nueva no trae fecha de
 * revocación. `revokedBy`/`revokedAt` aceptan `null` explícito además de
 * ausencia, porque ambas formas significan "sin revocar".
 */
export interface PractitionerAssignment {
  _id: string;
  accompanimentId: string;
  userId: string;
  assignedRole: AssignmentRole;
  status: AssignmentStatus;
  grantedBy?: string;
  grantedAt?: number;
  revokedBy?: string | null;
  revokedAt?: number | null;
  /** Vigencia opcional (TI2-138); ausente cuando la asignación no la declara. */
  validFrom?: number | null;
  validUntil?: number | null;
}

/**
 * Permiso de lectura que la asignación concede sobre el acompañamiento
 * mientras esté activa. `view` es `"full"` para el Profesional y
 * `"minimized"` para el Practicante, que no recibe `accessNeeds`.
 */
export interface AssignmentReadPermission {
  accompanimentId: string;
  userId: string;
  role: AssignmentRole;
  view: "full" | "minimized";
  /** Ausente cuando la fila legacy no registra fecha de concesión. */
  grantedAt?: number;
}

/** Vista que concede cada rol asignado (`practitioner_assignment.ts`). */
export const ASSIGNMENT_VIEW_BY_ROLE: Record<AssignmentRole, "full" | "minimized"> = {
  professional: "full",
  intern: "minimized",
};

/**
 * Permiso de lectura de una asignación, o `null` si está revocada.
 * Mantiene explícito que una fila revocada no autoriza (RNF-08, RN-26).
 */
export function toAssignmentReadPermission(
  assignment: PractitionerAssignment,
): AssignmentReadPermission | null {
  if (assignment.status !== "active") return null;
  return {
    accompanimentId: assignment.accompanimentId,
    userId: assignment.userId,
    role: assignment.assignedRole,
    view: ASSIGNMENT_VIEW_BY_ROLE[assignment.assignedRole],
    grantedAt: assignment.grantedAt,
  };
}

/** Ventana de vigencia acordada al conceder o modificar una asignación (TI2-140). */
export type AssignmentValidity = {
  readonly validFrom?: number | null;
  readonly validUntil?: number | null;
};

export type AssignmentValidityCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "validity-not-finite" | "validity-range-invalid" };

/**
 * Comprueba la vigencia acordada sin inventar revocaciones.
 *
 * Acepta ausencia total (sin ventana), un solo extremo o ambos. Rechaza
 * valores no finitos o negativos y el rango invertido (`validFrom` posterior
 * a `validUntil`). No mira `status`: una ventana coherente no autoriza por
 * sí sola y una fila revocada sigue sin autorizar.
 */
export function validateAssignmentValidity(input: AssignmentValidity): AssignmentValidityCheck {
  const { validFrom, validUntil } = input;
  const from = validFrom ?? null;
  const until = validUntil ?? null;
  for (const value of [from, until]) {
    if (value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return { ok: false, reason: "validity-not-finite" };
    }
  }
  if (from !== null && until !== null && from > until) {
    return { ok: false, reason: "validity-range-invalid" };
  }
  return { ok: true };
}

/**
 * Verdadero cuando el instante cae dentro de la ventana acordada.
 *
 * Sin ventana declara vigente: la vigencia efectiva la sigue decidiendo
 * `status` y esta comprobación solo acota cuando hay fechas. Sirve para que
 * la concesión y la modificación rechacen una ventana incoherente y para
 * documentar la lectura esperada sin crear otra política de practicante.
 */
export function isAssignmentWithinValidity(
  assignment: Pick<PractitionerAssignment, "validFrom" | "validUntil">,
  now: number,
): boolean {
  const from = assignment.validFrom ?? null;
  const until = assignment.validUntil ?? null;
  if (from !== null && now < from) return false;
  if (until !== null && now > until) return false;
  return true;
}
