import {
  doesPrivacyBlockCoverCategory,
  privacyBlockStateAt,
  type PrivacyBlockScope,
  type PrivacyDataCategory,
} from "../../domain/privacy/privacy_controls";
import {
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";

/**
 * Guardia única del bloqueo temporal de privacidad (TI2-168).
 *
 * Aplicación: concentra la decisión de si un tratamiento está suspendido para
 * un titular y una categoría de datos en un instante dado. Usa el dominio para
 * derivar el estado del bloqueo y su alcance: nunca guarda una columna de
 * «bloqueado» paralela a `privacyBlocks` y nunca repite la comprobación en
 * cada pantalla. Consultas, cambios, avisos y exportaciones pasan por acá.
 *
 * El bloqueo suspende el tratamiento; no borra ni modifica los datos. Un
 * bloqueo ausente, vencido, levantado o de otra categoría deja el tratamiento
 * en curso.
 */

/** Bloqueo vigente que el guardia necesita, con identificadores genéricos. */
export interface ActivePrivacyBlockForGuard {
  readonly id: string;
  readonly scope: PrivacyBlockScope;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly liftedAt?: number;
}

/** Puerto de lectura de bloqueos vigentes de un titular. */
export interface PrivacyBlockGuardReader<UserId extends string> {
  listActiveBlocksForSubject(
    subjectId: UserId,
    now: number,
  ): Promise<readonly ActivePrivacyBlockForGuard[]>;
}

/** Dependencias del guardia: el puerto y el reloj del servidor. */
export interface PrivacyBlockGuardDeps<UserId extends string> {
  readonly blocks: PrivacyBlockGuardReader<UserId>;
  readonly now: () => number;
}

/** Tratamiento que se quiere ejecutar; documenta las cuatro vías cubiertas. */
export type PrivacyTreatment = "query" | "change" | "notice" | "export";

/** Entrada del guardia. */
export interface PrivacyTreatmentInput<UserId extends string> {
  readonly subjectId: UserId;
  readonly category: PrivacyDataCategory;
  readonly treatment: PrivacyTreatment;
}

/** Resultado: el tratamiento sigue o queda suspendido por un bloqueo concreto. */
export type PrivacyTreatmentResult =
  | { readonly status: "ok"; readonly treatment: PrivacyTreatment }
  | {
      readonly status: "blocked";
      readonly treatment: PrivacyTreatment;
      readonly blockId: string;
      readonly scope: PrivacyBlockScope;
    };

/**
 * Decide si el tratamiento puede ejecutarse.
 *
 * El reloj entra por dependencia (lo fija el servidor en producción y la
 * prueba lo adelanta). Un bloqueo programado, vencido o levantado no suspende;
 * uno vigente cubre la categoría consultada cuando su alcance es total o
 * igual a esa categoría.
 */
export async function guardPrivacyTreatment<UserId extends string>(
  deps: PrivacyBlockGuardDeps<UserId>,
  input: PrivacyTreatmentInput<UserId>,
): Promise<PrivacyTreatmentResult> {
  const now = deps.now();
  const blocks = await deps.blocks.listActiveBlocksForSubject(input.subjectId, now);
  for (const block of blocks) {
    if (privacyBlockStateAt(block, now) !== "active") continue;
    if (!doesPrivacyBlockCoverCategory(block.scope, input.category)) continue;
    return {
      status: "blocked",
      treatment: input.treatment,
      blockId: block.id,
      scope: block.scope,
    };
  }
  return { status: "ok", treatment: input.treatment };
}

/**
 * Traducción al contrato público: un tratamiento bloqueado responde
 * `unauthorized`, sin revelar el bloqueo, su motivo ni su alcance.
 */
export function privacyTreatmentDenied<T>(): ApiResult<T> {
  return errResult(unauthorizedError());
}

/** Resultado permitido para el caso de uso que solo necesita seguir. */
export function privacyTreatmentAllowed(): ApiResult<void> {
  return okResult(undefined);
}
