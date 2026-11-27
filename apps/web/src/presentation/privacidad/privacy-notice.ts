import noticeMarkdown from "../../../../../docs/privacidad-aviso.md?raw";
import {
  PRIVACY_REQUEST_KIND_LABELS,
  type PrivacyRequestKind,
} from "../../../../../convex/domain/index.ts";
import { noticeInlineText, parseNoticeDocument } from "./notice-document.ts";

/**
 * Aviso de privacidad publicado por la Web (TI2-171).
 *
 * Única lectura de `docs/privacidad-aviso.md`: la página del aviso muestra
 * estos bloques y el formulario del Estudiante toma de aquí la explicación de
 * cada derecho, así ese texto vive solo en el aviso.
 */
export const PRIVACY_NOTICE_BLOCKS = parseNoticeDocument(noticeMarkdown);

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
