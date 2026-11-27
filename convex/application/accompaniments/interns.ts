import {
  isPersonalProfessionalActive,
  type AccountEnabler,
} from "../../domain/accounts/enablement";
import {
  CONFLICT_ERROR_CODE,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";

/**
 * Practicantes de un acompañamiento para gestionarlos desde la Web del
 * Profesional (TI2-170).
 *
 * Capa de Aplicación: decide quién puede ver la lista y qué practicantes se
 * ofrecen para asignar, con las lecturas que recibe por el puerto
 * `AccompanimentInternsReader`, sin tocar `ctx.db`. El cambio en sí se hace
 * con `assignAccompanimentAccess`, `updateAccompanimentAccess` y
 * `revokeAccompanimentAccess` (TI2-140), que vuelven a exigir sus reglas al
 * escribir. La habilitación de la cuenta es otra decisión y vive en
 * `presentation/accounts.enableIntern`.
 */

/** Tope de perfiles practicantes revisados; `assignableComplete` avisa si había más. */
export const MAX_ASSIGNABLE_INTERNS = 100;

/** Perfil con lo necesario para decidir y mostrar el nombre (`nombre` de USUARIOS). */
export type InternProfile<UserId extends string = string> = AccountEnabler & {
  readonly _id: UserId;
  readonly fullName: string;
};

/** Asignación practicante activa y vigente. */
export type InternAssignmentRow<UserId extends string = string> = {
  readonly userId: UserId;
  /** `asignadoEn`; falta en filas anteriores a TI2-140. */
  readonly assignedAt?: number;
  /** Vigencia acordada (TI2-140); ausente cuando la asignación no la declara. */
  readonly validFrom?: number;
  readonly validUntil?: number;
};

export interface AccompanimentInternsReader<UserId extends string = string> {
  findProfileByTokenIdentifier(tokenIdentifier: string): Promise<InternProfile<UserId> | null>;
  getProfile(userId: UserId): Promise<InternProfile<UserId> | null>;
  /** Estado del acompañamiento, o `null` si no existe. */
  getAccompanimentStatus(accompanimentId: string): Promise<string | null>;
  hasActiveProfessionalAssignment(accompanimentId: string, userId: UserId): Promise<boolean>;
  /** Asignaciones practicantes vigentes, o `null` si el acompañamiento supera el tope. */
  listActiveInternAssignments(
    accompanimentId: string,
  ): Promise<ReadonlyArray<InternAssignmentRow<UserId>> | null>;
  /** Hasta `limit` más uno perfiles con rol practicante, para saber si quedan más. */
  takeInternProfiles(limit: number): Promise<ReadonlyArray<InternProfile<UserId>>>;
}

export type AccompanimentIntern<UserId extends string = string> = {
  readonly userId: UserId;
  readonly fullName: string;
};

export type AssignedIntern<UserId extends string = string> = AccompanimentIntern<UserId> & {
  readonly assignedAt?: number;
  readonly validFrom?: number;
  readonly validUntil?: number;
};

export type AccompanimentInterns<UserId extends string = string> = {
  readonly assigned: readonly AssignedIntern<UserId>[];
  readonly assignable: readonly AccompanimentIntern<UserId>[];
  readonly assignableComplete: boolean;
};

const byName = (a: { readonly fullName: string }, b: { readonly fullName: string }) =>
  a.fullName.localeCompare(b.fullName, "es");

function isEnabledIntern(profile: InternProfile<string>): boolean {
  return (
    profile.role === "intern" &&
    profile.institutionalStatus === "enabled" &&
    profile.accountStatus === "active"
  );
}

/**
 * Lista los practicantes asignados y los que se pueden asignar.
 *
 * Solo un profesional de personal, habilitado y vigente, con asignación
 * profesional activa sobre ese acompañamiento: la misma regla que exige
 * `assignAccompanimentAccess` para conceder. Los asignables son practicantes
 * habilitados y vigentes que todavía no están asignados. Solo se entregan el
 * identificador y el nombre, más la vigencia de los asignados. Sin permiso,
 * o con un acompañamiento inexistente, responde `unauthorized` genérico; si
 * el acompañamiento supera el tope de asignaciones leídas, `conflict` en vez
 * de una lista incompleta.
 */
export async function listAccompanimentInterns<UserId extends string>(
  reader: AccompanimentInternsReader<UserId>,
  input: { readonly tokenIdentifier: string | null; readonly accompanimentId: string },
): Promise<ApiResult<AccompanimentInterns<UserId>>> {
  if (input.tokenIdentifier === null) return errResult(unauthorizedError());
  const caller = await reader.findProfileByTokenIdentifier(input.tokenIdentifier);
  if (caller === null || !isPersonalProfessionalActive(caller)) {
    return errResult(unauthorizedError());
  }
  const status = await reader.getAccompanimentStatus(input.accompanimentId);
  if (status === null) return errResult(unauthorizedError());
  if (!(await reader.hasActiveProfessionalAssignment(input.accompanimentId, caller._id))) {
    return errResult(unauthorizedError());
  }

  const rows = await reader.listActiveInternAssignments(input.accompanimentId);
  if (rows === null) {
    return errResult({
      code: CONFLICT_ERROR_CODE,
      message: "El acompañamiento tiene demasiadas asignaciones para mostrarlas completas.",
    });
  }
  const assigned: AssignedIntern<UserId>[] = [];
  for (const row of rows) {
    const profile = await reader.getProfile(row.userId);
    if (profile === null) continue;
    // Solo practicantes: una fila con otro rol no se muestra como practicante.
    if (profile.role !== "intern") continue;
    assigned.push({
      userId: profile._id,
      fullName: profile.fullName,
      ...(row.assignedAt === undefined ? {} : { assignedAt: row.assignedAt }),
      ...(row.validFrom === undefined ? {} : { validFrom: row.validFrom }),
      ...(row.validUntil === undefined ? {} : { validUntil: row.validUntil }),
    });
  }

  const assignedIds = new Set<string>(assigned.map((item) => item.userId as string));
  const candidates = await reader.takeInternProfiles(MAX_ASSIGNABLE_INTERNS);
  const assignable = candidates
    .slice(0, MAX_ASSIGNABLE_INTERNS)
    .filter(
      (profile) =>
        isEnabledIntern(profile as InternProfile<string>) &&
        !assignedIds.has(profile._id as string),
    )
    .map((profile) => ({ userId: profile._id, fullName: profile.fullName }));

  return okResult({
    assigned: assigned.sort(byName),
    assignable: assignable.sort(byName),
    assignableComplete: candidates.length <= MAX_ASSIGNABLE_INTERNS,
  });
}
