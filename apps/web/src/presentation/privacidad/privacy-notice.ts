import noticeMarkdown from "../../../../../docs/privacidad-aviso.md?raw";
import {
  PRIVACY_REQUEST_KIND_LABELS,
  PRIVACY_REQUEST_KIND_VALUES,
  SUBMITTABLE_PRIVACY_REQUEST_KINDS,
  type PrivacyRequestKind,
} from "../../../../../convex/domain/index.ts";
import { noticeInlineText, parseNoticeDocument } from "./notice-document.ts";

/**
 * Carpeta `docs/` del repositorio público, donde viven los documentos a los
 * que remite el aviso (inventario, procedimiento, análisis de la ley). La Web
 * no los publica, así que sus enlaces llevan ahí.
 */
const NOTICE_DOCUMENTS_BASE_URL = "https://github.com/FernandoValdes01/ceretime/blob/main/docs/";

/**
 * Aviso de privacidad publicado por la Web (TI2-171).
 *
 * Única lectura de `docs/privacidad-aviso.md`: la página del aviso muestra
 * estos bloques y el formulario del Estudiante toma de aquí la explicación de
 * cada derecho, así ese texto vive solo en el aviso.
 */
export const PRIVACY_NOTICE_BLOCKS = parseNoticeDocument(noticeMarkdown, NOTICE_DOCUMENTS_BASE_URL);

/**
 * Explicación de un derecho según la lista «Tus derechos» del aviso, donde
 * cada elemento empieza con la etiqueta del dominio en negrita
 * («**Acceso.** Saber…»). `null` si el aviso no lo explica.
 */
export function privacyKindDescription(kind: PrivacyRequestKind): string | null {
  const heading = `${PRIVACY_REQUEST_KIND_LABELS[kind]}.`;
  for (const block of PRIVACY_NOTICE_BLOCKS) {
    if (block.kind !== "list") continue;
    for (const item of block.items) {
      const [first, ...rest] = item;
      if (first?.kind === "strong" && first.text === heading) {
        return noticeInlineText(rest).trim();
      }
    }
  }
  return null;
}

/**
 * Derechos del aviso que todavía no se presentan desde la Web (TI2-168), en
 * una frase para el formulario, o `null` cuando ya se presentan todos.
 */
export const PRIVACY_PENDING_KINDS_NOTICE: string | null = (() => {
  const submittable = new Set<PrivacyRequestKind>(SUBMITTABLE_PRIVACY_REQUEST_KINDS);
  const pending = PRIVACY_REQUEST_KIND_VALUES.filter((kind) => !submittable.has(kind)).map(
    (kind) => PRIVACY_REQUEST_KIND_LABELS[kind],
  );
  if (pending.length === 0) return null;
  const names =
    pending.length === 1
      ? pending[0]
      : `${pending.slice(0, -1).join(", ")} y ${pending[pending.length - 1].toLowerCase()}`;
  return `${names} todavía no se ${pending.length === 1 ? "presenta" : "presentan"} desde la aplicación.`;
})();
