import {
  isPersonalProfessionalActive,
  type AccountEnabler,
} from "../../domain/accounts/enablement";
import {
  keepsAManagerWithout,
  toProfessionalAssignmentHolder,
  type AccompanimentStatus,
} from "../../domain/accompaniments/accompaniment";
import {
  CONFLICT_ERROR_CODE,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";

/**
 * Profesionales de un acompañamiento para cambiarlos (TI2-165).
 *
 * Capa de Aplicación: decide quién puede ver la lista y qué profesionales se
 * ofrecen para asignar, con las lecturas que recibe por el puerto
 * `AccompanimentProfessionalsReader`, sin tocar `ctx.db`. El cambio en sí se
 * hace con `assignAccompanimentAccess` y `revokeAccompanimentAccess`
 * (TI2-140), que vuelven a exigir sus reglas al escribir.
 */

/** Tope de perfiles profesionales revisados; `assignableComplete` avisa si había más. */
export const MAX_ASSIGNABLE_PROFESSIONALS = 100;

/** Perfil con lo necesario para decidir y mostrar el nombre (`nombre` de USUARIOS). */
export type ProfessionalProfile<UserId extends string = string> = AccountEnabler & {
  readonly _id: UserId;
  readonly fullName: string;
};

/** Asignación profesional activa y vigente (ASIGNACIONES_PROFESIONALES del MER). */
export type ProfessionalAssignmentRow<UserId extends string = string> = {
  readonly userId: UserId;
  /** `asignadoEn`; falta en filas anteriores a TI2-140. */
  readonly assignedAt?: number;
  /** Fin acordado, solo en filas anteriores a TI2-165; no se entrega a la Web. */
  readonly validUntil?: number;
};

export interface AccompanimentProfessionalsReader<UserId extends string = string> {
  findProfileByTokenIdentifier(
    tokenIdentifier: string,
  ): Promise<ProfessionalProfile<UserId> | null>;
  getProfile(userId: UserId): Promise<ProfessionalProfile<UserId> | null>;
  /** Estado del acompañamiento, o `null` si no existe. */
  getAccompanimentStatus(accompanimentId: string): Promise<AccompanimentStatus | null>;
  hasActiveProfessionalAssignment(accompanimentId: string, userId: UserId): Promise<boolean>;
  /** Asignaciones vigentes, o `null` si el acompañamiento supera el tope de filas leídas. */
  listActiveProfessionalAssignments(
    accompanimentId: string,
  ): Promise<ReadonlyArray<ProfessionalAssignmentRow<UserId>> | null>;
  /** Hasta `limit` más uno perfiles con rol profesional, para saber si quedan más. */
  takeProfessionalProfiles(limit: number): Promise<ReadonlyArray<ProfessionalProfile<UserId>>>;
}

export type AccompanimentProfessional<UserId extends string = string> = {
  readonly userId: UserId;
  readonly fullName: string;
};

export type AssignedProfessional<UserId extends string = string> =
  AccompanimentProfessional<UserId> & {
    readonly assignedAt?: number;
    /** La asignación es de quien consulta. */
    readonly isCaller: boolean;
    /** Se puede retirar sin dejar el acompañamiento sin quien lo gestione. */
    readonly removable: boolean;
  };

export type AccompanimentProfessionals<UserId extends string = string> = {
  readonly assigned: readonly AssignedProfessional<UserId>[];
  readonly assignable: readonly AccompanimentProfessional<UserId>[];
  readonly assignableComplete: boolean;
};

const byName = (a: { readonly fullName: string }, b: { readonly fullName: string }) =>
  a.fullName.localeCompare(b.fullName, "es");

/**
 * Lista los profesionales asignados y los que se pueden asignar.
 *
 * Solo un profesional de personal, habilitado y vigente, con asignación
 * profesional activa sobre ese acompañamiento: la misma regla que exige
 * `assignAccompanimentAccess` para conceder. Los asignables son profesionales
 * de personal habilitados y vigentes que todavía no están asignados; quedan
 * fuera las cuentas de prueba, los practicantes y las cuentas inhabilitadas.
 * Solo se entregan el identificador y el nombre. Sin permiso, o con un
 * acompañamiento inexistente, responde `unauthorized` genérico; si el
 * acompañamiento supera el tope de asignaciones leídas, `conflict` en vez de
 * una lista incompleta.
 */
export async function listAccompanimentProfessionals<UserId extends string>(
  reader: AccompanimentProfessionalsReader<UserId>,
  input: { readonly tokenIdentifier: string | null; readonly accompanimentId: string },
): Promise<ApiResult<AccompanimentProfessionals<UserId>>> {
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

  const rows = await reader.listActiveProfessionalAssignments(input.accompanimentId);
  if (rows === null) {
    return errResult({
      code: CONFLICT_ERROR_CODE,
      message: "El acompañamiento tiene demasiadas asignaciones para mostrarlas completas.",
    });
  }
  const profiles = new Map<UserId, ProfessionalProfile<UserId> | null>();
  for (const row of rows) profiles.set(row.userId, await reader.getProfile(row.userId));
  // La misma regla que aplica `revokeAccompanimentAccess` al retirar.
  const holders = rows.map((row) =>
    toProfessionalAssignmentHolder(row, profiles.get(row.userId) ?? null),
  );
  const assigned: AssignedProfessional<UserId>[] = [];
  for (const row of rows) {
    const profile = profiles.get(row.userId) ?? null;
    if (profile === null) continue;
    assigned.push({
      userId: profile._id,
      fullName: profile.fullName,
      ...(row.assignedAt === undefined ? {} : { assignedAt: row.assignedAt }),
      isCaller: profile._id === caller._id,
      removable: keepsAManagerWithout(status, holders, profile._id),
    });
  }

  const assignedIds = new Set<string>(assigned.map((item) => item.userId));
  const candidates = await reader.takeProfessionalProfiles(MAX_ASSIGNABLE_PROFESSIONALS);
  const assignable = candidates
    .slice(0, MAX_ASSIGNABLE_PROFESSIONALS)
    .filter((profile) => isPersonalProfessionalActive(profile) && !assignedIds.has(profile._id))
    .map((profile) => ({ userId: profile._id, fullName: profile.fullName }));

  return okResult({
    assigned: assigned.sort(byName),
    assignable: assignable.sort(byName),
    assignableComplete: candidates.length <= MAX_ASSIGNABLE_PROFESSIONALS,
  });
}
