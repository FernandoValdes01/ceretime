import type { QueryCtx } from "../_generated/server";
import { authorizationReader } from "../infrastructure/accompaniments/repository";
import { privacyBlockReader } from "../infrastructure/privacy/repository";

/**
 * Lector de autorización con bloqueos de privacidad (TI2-168).
 *
 * Presentación compone aquí el lector de acompañamientos con el de
 * `privacyBlocks`, sin que Infraestructura dependa de otra capa. Es el único
 * punto donde los bloqueos se conectan a las consultas y cambios: los casos de
 * uso siguen recibiendo el mismo `AuthorizationReader`, ahora con el método
 * opcional `listActivePrivacyBlocks` poblado.
 */
export function privacyAwareAuthorizationReader(ctx: QueryCtx) {
  const base = authorizationReader(ctx);
  const blocks = privacyBlockReader(ctx);
  return {
    ...base,
    listActivePrivacyBlocks: (subjectId: string, now: number) =>
      blocks.listActiveBlocksForSubject(subjectId, now),
  };
}
